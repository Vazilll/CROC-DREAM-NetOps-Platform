from __future__ import annotations

import asyncio
import secrets
import time
from typing import Any

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from netops.api.deps import ContainerDep, Operator, SessionDep, Viewer
from netops.db import Base
from netops.enums import DeviceStatus, IntentSource
from netops.intent.netbox import load_netbox_inventory
from netops.models import ConfigSnapshot, Device, DriftRecord, Job, MetricSample, User
from netops.schemas.intent import IntentIssueRead, IntentLintReport
from netops.schemas.users import UserRead
from netops.services import DeviceService, JobService
from netops.services.bootstrap import (
    build_bootstrap_status,
    claim_owner,
    configure_layers,
    discover_server,
    recover_owner,
)
from netops.services.chaos import execute_chaos_scenario
from netops.services.freeze import get_freeze_state, set_factory_freeze
from netops.services.git_sot import git_commit_and_push_diff, git_pull_repo, git_repo_metadata
from netops.services.notifier import (
    format_executive_summary,
    load_telegram_bindings,
    load_user_tokens,
    resolve_telegram_targets,
    send_telegram_message,
    sync_access_registry,
)
from netops.settings import ApiPrincipal
from netops.telemetry import collector, metrics
from netops.telemetry.bot import bind_telegram_chat_user, ensure_user_token

# Keep aliases for backwards-compatible unit/integration imports if any
_git_repo_metadata = git_repo_metadata
_git_pull_repo = git_pull_repo

router = APIRouter()
api_router = APIRouter()

_verified_dbs: set[str] = set()
_ws_tickets: dict[str, dict[str, Any]] = {}


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "unavailable", "database": reason},
    )


@router.get("/healthz", tags=["system"], summary="Сервис жив")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", tags=["system"], summary="Готовность: база доступна и миграции применены")
def readiness(session: SessionDep) -> JSONResponse:
    try:
        db_key = str(session.get_bind().url)
        if db_key in _verified_dbs:
            session.execute(select(1))
        else:
            existing = set(inspect(session.connection()).get_table_names())
            if not set(Base.metadata.tables) <= existing:
                return _unavailable("migrations not applied")
            _verified_dbs.add(db_key)
    except SQLAlchemyError:
        return _unavailable("unreachable")
    return JSONResponse(content={"status": "ok", "database": "ok"})


def _render_prometheus_metrics(session: SessionDep) -> PlainTextResponse:
    lines = [
        "# HELP netops_up Whether NetOps Platform API is operational",
        "# TYPE netops_up gauge",
    ]
    try:
        dev_counts = session.execute(
            select(Device.status, func.count(Device.id)).group_by(Device.status)
        ).all()
        lines.extend(
            [
                "netops_up 1",
                "",
                "# HELP netops_devices_total Total network devices by operational sync status",
                "# TYPE netops_devices_total gauge",
            ]
        )
        status_map = {
            (row[0].value if hasattr(row[0], "value") else str(row[0])): row[1]
            for row in dev_counts
        }
        for st in ("IN_SYNC", "DRIFT_DETECTED", "UNREACHABLE", "UNKNOWN"):
            lines.append(f'netops_devices_total{{status="{st.lower()}"}} {status_map.get(st, 0)}')

        lines.append("")
        lines.append("# HELP netops_jobs_total Total executed orchestration jobs by type and status")
        lines.append("# TYPE netops_jobs_total counter")
        job_counts = session.execute(
            select(Job.type, Job.status, func.count(Job.id)).group_by(Job.type, Job.status)
        ).all()
        for row in job_counts:
            j_type = row[0].value if hasattr(row[0], "value") else str(row[0])
            j_status = row[1].value if hasattr(row[1], "value") else str(row[1])
            lines.append(
                f'netops_jobs_total{{type="{j_type.lower()}",status="{j_status.lower()}"}} {row[2]}'
            )

        lines.append("")
        lines.append("# HELP netops_drift_records_total Total configuration drift records recorded")
        lines.append("# TYPE netops_drift_records_total counter")
        drift_count = session.scalar(select(func.count(DriftRecord.id))) or 0
        lines.append(f"netops_drift_records_total {drift_count}")

        samples, collected_at = collector.latest(session)
        hw_samples = [
            s
            for s in samples
            if s.name
            in (
                metrics.DEVICE_REACHABLE,
                metrics.BGP_SESSION_UP,
                metrics.BGP_PREFIXES_ACCEPTED,
                metrics.INTERFACE_UP,
                metrics.PING_LOSS,
                metrics.CPU_USAGE,
                metrics.MEMORY_USAGE,
                metrics.UPLINK_UTIL,
            )
        ]
        if hw_samples:
            lines.append("")
            lines.append(metrics.render(hw_samples, collected_at).rstrip())
    except Exception:
        lines.append("netops_up 0")

    lines.append("")
    return PlainTextResponse(
        "\n".join(lines) + "\n", media_type="text/plain; version=0.0.4; charset=utf-8"
    )


@router.get(
    "/metrics",
    tags=["system"],
    summary="Метрики для Prometheus",
    response_class=PlainTextResponse,
)
def prometheus_metrics(session: SessionDep) -> PlainTextResponse:
    samples, collected_at = collector.latest(session)
    return PlainTextResponse(
        content=metrics.render(samples, collected_at),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


@api_router.get(
    "/metrics",
    response_class=PlainTextResponse,
    tags=["system"],
    summary="Prometheus exposition metrics",
)
def metrics_api(session: SessionDep) -> PlainTextResponse:
    return _render_prometheus_metrics(session)


class ChaosRequest(BaseModel):
    scenario: str


class FreezeRequest(BaseModel):
    frozen: bool
    reason: str | None = None


class GitSyncRequest(BaseModel):
    trigger_dry_run: bool = False


class TelegramTestRequest(BaseModel):
    custom_note: str | None = None


class ClaimOwnerRequest(BaseModel):
    cluster_name: str = "CROC-FABRIC-PROD-01"
    owner_username: str = "owner"
    recovery_key: str | None = None


class RecoverOwnerRequest(BaseModel):
    action: str = "verify"
    recovery_key: str | None = None
    telegram_code: str | None = None


class BootstrapConfigureRequest(BaseModel):
    cluster_name: str | None = None
    exposure_mode: str | None = None
    websocket_enabled: bool | None = None
    github_repo_url: str | None = None
    github_branch: str | None = None
    auto_commit_on_diff: bool | None = None
    github_pat: str | None = None
    github_webhook_secret: str | None = None
    webhook_public_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    ollama_url: str | None = None
    prometheus_url: str | None = None
    llm_cascade: list[dict[str, Any]] | None = None
    bootstrap_completed: bool | None = None


class GitCommitDiffRequest(BaseModel):
    job_id: str


class ServerDiscoverRequest(BaseModel):
    mode: str = "ssh"
    host: str = "5.228.243.54"
    port: int = 221
    username: str = "crocdream"
    password: str | None = None
    switch_password_huawei: str = "admin"
    switch_password_arista: str = "admin"
    switch_password_cisco: str = "admin"


@api_router.get(
    "/auth/me", response_model=ApiPrincipal, tags=["auth"], summary="Текущий пользователь"
)
def current_user(user: Viewer) -> ApiPrincipal:
    return user


@api_router.get(
    "/intent/lint",
    response_model=IntentLintReport,
    tags=["intent"],
    summary="Проверка репозитория intent (pre-flight lint)",
)
def lint_intent(container: ContainerDep, _: Viewer) -> IntentLintReport:
    issues = container.intents.lint()
    return IntentLintReport(
        valid=not issues, issues=[IntentIssueRead.model_validate(issue) for issue in issues]
    )


@api_router.post("/system/chaos", tags=["system"], summary="Simulate network incident")
def inject_chaos(req: ChaosRequest, container: ContainerDep, _: Operator) -> dict[str, str]:
    return execute_chaos_scenario(req.scenario, container)


@api_router.get(
    "/system/freeze",
    tags=["system"],
    summary="Статус экстренной заморозки фабрики (Kill Switch)",
)
def get_freeze_status(_: Viewer) -> dict[str, Any]:
    return get_freeze_state()


@api_router.post(
    "/system/freeze",
    tags=["system"],
    summary="Включение / отключение экстренной заморозки фабрики",
)
def toggle_freeze(req: FreezeRequest, user: Operator) -> dict[str, Any]:
    return set_factory_freeze(req.frozen, req.reason, user.username)


@api_router.get(
    "/git/status",
    tags=["intent"],
    summary="Статус репозитория GitHub / Git SoT и валидации YAML-интентов",
)
def get_git_status(container: ContainerDep, _: Viewer) -> dict[str, Any]:
    git_meta = git_repo_metadata(
        container.settings.intent_repo_path, container.settings.github_repo_url
    )
    issues = container.intents.lint()
    devices_dir = container.settings.intent_repo_path / "devices"
    yaml_count = len(list(devices_dir.glob("*.yaml"))) if devices_dir.is_dir() else 0
    return {
        **git_meta,
        "intent_path": str(container.settings.intent_repo_path),
        "inventory_file": container.settings.inventory_file,
        "yaml_devices_count": yaml_count,
        "valid": not issues,
        "issues_count": len(issues),
    }


@api_router.post(
    "/git/sync",
    tags=["intent"],
    summary="Синхронизировать Git SoT / NetBox с базой данных и опционально запустить Dry-Run",
)
def sync_git_sot(
    session: SessionDep,
    container: ContainerDep,
    user: Operator,
    req: GitSyncRequest | None = None,
) -> dict[str, Any]:
    settings = container.settings
    pull_note = git_pull_repo(settings.intent_repo_path)
    if settings.netbox_url and settings.netbox_token:
        inventory = load_netbox_inventory(
            settings.netbox_url, settings.netbox_token.get_secret_value()
        )
        source_name = "netbox"
    else:
        inventory = container.intents.load_inventory()
        source_name = "git_main"

    sync_res = DeviceService(session).sync_inventory(inventory)
    dry_run_job_id: str | None = None
    if req and req.trigger_dry_run:
        all_ids = [d.id for d in DeviceService(session).list_devices(limit=500)]
        if all_ids:
            job = JobService(session, container.dispatcher).create_dry_run(
                all_ids, IntentSource.GIT_MAIN, requested_by=user.username
            )
            dry_run_job_id = str(job.id)

    git_meta = git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)
    sync_dict = {
        "created": sync_res.created,
        "updated": sync_res.updated,
        "unchanged": sync_res.unchanged,
    }
    return {
        "status": "ok",
        "source": source_name,
        "pull_output": f"{source_name} ({git_meta['branch']}@{git_meta['commit_short']}) [{pull_note}]",
        "sync": sync_dict,
        "git": git_meta,
        **sync_dict,
        "dry_run_job_id": dry_run_job_id,
    }


@api_router.post(
    "/git/commit-diff",
    tags=["intent"],
    summary="Сформировать снапшот Diff задачи, сделать git commit и отправить по SSH (git push)",
)
def commit_diff_to_git(
    req: GitCommitDiffRequest,
    session: SessionDep,
    container: ContainerDep,
    _: Operator,
) -> dict[str, Any]:
    import uuid as _uuid

    settings = container.settings
    rt = settings.apply_runtime_overlay()
    job_svc = JobService(session, container.dispatcher)
    job = job_svc.get_with_diff(_uuid.UUID(req.job_id))
    device_diffs = [
        {
            "hostname": row.hostname,
            "remediation_patch": row.remediation_config or "",
            "intended_config": row.intended_snapshot.content if row.intended_snapshot else "",
        }
        for row in job.targets
    ]
    res = git_commit_and_push_diff(
        settings.intent_repo_path,
        job_id=str(job.id),
        job_type=str(getattr(job.type, "value", job.type)),
        device_diffs=device_diffs,
        branch=str(rt.get("github_branch") or "main"),
        remote_url=str(rt.get("github_repo_url") or settings.github_repo_url),
    )
    return res


@api_router.post(
    "/git/webhook",
    tags=["intent"],
    summary="GitHub Webhook: авто-синхронизация инвентаря БД и префлайт Dry-Run при push в Git",
)
def github_webhook(
    payload: dict[str, Any],
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    ref = str(payload.get("ref") or "refs/heads/main")
    pusher = str((payload.get("pusher") or {}).get("name") or "github-webhook")
    pull_note = git_pull_repo(container.settings.intent_repo_path)
    inventory = container.intents.load_inventory()
    sync_res = DeviceService(session).sync_inventory(inventory)

    all_ids = [d.id for d in DeviceService(session).list_devices(limit=500)]
    job_id: str | None = None
    if all_ids:
        try:
            job = JobService(session, container.dispatcher).create_dry_run(
                all_ids, IntentSource.GIT_MAIN, requested_by=f"github:{pusher}"
            )
            job_id = str(job.id)
        except Exception:
            pass

    send_telegram_message(
        container.settings,
        f"<b>[GitHub SoT Webhook]</b> Обновление <code>{ref}</code> от <b>{pusher}</b>\n"
        f"Git pull: <code>{pull_note}</code>\n"
        f"Синхронизация БД: создано {len(sync_res.created)}, обновлено {len(sync_res.updated)}.\n"
        + (f"Запущен префлайт Dry-Run: <code>{job_id[:8]}</code>" if job_id else ""),
    )
    return {
        "status": "accepted",
        "ref": ref,
        "pusher": pusher,
        "git_pull": pull_note,
        "synced_devices": len(sync_res.created) + len(sync_res.updated) + len(sync_res.unchanged),
        "dry_run_job_id": job_id,
    }


@api_router.get(
    "/system/integrations",
    tags=["system"],
    summary="Сводный статус баз данных, GitHub SoT, NetBox, Prometheus и Telegram-бота",
)
def get_integrations_status(
    session: SessionDep,
    container: ContainerDep,
    _: Viewer,
) -> dict[str, Any]:
    settings = container.settings
    db_url = settings.database_url
    db_engine = "postgresql" if "postgresql" in db_url else "sqlite"

    devices_count = session.scalar(select(func.count(Device.id))) or 0
    jobs_count = session.scalar(select(func.count(Job.id))) or 0
    drift_count = session.scalar(select(func.count(DriftRecord.id))) or 0
    snapshots_count = session.scalar(select(func.count(ConfigSnapshot.id))) or 0
    metrics_count = session.scalar(select(func.count(MetricSample.id))) or 0

    git_meta = git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)
    issues = container.intents.lint()
    tg_targets = resolve_telegram_targets(settings, discover=True)
    tg_configured = bool(settings.telegram_bot_token and tg_targets)
    git_info = {
        **git_meta,
        "valid": not issues,
        "issues_count": len(issues),
    }

    rt_overlay = settings.apply_runtime_overlay()
    if rt_overlay.get("telegram_owner_linked"):
        for cid in tg_targets:
            if str(cid).lstrip("-").isdigit():
                bind_telegram_chat_user(session, int(cid), settings=settings)

    db_users = list(session.scalars(select(User).order_by(User.username)).all())
    for u in db_users:
        ensure_user_token(session, u, settings)

    bound_count = sum(1 for u in db_users if u.bound_client_id is not None)
    counts = {
        "devices": devices_count,
        "jobs": jobs_count,
        "drift_records": drift_count,
        "config_snapshots": snapshots_count,
        "metric_samples": metrics_count,
        "users": len(db_users),
        "bound_sessions": bound_count,
        "bound_device_sessions": bound_count,
    }

    registry = sync_access_registry(session, settings)
    user_tokens = load_user_tokens(settings)
    tg_bindings = load_telegram_bindings(settings)
    all_users = [UserRead.model_validate(u).model_dump(mode="json") for u in db_users]

    return {
        "sessions": all_users,
        "user_tokens": user_tokens,
        "access_registry": registry,
        "security_events": registry.get("security_events", []),
        "database": {
            "engine": db_engine,
            "status": "connected",
            "counts": counts,
            "tables": counts,
        },
        "github_sot": git_info,
        "git_sot": git_info,
        "netbox": {
            "configured": bool(settings.netbox_url and settings.netbox_token),
            "url": settings.netbox_url or None,
            "mode": "NetBox DCIM API"
            if (settings.netbox_url and settings.netbox_token)
            else f"Git SoT + {db_engine.upper()}",
        },
        "prometheus": {
            "configured": bool(settings.prometheus_url),
            "url": settings.prometheus_url or None,
            "scrape_endpoint": "/metrics",
            "collector_interval_sec": settings.metrics_interval_seconds,
            "stored_samples": metrics_count,
        },
        "telegram": {
            "configured": tg_configured,
            "bot_token_set": bool(settings.telegram_bot_token),
            "bot_username": "@Croc_Dream_bot",
            "chat_ids": [int(c) for c in tg_targets if str(c).lstrip("-").isdigit()],
            "chat_ids_count": len(tg_targets),
            "bindings": list(tg_bindings.values()),
            "commands": [
                "/verify",
                "/start",
                "/overview",
                "/status",
                "/drift",
                "/jobs",
                "/metrics",
                "/users",
                "/token",
                "/ttl",
                "/security",
                "/block",
                "/unblock",
                "/role",
                "/unbind",
            ],
        },
    }


@api_router.post(
    "/system/telegram/test",
    tags=["system"],
    summary="Отправить оперативную сводку состояния фабрики в Telegram и вернуть превью",
)
def trigger_telegram_summary(
    session: SessionDep,
    container: ContainerDep,
    _: Operator,
    req: TelegramTestRequest | None = None,
) -> dict[str, Any]:
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    in_sync = sum(1 for d in devices if d.status is DeviceStatus.IN_SYNC)
    drifted = [d.hostname for d in devices if d.status is DeviceStatus.DRIFT_DETECTED]
    unreachable = [d.hostname for d in devices if d.status is DeviceStatus.UNREACHABLE]
    active_sessions = (
        session.scalar(select(func.count(User.id)).where(User.bound_client_id.is_not(None))) or 0
    )
    git_meta = git_repo_metadata(
        container.settings.intent_repo_path, container.settings.github_repo_url
    )

    summary_html = format_executive_summary(
        total_devices=len(devices),
        in_sync=in_sync,
        drifted=drifted,
        unreachable=unreachable,
        active_sessions=active_sessions,
        git_branch=git_meta["branch"],
        git_sha=git_meta["commit_sha"],
    )
    if req and req.custom_note:
        summary_html += f"\n\n<b>Комментарий оператора:</b> {req.custom_note}"

    delivered = send_telegram_message(container.settings, summary_html)
    tg_targets = resolve_telegram_targets(container.settings, discover=False)
    configured = bool(container.settings.telegram_bot_token and tg_targets)
    return {
        "status": "delivered" if delivered else "preview_only",
        "configured": configured,
        "delivered": delivered,
        "sent": delivered,
        "chat_ids": [int(c) for c in tg_targets if str(c).lstrip("-").isdigit()],
        "preview": summary_html,
        "message_preview": summary_html,
        "hint": None
        if delivered
        else "Токен @Croc_Dream_bot подключён! Напишите /start боту @Croc_Dream_bot в Telegram и нажмите кнопку ещё раз для автопривязки чата.",
    }


@api_router.get(
    "/system/bootstrap/status",
    tags=["system"],
    summary="Матрёшка: публичный статус первичной инициализации кластера и всех 4 слоёв",
)
def get_bootstrap_status(
    request: Request,
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    return build_bootstrap_status(request, session, container)


@api_router.post(
    "/system/bootstrap/claim-owner",
    tags=["system"],
    summary="Шаг 1 Матрёшки: выдать себе права Владельца (Owner) и привязать текущий ПК",
)
def claim_owner_bootstrap(
    req: ClaimOwnerRequest,
    request: Request,
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    return claim_owner(req, request, session, container)


@api_router.post(
    "/system/bootstrap/recover-owner",
    tags=["system"],
    summary="Перенос прав Владельца на новый ПК через Telegram-код или Master Recovery Key",
)
def recover_owner_access(
    req: RecoverOwnerRequest,
    request: Request,
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    return recover_owner(req, request, session, container)


@api_router.post(
    "/system/bootstrap/configure",
    tags=["system"],
    summary="Шаг 2 и 3 Матрёшки: сохранить и проверить GitHub SoT, Telegram-бота и ИИ-ключи в общем томе Docker",
)
def configure_bootstrap_layers(
    req: BootstrapConfigureRequest,
    container: ContainerDep,
    session: SessionDep,
) -> dict[str, Any]:
    return configure_layers(req, container, session)


@api_router.post(
    "/system/bootstrap/discover-server",
    tags=["system"],
    summary="Шаг 4 Матрёшки: автономная разведка и распаковка опорного сервера по SSH (контейнеры, свитчи, БД)",
)
def discover_and_attach_server(
    req: ServerDiscoverRequest,
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    return discover_server(req, session, container)


@api_router.post(
    "/ws/ticket",
    tags=["system"],
    summary="Выпуск одноразового 30-секундного билета (Ephemeral Ticket) для авторизации WebSocket",
)
def issue_websocket_ticket(
    request: Request,
    container: ContainerDep,
    user: Viewer,
) -> dict[str, Any]:
    rt = container.settings.apply_runtime_overlay()
    ws_enabled = bool(rt.get("websocket_enabled", False))
    client_id = (request.headers.get("X-Client-Id") or "").strip() or "browser-client"
    client_ip = request.client.host if request.client else "127.0.0.1"

    now = time.time()
    expired = [k for k, v in _ws_tickets.items() if float(v.get("expires_at", 0)) < now]
    for k in expired:
        _ws_tickets.pop(k, None)

    ticket = f"wst_{secrets.token_urlsafe(24)}"
    _ws_tickets[ticket] = {
        "username": user.username,
        "role": user.role.value,
        "client_id": client_id,
        "ip": client_ip,
        "expires_at": now + 30.0,
    }
    return {
        "ticket": ticket,
        "ttl_seconds": 30,
        "websocket_enabled": ws_enabled,
        "ws_path": f"/api/v1/ws/stream?ticket={ticket}",
        "bound_to": {
            "username": user.username,
            "role": user.role.value,
            "client_id": client_id,
            "ip": client_ip,
        },
    }


@api_router.websocket("/ws/stream")
async def websocket_event_stream(
    websocket: WebSocket,
    ticket: str = "",
) -> None:
    now = time.time()
    meta = _ws_tickets.pop(ticket, None) if ticket else None
    if not meta or float(meta.get("expires_at", 0)) < now:
        await websocket.close(code=1008, reason="Invalid or expired one-time WebSocket ticket")
        return

    await websocket.accept()
    try:
        await websocket.send_json(
            {
                "event": "ws_authenticated",
                "username": meta["username"],
                "role": meta["role"],
                "client_id": meta["client_id"],
                "auth_scheme": "ephemeral_one_time_ticket",
                "timestamp": int(now),
            }
        )
        while True:
            msg = await asyncio.wait_for(websocket.receive_text(), timeout=25.0)
            if msg == "ping":
                await websocket.send_json({"event": "pong", "ts": int(time.time())})
    except (WebSocketDisconnect, TimeoutError, Exception):
        return
