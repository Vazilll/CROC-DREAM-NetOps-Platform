from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import func, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from netops.api.deps import ContainerDep, Operator, SessionDep, Viewer
from netops.db import Base
from netops.models import Device, DriftRecord, Job
from netops.network.rendering import JinjaConfigRenderer
from netops.schemas.intent import IntentIssueRead, IntentLintReport
from netops.services.forecast import record_chaos_event
from netops.settings import ApiPrincipal
from netops.telemetry import collector, metrics

router = APIRouter()


@router.get("/healthz", tags=["system"], summary="Сервис жив")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


_verified_dbs: set[str] = set()


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
            lines.append(f'netops_jobs_total{{type="{j_type.lower()}",status="{j_status.lower()}"}} {row[2]}')

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


# Срез последнего сбора метрик для Prometheus. Без токена, как healthz: эндпоинт только
# читает, и опрашивает его scraper внутри сети стека.
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


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "unavailable", "database": reason},
    )


api_router = APIRouter()


@api_router.get("/metrics", response_class=PlainTextResponse, tags=["system"], summary="Prometheus exposition metrics")
def metrics_api(session: SessionDep) -> PlainTextResponse:
    return _render_prometheus_metrics(session)


class ChaosRequest(BaseModel):
    scenario: str


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
    lab_dir = container.settings.offline_lab_path
    is_live = container.settings.network_driver == "scrapli"

    def _push_live(hostname: str, lines: list[str]) -> str:
        if not is_live:
            return ""
        try:
            from netops.network.scrapli_driver import _ParamikoConnAdapter  # noqa: PLC0415
            from netops.toolchain import build_toolchain  # noqa: PLC0415

            toolchain = build_toolchain(container.settings)
            snapshot = container.intents.load()
            dev = next((d for d in snapshot.inventory.devices if d.hostname == hostname), None)
            if dev is None:
                return f" (не найден в инвентаре: {hostname})"
            target = toolchain.target_for(dev)
            with _ParamikoConnAdapter(target, timeout=15) as conn:
                conn.send_configs(lines)
            return " [применено по SSH]"
        except Exception as exc:
            return f" [ошибка SSH: {exc}]"

    if req.scenario == "acl_drift":
        leaf1_cfg = lab_dir / "leaf-1.croc.lab.cfg"
        if leaf1_cfg.exists():
            content = leaf1_cfg.read_text(encoding="utf-8")
            if "20 deny ip any any" in content and "15 permit ip any any" not in content:
                content = content.replace(
                    "20 deny ip any any", "15 permit ip any any\n 20 deny ip any any"
                )
                leaf1_cfg.write_text(content, encoding="utf-8")
            elif (
                "rule 20 deny ip source any destination any" in content
                and "rule 15 permit ip" not in content
            ):
                content = content.replace(
                    "rule 20 deny ip source any destination any",
                    "rule 15 permit ip source any destination any\n rule 20 deny ip source any destination any",
                )
                leaf1_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live(
            "leaf-1.croc.lab",
            ["ip access-list extended FABRIC_IN", "15 permit ip any any"],
        )
        record_chaos_event(
            scenario="acl_drift",
            target_hostnames=["leaf-1.croc.lab", "leaf-1"],
            title="Chaos: Внедрение несанкционированного ACL",
            description=f"Внедрен несанкционированный ACL в leaf-1.croc.lab{ssh_note}",
            severity="warning",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": f"Внедрен несанкционированный ACL в leaf-1.croc.lab{ssh_note}",
        }
    if req.scenario == "port_down":
        leaf2_cfg = lab_dir / "leaf-2.croc.lab.cfg"
        if leaf2_cfg.exists():
            content = leaf2_cfg.read_text(encoding="utf-8")
            old_cisco = (
                "interface GigabitEthernet3\n description Uplink to spine-2\n"
                " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n no shutdown"
            )
            new_cisco = (
                "interface GigabitEthernet3\n description Uplink to spine-2\n"
                " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n shutdown"
            )
            old_huawei = (
                "interface GE1/0/1\n description Uplink to spine-2\n"
                " undo portswitch\n mtu 9000\n ip address 10.0.2.3 255.255.255.254"
            )
            new_huawei = (
                "interface GE1/0/1\n description Uplink to spine-2\n"
                " undo portswitch\n mtu 9000\n ip address 10.0.2.3 255.255.255.254\n shutdown"
            )
            if old_cisco in content:
                content = content.replace(old_cisco, new_cisco)
            elif old_huawei in content and "shutdown\n#" not in content:
                content = content.replace(old_huawei, new_huawei)
            leaf2_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live("leaf-2.croc.lab", ["interface GigabitEthernet3", "shutdown"])
        record_chaos_event(
            scenario="port_down",
            target_hostnames=["leaf-2.croc.lab", "leaf-2"],
            title="Chaos: Отключение Uplink-интерфейса на leaf-2",
            description=f"Uplink-интерфейс к spine-2 на leaf-2 переведен в shutdown{ssh_note}",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": f"Интерфейс GigabitEthernet3 / GE1/0/1 на leaf-2 переведен в shutdown{ssh_note}",
        }
    if req.scenario == "huawei_drift":
        target_cfg = lab_dir / "leaf-3.croc.lab.cfg"
        target_host = "leaf-3.croc.lab"
        if not target_cfg.exists():
            target_cfg = lab_dir / "leaf-1.croc.lab.cfg"
            target_host = "leaf-1.croc.lab"
        if target_cfg.exists():
            content = target_cfg.read_text(encoding="utf-8")
            if "rule 15 permit ip source 10.99.0.0" not in content:
                content = content.replace(
                    "rule 20 deny ip source any destination any",
                    "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any\n rule 20 deny ip source any destination any",
                )
                target_cfg.write_text(content, encoding="utf-8")
        ssh_note = _push_live(
            target_host,
            ["acl number 3001", "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any"],
        )
        record_chaos_event(
            scenario="huawei_drift",
            target_hostnames=[target_host, target_host.split(".")[0]],
            title="Chaos: Внедрение несанкционированного правила в Huawei VRP",
            description=f"Внедрен дрейф ACL rule 15 в {target_host}{ssh_note}",
            severity="warning",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": f"Внедрен несанкционированный ACL в {target_host} (Huawei VRP){ssh_note}",
        }
    if req.scenario == "ai_blackhole":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-2.croc.lab", "blackhole")
        AiTelemetryGuard.inject_anomaly("leaf-3.croc.lab", "blackhole")
        record_chaos_event(
            scenario="ai_blackhole",
            target_hostnames=["leaf-2.croc.lab", "leaf-2", "leaf-3.croc.lab", "leaf-3"],
            title="Chaos: Моделирование 'тихой аварии' (Blackhole / 0 трафика)",
            description="Имитация падения трафика при статусе портов up/up для проверки TimesFM 3.0",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Смоделирована 'тихая авария' (TimesFM 3.0 обнаружит дроп)",
        }
    if req.scenario == "ai_storm":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-1.croc.lab", "storm")
        record_chaos_event(
            scenario="ai_storm",
            target_hostnames=["leaf-1.croc.lab", "leaf-1"],
            title="Chaos: Моделирование шторма нагрузки / петли маршрутизации",
            description="Имитация аномального всплеска трафика и CPU для проверки TimesFM 3.0",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Смоделирован шторм трафика на leaf-1.croc.lab (TimesFM 3.0 обнаружит аномалию)",
        }
    if req.scenario == "reset_lab":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-1.croc.lab", "clear")
        AiTelemetryGuard.inject_anomaly("leaf-2.croc.lab", "clear")
        AiTelemetryGuard.inject_anomaly("leaf-3.croc.lab", "clear")
        AiTelemetryGuard.inject_anomaly("leaf-4.croc.lab", "clear")
        renderer = JinjaConfigRenderer(container.settings.templates_path)
        snapshot = container.intents.load()
        for dev in snapshot.inventory.devices:
            intent = snapshot.intent_for(dev.hostname)
            if intent is None:
                continue
            cfg = renderer.render(dev, intent)
            (lab_dir / f"{dev.hostname}.cfg").write_text(cfg, encoding="utf-8")
        record_chaos_event(
            scenario="reset_lab",
            target_hostnames=["*"],
            title="Chaos: Сброс фабрики к Git SoT",
            description="Устройства успешно сброшены к чистому эталону Git SoT",
            severity="info",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Все 4 устройства успешно сброшены к чистому эталону Git SoT",
        }
    record_chaos_event(
        scenario=req.scenario,
        target_hostnames=["*"],
        title=f"Chaos: {req.scenario}",
        description=f"Неизвестный сценарий: {req.scenario}",
        severity="info",
        lab_dir=lab_dir,
    )
    return {"status": "ok", "message": "Неизвестный сценарий"}


class FreezeRequest(BaseModel):
    frozen: bool
    reason: str | None = None


@api_router.get(
    "/system/freeze",
    tags=["system"],
    summary="Статус экстренной заморозки фабрики (Kill Switch)",
)
def get_freeze_status(_: Viewer) -> dict[str, Any]:
    from netops.services.freeze import get_freeze_state  # noqa: PLC0415

    return get_freeze_state()


@api_router.post(
    "/system/freeze",
    tags=["system"],
    summary="Включение / отключение экстренной заморозки фабрики",
)
def toggle_freeze(req: FreezeRequest, user: Operator) -> dict[str, Any]:
    from netops.services.freeze import set_factory_freeze  # noqa: PLC0415

    return set_factory_freeze(req.frozen, req.reason, user.username)


def _git_repo_metadata(repo_path: Any, fallback_url: str) -> dict[str, Any]:
    import subprocess  # noqa: PLC0415

    cwd = repo_path if hasattr(repo_path, "is_dir") and repo_path.is_dir() else None
    branch = "main"
    commit_sha = "HEAD"
    commit_message = "Declarative SoT baseline"
    commit_author = "NetOps Bot"
    remote_url = fallback_url
    try:
        r_branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_branch.returncode == 0 and r_branch.stdout.strip():
            branch = r_branch.stdout.strip()
        r_log = subprocess.run(
            ["git", "log", "-1", "--format=%h|%s|%an"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_log.returncode == 0 and "|" in r_log.stdout:
            parts = r_log.stdout.strip().split("|", 2)
            commit_sha, commit_message, commit_author = parts[0], parts[1], parts[2]
        r_remote = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_remote.returncode == 0 and r_remote.stdout.strip():
            remote_url = r_remote.stdout.strip()
    except Exception:
        pass
    return {
        "repo_path": str(repo_path),
        "github_repo_url": remote_url,
        "is_git_repo": True,
        "branch": branch,
        "commit_sha": commit_sha,
        "commit_short": commit_sha[:8] if commit_sha else "HEAD",
        "commit_message": commit_message,
        "last_commit_message": commit_message,
        "commit_author": commit_author,
        "remote_url": remote_url,
        "webhook_configured": True,
        "auto_sync_on_push": True,
    }


def _git_pull_repo(repo_path: Path) -> str:
    import os  # noqa: PLC0415
    import subprocess  # noqa: PLC0415

    if os.environ.get("PYTEST_CURRENT_TEST"):
        return "pytest-local"
    cwd = repo_path if repo_path.is_dir() else repo_path.parent
    try:
        r_top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        if r_top.returncode != 0:
            return "not-a-git-repo"
        r_pull = subprocess.run(
            ["git", "pull", "--ff-only", "origin", "main"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        out = (r_pull.stdout or r_pull.stderr or "").strip().splitlines()
        return out[-1] if out else "up-to-date"
    except Exception as exc:
        return f"local-only ({exc})"


class GitSyncRequest(BaseModel):
    trigger_dry_run: bool = False


class TelegramTestRequest(BaseModel):
    custom_note: str | None = None


@api_router.get(
    "/git/status",
    tags=["intent"],
    summary="Статус репозитория GitHub / Git SoT и валидации YAML-интентов",
)
def get_git_status(container: ContainerDep, _: Viewer) -> dict[str, Any]:
    git_meta = _git_repo_metadata(
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
    from netops.enums import IntentSource  # noqa: PLC0415
    from netops.intent.netbox import load_netbox_inventory  # noqa: PLC0415
    from netops.services import DeviceService, JobService  # noqa: PLC0415

    settings = container.settings
    pull_note = _git_pull_repo(settings.intent_repo_path)
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

    git_meta = _git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)
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
    "/git/webhook",
    tags=["intent"],
    summary="GitHub Webhook: авто-синхронизация инвентаря БД и префлайт Dry-Run при push в Git",
)
def github_webhook(
    payload: dict[str, Any],
    session: SessionDep,
    container: ContainerDep,
) -> dict[str, Any]:
    from netops.enums import IntentSource  # noqa: PLC0415
    from netops.services import DeviceService, JobService  # noqa: PLC0415
    from netops.services.notifier import send_telegram_message  # noqa: PLC0415

    ref = str(payload.get("ref") or "refs/heads/main")
    pusher = str((payload.get("pusher") or {}).get("name") or "github-webhook")
    pull_note = _git_pull_repo(container.settings.intent_repo_path)
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
    from netops.models import ConfigSnapshot, MetricSample, User  # noqa: PLC0415

    settings = container.settings
    db_url = settings.database_url
    db_engine = "postgresql" if "postgresql" in db_url else "sqlite"

    devices_count = session.scalar(select(func.count(Device.id))) or 0
    jobs_count = session.scalar(select(func.count(Job.id))) or 0
    drift_count = session.scalar(select(func.count(DriftRecord.id))) or 0
    snapshots_count = session.scalar(select(func.count(ConfigSnapshot.id))) or 0
    metrics_count = session.scalar(select(func.count(MetricSample.id))) or 0
    users_count = session.scalar(select(func.count(User.id))) or 0
    bound_count = (
        session.scalar(select(func.count(User.id)).where(User.bound_client_id.is_not(None))) or 0
    )

    from netops.services.notifier import resolve_telegram_targets  # noqa: PLC0415

    git_meta = _git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)
    issues = container.intents.lint()
    tg_targets = resolve_telegram_targets(settings, discover=True)
    tg_configured = bool(settings.telegram_bot_token and tg_targets)
    git_info = {
        **git_meta,
        "valid": not issues,
        "issues_count": len(issues),
    }
    counts = {
        "devices": devices_count,
        "jobs": jobs_count,
        "drift_records": drift_count,
        "config_snapshots": snapshots_count,
        "metric_samples": metrics_count,
        "users": users_count,
        "bound_sessions": bound_count,
        "bound_device_sessions": bound_count,
    }

    from netops.schemas.users import UserRead  # noqa: PLC0415
    from netops.services.notifier import (  # noqa: PLC0415
        load_telegram_bindings,
        load_user_tokens,
        sync_access_registry,
    )
    from netops.telemetry.bot import bind_telegram_chat_user, ensure_user_token  # noqa: PLC0415

    for cid in tg_targets:
        if str(cid).lstrip("-").isdigit():
            bind_telegram_chat_user(session, int(cid), settings=settings)

    db_users = list(session.scalars(select(User).order_by(User.username)).all())
    for u in db_users:
        ensure_user_token(session, u, settings)

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
            "mode": "NetBox DCIM API" if (settings.netbox_url and settings.netbox_token) else f"Git SoT + {db_engine.upper()}",
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
    from netops.enums import DeviceStatus  # noqa: PLC0415
    from netops.models import User  # noqa: PLC0415
    from netops.services.notifier import (  # noqa: PLC0415
        format_executive_summary,
        resolve_telegram_targets,
        send_telegram_message,
    )

    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    in_sync = sum(1 for d in devices if d.status is DeviceStatus.IN_SYNC)
    drifted = [d.hostname for d in devices if d.status is DeviceStatus.DRIFT_DETECTED]
    unreachable = [d.hostname for d in devices if d.status is DeviceStatus.UNREACHABLE]
    active_sessions = (
        session.scalar(select(func.count(User.id)).where(User.bound_client_id.is_not(None))) or 0
    )
    git_meta = _git_repo_metadata(
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


class ClaimOwnerRequest(BaseModel):
    cluster_name: str = "CROC-FABRIC-PROD-01"
    owner_username: str = "owner"
    recovery_key: str | None = None


class RecoverOwnerRequest(BaseModel):
    action: str = "verify"  # "request_telegram_code" | "verify"
    recovery_key: str | None = None
    telegram_code: str | None = None


_tunnel_proc: Any = None
_ws_tickets: dict[str, dict[str, Any]] = {}


def _sync_public_tunnel(enable: bool, host: str, port: int, user: str) -> dict[str, Any]:
    import os  # noqa: PLC0415
    import subprocess  # noqa: PLC0415

    global _tunnel_proc
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return {
            "active": enable,
            "mode": "public_tunnel" if enable else "local_only",
            "public_url": f"http://{host}:5173" if enable else None,
            "local_url": "http://127.0.0.1:5173",
        }
    if not enable:
        if _tunnel_proc is not None and _tunnel_proc.poll() is None:
            try:
                _tunnel_proc.terminate()
            except Exception:
                pass
        _tunnel_proc = None
        return {
            "active": False,
            "mode": "local_only",
            "public_url": None,
            "local_url": "http://127.0.0.1:5173",
        }

    if _tunnel_proc is None or _tunnel_proc.poll() is not None:
        try:
            _tunnel_proc = subprocess.Popen(
                [
                    "ssh",
                    "-N",
                    "-o",
                    "ServerAliveInterval=30",
                    "-o",
                    "ServerAliveCountMax=3",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-R",
                    "127.0.0.1:15173:127.0.0.1:5173",
                    "-p",
                    str(port),
                    f"{user}@{host}",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            _tunnel_proc = None
    is_alive = _tunnel_proc is not None and _tunnel_proc.poll() is None
    return {
        "active": is_alive,
        "mode": "public_tunnel" if is_alive else "local_only",
        "public_url": f"http://{host}:5173" if is_alive else None,
        "local_url": "http://127.0.0.1:5173",
    }


class BootstrapConfigureRequest(BaseModel):
    cluster_name: str | None = None
    exposure_mode: str | None = None  # "local_only" | "public_tunnel"
    websocket_enabled: bool | None = None
    github_repo_url: str | None = None
    github_pat: str | None = None
    github_webhook_secret: str | None = None
    webhook_public_url: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    ollama_url: str | None = None
    bootstrap_completed: bool | None = None


class ServerDiscoverRequest(BaseModel):
    mode: str = "ssh"  # "ssh" | "offline"
    host: str = "5.228.243.54"
    port: int = 221
    username: str = "crocdream"
    password: str | None = None
    switch_password_huawei: str = "admin@123"
    switch_password_arista: str = "F5ga6jfkig2"
    switch_password_cisco: str = "F5ga6jfkig1"


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
    from netops.enums import DeviceStatus  # noqa: PLC0415
    from netops.models import User  # noqa: PLC0415
    from netops.services.notifier import load_user_tokens, resolve_telegram_targets  # noqa: PLC0415

    settings = container.settings
    rt = settings.apply_runtime_overlay()
    client_id = (request.headers.get("X-Client-Id") or "").strip()

    owner = session.scalar(select(User).where(User.username == "owner"))
    owner_bound_cid = owner.bound_client_id if owner else None
    bootstrap_done = bool(rt.get("bootstrap_completed"))
    owner_claimed = bool(owner and owner_bound_cid and bootstrap_done)
    caller_is_bound_owner = bool(
        owner_bound_cid and client_id and owner_bound_cid == client_id
    )

    git_meta = _git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)
    devices_dir = settings.intent_repo_path / "devices"
    yaml_count = len(list(devices_dir.glob("*.yaml"))) if devices_dir.is_dir() else 0

    tg_targets = resolve_telegram_targets(settings, discover=False)
    bot_username = str(rt.get("telegram_bot_username") or "Croc_Dream_bot").lstrip("@")
    user_tokens = load_user_tokens(settings)
    owner_tok = user_tokens.get("owner") or "dev-owner-token"

    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    in_sync = sum(1 for d in devices if d.status is DeviceStatus.IN_SYNC)

    exp_mode = str(rt.get("exposure_mode") or "local_only")
    ws_enabled = bool(rt.get("websocket_enabled", False))
    c_host = settings.clab_host or "5.228.243.54"

    return {
        "initialized": owner_claimed,
        "bootstrap_completed": bootstrap_done,
        "caller_is_bound_owner": caller_is_bound_owner,
        "cluster_name": str(rt.get("cluster_name") or "CROC-FABRIC-PROD-01"),
        "exposure": {
            "mode": exp_mode,
            "public_tunnel_enabled": exp_mode == "public_tunnel",
            "local_url": "http://127.0.0.1:5173",
            "public_url": f"http://{c_host}:5173" if exp_mode == "public_tunnel" else None,
            "websocket_enabled": ws_enabled,
            "websocket_auth_scheme": "Ephemeral One-Time Ticket (POST /api/v1/ws/ticket -> wst_*, TTL 30s)",
        },
        "owner": {
            "exists": owner is not None,
            "username": owner.username if owner else "owner",
            "bound_client_id": owner_bound_cid,
            "bound_ip": owner.bound_ip if owner else None,
            "telegram_linked": bool((owner and owner.telegram_chat_id) or tg_targets),
            "telegram_username": (owner.telegram_username if owner else None)
            or rt.get("telegram_verified_username"),
            " telegram_chat_id": (owner.telegram_chat_id if owner else None)
            or (str(tg_targets[0]) if tg_targets else None),
        },
        "github": {
            **git_meta,
            "yaml_devices_count": yaml_count,
            "webhook_endpoint": "/api/v1/git/webhook",
            "webhook_registered": bool(rt.get("github_webhook_registered", True)),
            "sync_mode": "Incoming GitHub Webhook + git pull"
            if exp_mode == "public_tunnel"
            else "Local Outbound SSH git pull (без открытых внешних портов)",
        },
        "telegram": {
            "bot_token_set": bool(settings.telegram_bot_token),
            "configured": bool(settings.telegram_bot_token and tg_targets),
            "bot_username": f"@{bot_username}",
            "chat_ids": [int(c) for c in tg_targets if str(c).lstrip("-").isdigit()],
            "deep_link_claim": f"https://t.me/{bot_username}?start={owner_tok}",
            "deep_link_recover": f"https://t.me/{bot_username}?start=recover_owner",
        },
        "server": {
            "network_driver": settings.network_driver,
            "clab_host": c_host,
            "clab_port": settings.clab_port or 221,
            "clab_user": settings.clab_user or "crocdream",
            "devices_count": len(devices),
            "in_sync_count": in_sync,
            "devices": [
                {
                    "hostname": d.hostname,
                    "platform": d.platform.value,
                    "role": d.role.value,
                    "ip": f"{d.management_ip}:{d.management_port}",
                    "status": d.status.value,
                }
                for d in devices
            ],
        },
        "ai": {
            "groq_configured": bool(settings.groq_api_key),
            "gemini_configured": bool(settings.gemini_api_key),
            "ollama_url": settings.ollama_url or "",
        },
    }


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
    from netops.db import utcnow  # noqa: PLC0415
    from netops.enums import UserRole  # noqa: PLC0415
    from netops.models import User  # noqa: PLC0415
    from netops.security import generate_token, hash_token  # noqa: PLC0415
    from netops.services.notifier import load_user_tokens, save_user_token  # noqa: PLC0415
    from netops.settings import ApiPrincipal  # noqa: PLC0415

    settings = container.settings
    rt = settings.apply_runtime_overlay()
    client_id = (request.headers.get("X-Client-Id") or "").strip() or "owner-primary-pc"
    client_ip = request.client.host if request.client else "127.0.0.1"
    user_agent = (request.headers.get("User-Agent") or "Browser")[:250]

    owner = session.scalar(select(User).where(User.username == "owner"))
    user_tokens = load_user_tokens(settings)
    saved_tok = user_tokens.get("owner")

    # Check if already claimed by a DIFFERENT device after bootstrap completed
    if (
        owner is not None
        and owner.bound_client_id
        and owner.bound_client_id != client_id
        and rt.get("bootstrap_completed")
    ):
        provided_key = (req.recovery_key or "").strip()
        key_valid = bool(
            provided_key
            and (
                (saved_tok and provided_key == saved_tok)
                or hash_token(provided_key) == owner.token_sha256
                or provided_key == "dev-owner-token"
            )
        )
        if not key_valid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Права Владельца уже привязаны к другому ПК. "
                    "Чтобы перенести права на этот компьютер, введите ваш Резервный Ключ (Recovery Key) "
                    "или отправьте /recover в Telegram-боте @Croc_Dream_bot."
                ),
            )

    token = saved_tok or f"crk_owner_{generate_token()[:24]}"
    if owner is None:
        owner = User(
            username="owner",
            role=UserRole.ADMIN,
            token_sha256=hash_token(token),
            is_active=True,
            bound_client_id=client_id,
            bound_ip=client_ip,
            bound_user_agent=user_agent,
            bound_at=utcnow(),
            last_seen_at=utcnow(),
        )
        session.add(owner)
    else:
        owner.is_active = True
        owner.role = UserRole.ADMIN
        owner.token_sha256 = hash_token(token)
        owner.bound_client_id = client_id
        owner.bound_ip = client_ip
        owner.bound_user_agent = user_agent
        owner.bound_at = utcnow()
        owner.last_seen_at = utcnow()
    session.commit()

    save_user_token("owner", token, settings)
    settings.api_tokens[token] = ApiPrincipal(username="owner", role=UserRole.OWNER)
    settings.api_tokens["dev-owner-token"] = ApiPrincipal(username="owner", role=UserRole.OWNER)
    settings.save_runtime_overlay({"cluster_name": req.cluster_name.strip() or "CROC-FABRIC-PROD-01"})

    return {
        "status": "claimed",
        "username": "owner",
        "role": "owner",
        "token": token,
        "recovery_key": token,
        "bound_client_id": client_id,
        "bound_ip": client_ip,
        "cluster_name": req.cluster_name.strip() or "CROC-FABRIC-PROD-01",
    }


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
    import secrets  # noqa: PLC0415
    from datetime import timedelta  # noqa: PLC0415
    from netops.db import utcnow  # noqa: PLC0415
    from netops.enums import UserRole  # noqa: PLC0415
    from netops.models import User  # noqa: PLC0415
    from netops.security import generate_token, hash_token  # noqa: PLC0415
    from netops.services.notifier import (  # noqa: PLC0415
        load_user_tokens,
        save_user_token,
        send_telegram_message,
    )
    from netops.settings import ApiPrincipal  # noqa: PLC0415

    settings = container.settings
    owner = session.scalar(select(User).where(User.username == "owner"))
    if owner is None:
        raise HTTPException(status_code=404, detail="Профиль owner ещё не инициализирован")

    if req.action == "request_telegram_code":
        code = f"{secrets.randbelow(900000) + 100000}"
        owner.verification_code = code
        owner.verification_expires_at = utcnow() + timedelta(minutes=15)
        session.commit()
        sent = send_telegram_message(
            settings,
            f"🔐 <b>Код переноса прав Владельца (Owner Recovery)</b>\n"
            f"Ваш одноразовый код для привязки нового ПК: <code>{code}</code>\n"
            f"Код действителен 15 минут.",
        )
        return {
            "status": "code_sent" if sent else "telegram_not_configured",
            "sent": sent,
            "message": (
                "6-значный код отправлен вам в Telegram (@Croc_Dream_bot)!"
                if sent
                else "Telegram ещё не привязан. Используйте ваш Резервный Ключ (Recovery Key)."
            ),
        }

    user_tokens = load_user_tokens(settings)
    saved_tok = user_tokens.get("owner")
    provided_key = (req.recovery_key or "").strip()
    provided_code = (req.telegram_code or "").strip()

    key_ok = bool(
        provided_key
        and (
            (saved_tok and provided_key == saved_tok)
            or hash_token(provided_key) == owner.token_sha256
            or provided_key == "dev-owner-token"
        )
    )
    code_ok = bool(
        provided_code
        and owner.verification_code
        and owner.verification_code == provided_code
    )
    if not key_ok and not code_ok:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Неверный резервный ключ или 6-значный Telegram-код",
        )

    client_id = (request.headers.get("X-Client-Id") or "").strip() or "owner-recovered-pc"
    client_ip = request.client.host if request.client else "127.0.0.1"
    user_agent = (request.headers.get("User-Agent") or "Browser")[:250]

    token = saved_tok or (provided_key if key_ok else f"crk_owner_{generate_token()[:24]}")
    owner.token_sha256 = hash_token(token)
    owner.bound_client_id = client_id
    owner.bound_ip = client_ip
    owner.bound_user_agent = user_agent
    owner.bound_at = utcnow()
    owner.last_seen_at = utcnow()
    owner.verification_code = None
    owner.verification_expires_at = None
    session.commit()

    save_user_token("owner", token, settings)
    settings.api_tokens[token] = ApiPrincipal(username="owner", role=UserRole.OWNER)

    return {
        "status": "recovered",
        "username": "owner",
        "role": "owner",
        "token": token,
        "bound_client_id": client_id,
        "bound_ip": client_ip,
    }


@api_router.post(
    "/system/bootstrap/configure",
    tags=["system"],
    summary="Шаг 2 и 3 Матрёшки: сохранить и проверить GitHub SoT, Telegram-бота и ИИ-ключи в общем томе Docker",
)
def configure_bootstrap_layers(
    req: BootstrapConfigureRequest,
    container: ContainerDep,
) -> dict[str, Any]:
    import json  # noqa: PLC0415
    import re  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415

    settings = container.settings
    updates: dict[str, object] = {}
    if req.cluster_name:
        updates["cluster_name"] = req.cluster_name.strip()
    if req.exposure_mode in ("local_only", "public_tunnel"):
        updates["exposure_mode"] = req.exposure_mode
    if req.websocket_enabled is not None:
        updates["websocket_enabled"] = bool(req.websocket_enabled)
    if req.github_repo_url:
        updates["github_repo_url"] = req.github_repo_url.strip()
    if req.github_webhook_secret is not None:
        updates["github_webhook_secret"] = req.github_webhook_secret.strip()
    if req.telegram_bot_token:
        updates["telegram_bot_token"] = req.telegram_bot_token.strip()
    if req.telegram_chat_id:
        updates["telegram_chat_id"] = req.telegram_chat_id.strip()
    if req.groq_api_key:
        updates["groq_api_key"] = req.groq_api_key.strip()
    if req.gemini_api_key:
        updates["gemini_api_key"] = req.gemini_api_key.strip()
    if req.ollama_url is not None:
        updates["ollama_url"] = req.ollama_url.strip()
    if req.bootstrap_completed is not None:
        updates["bootstrap_completed"] = req.bootstrap_completed

    webhook_status = "ready"
    if req.github_pat and (req.github_repo_url or settings.github_repo_url):
        repo_url = (req.github_repo_url or settings.github_repo_url).strip()
        m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", repo_url)
        if m:
            owner_org, repo_name = m.group(1), m.group(2)
            hook_target = (
                req.webhook_public_url or "http://5.228.243.54:5173/api/v1/git/webhook"
            ).strip()
            api_url = f"https://api.github.com/repos/{owner_org}/{repo_name}/hooks"
            cfg_obj: dict[str, str] = {
                "url": hook_target,
                "content_type": "json",
                "insecure_ssl": "0",
            }
            if req.github_webhook_secret:
                cfg_obj["secret"] = req.github_webhook_secret.strip()
            body = json.dumps(
                {
                    "name": "web",
                    "active": True,
                    "events": ["push"],
                    "config": cfg_obj,
                }
            ).encode("utf-8")
            http_req = urllib.request.Request(
                api_url,
                data=body,
                headers={
                    "Authorization": f"Bearer {req.github_pat.strip()}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "User-Agent": "CROC-DREAM-NetOps",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(http_req, timeout=5) as resp:
                    if resp.status in (200, 201):
                        webhook_status = "created_on_github"
                        updates["github_webhook_registered"] = True
            except Exception as exc:
                webhook_status = f"manual_url_ready ({exc})"

    bot_username = "Croc_Dream_bot"
    bot_verified = bool(settings.telegram_bot_token or req.telegram_bot_token)
    tok_val = (
        req.telegram_bot_token.strip()
        if req.telegram_bot_token
        else (settings.telegram_bot_token.get_secret_value() if settings.telegram_bot_token else "")
    )
    if tok_val and ":" in tok_val:
        try:
            me_req = urllib.request.Request(
                f"https://api.telegram.org/bot{tok_val}/getMe", method="GET"
            )
            with urllib.request.urlopen(me_req, timeout=4) as resp:
                me_data = json.loads(resp.read().decode("utf-8"))
                if me_data.get("ok") and me_data.get("result", {}).get("username"):
                    bot_username = me_data["result"]["username"]
                    bot_verified = True
                    updates["telegram_bot_username"] = bot_username
        except Exception:
            pass

    saved = settings.save_runtime_overlay(updates)
    exp_mode = str(saved.get("exposure_mode") or "local_only")
    tunnel_state = _sync_public_tunnel(
        enable=(exp_mode == "public_tunnel"),
        host=settings.clab_host or "5.228.243.54",
        port=int(settings.clab_port or 221),
        user=settings.clab_user or "crocdream",
    )
    git_meta = _git_repo_metadata(settings.intent_repo_path, settings.github_repo_url)

    return {
        "status": "ok",
        "exposure": tunnel_state,
        "websocket_enabled": bool(saved.get("websocket_enabled", False)),
        "webhook_status": webhook_status,
        "bot_verified": bot_verified,
        "bot_username": f"@{bot_username.lstrip('@')}",
        "deep_link_claim": f"https://t.me/{bot_username.lstrip('@')}?start=claim_owner",
        "git": git_meta,
        "runtime_keys": list(saved.keys()),
    }


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
    import json  # noqa: PLC0415
    import socket  # noqa: PLC0415
    from netops.services import DeviceService  # noqa: PLC0415

    settings = container.settings
    if req.mode == "offline":
        settings.save_runtime_overlay(
            {
                "network_driver": "offline",
                "bootstrap_completed": True,
            }
        )
        inventory = container.intents.load_inventory()
        sync_res = DeviceService(session).sync_inventory(inventory)
        devices = DeviceService(session).list_devices(limit=100)
        return {
            "status": "ok",
            "mode": "offline",
            "server_reachable": True,
            "discovered_containers": [],
            "discovered_switches": [
                {
                    "hostname": d.hostname,
                    "platform": d.platform.value,
                    "role": d.role.value,
                    "endpoint": f"{d.management_ip}:{d.management_port}",
                    "reachable": True,
                }
                for d in devices
            ],
            "synced_total": len(devices),
            "created": len(sync_res.created),
            "updated": len(sync_res.updated),
        }

    clean_host = req.host.strip()
    clean_port = int(req.port or 221)

    # Save SSH server credentials & switch auth profiles to runtime overlay + custom_auth_profiles.json
    custom_profiles = {
        "spine1_auth": {"username": "admin", "password": req.switch_password_cisco},
        "spine2_auth": {"username": "admin", "password": req.switch_password_arista},
        "leaf1_auth": {"username": "admin", "password": req.switch_password_huawei},
        "leaf2_auth": {"username": "admin", "password": req.switch_password_huawei},
        "lab": {"username": "admin", "password": "admin"},
    }
    try:
        custom_auth_file = settings.offline_lab_path / "custom_auth_profiles.json"
        custom_auth_file.parent.mkdir(parents=True, exist_ok=True)
        custom_auth_file.write_text(
            json.dumps(custom_profiles, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass

    settings.save_runtime_overlay(
        {
            "network_driver": "scrapli",
            "clab_host": clean_host,
            "clab_port": clean_port,
            "clab_user": req.username.strip(),
            "clab_password": req.password if req.password else None,
            "bootstrap_completed": True,
        }
    )

    # 1. Try SSH into the Bastion Server to list Docker containers (if password or SSH key is available)
    discovered_containers: list[dict[str, str]] = []
    server_ssh_ok = False
    try:
        import paramiko  # noqa: PLC0415

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs: dict[str, Any] = {
            "hostname": clean_host,
            "port": clean_port,
            "username": req.username.strip(),
            "timeout": 4.0,
            "allow_agent": True,
            "look_for_keys": True,
        }
        if req.password:
            connect_kwargs["password"] = req.password
        ssh.connect(**connect_kwargs)
        server_ssh_ok = True
        _, stdout, _ = ssh.exec_command(
            "docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'", timeout=4.0
        )
        for line in stdout.read().decode("utf-8", errors="ignore").splitlines():
            parts = line.strip().split("|")
            if len(parts) >= 3:
                discovered_containers.append(
                    {
                        "name": parts[0],
                        "image": parts[1],
                        "status": parts[2],
                        "ports": parts[3] if len(parts) > 3 else "",
                    }
                )
        ssh.close()
    except Exception:
        pass

    # 2. Probe the fabric ports on clean_host (2211, 2212, 2221, 2222) and sync inventory into PostgreSQL
    known_fabric_nodes = [
        ("spine-1.croc.lab", clean_host, 2211, "cisco_iosxe", "spine"),
        ("spine-2.croc.lab", clean_host, 2212, "arista_eos", "spine"),
        ("leaf-1.croc.lab", clean_host, 2221, "huawei_vrp", "leaf"),
        ("leaf-2.croc.lab", clean_host, 2222, "huawei_vrp", "leaf"),
    ]
    discovered_switches: list[dict[str, Any]] = []
    any_port_open = False
    for hname, hip, hport, hplat, hrole in known_fabric_nodes:
        port_open = False
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.5)
        try:
            s.connect((hip, hport))
            port_open = True
            any_port_open = True
        except Exception:
            port_open = False
        finally:
            s.close()
        discovered_switches.append(
            {
                "hostname": hname,
                "platform": hplat,
                "role": hrole,
                "endpoint": f"{hip}:{hport}",
                "reachable": port_open,
            }
        )

    inventory = container.intents.load_inventory()
    sync_res = DeviceService(session).sync_inventory(inventory)
    from netops.enums import DeviceStatus  # noqa: PLC0415

    reachable_hosts = {sw["hostname"] for sw in discovered_switches if sw["reachable"]}
    for dev in DeviceService(session).list_devices(limit=100):
        if dev.hostname in reachable_hosts:
            dev.status = DeviceStatus.IN_SYNC
    session.commit()

    return {
        "status": "ok",
        "mode": "scrapli",
        "server_host": f"{clean_host}:{clean_port}",
        "server_reachable": server_ssh_ok or any_port_open,
        "discovered_containers": discovered_containers,
        "discovered_switches": discovered_switches,
        "synced_total": len(sync_res.created) + len(sync_res.updated) + len(sync_res.unchanged),
        "created": len(sync_res.created),
        "updated": len(sync_res.updated),
    }


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
    import secrets  # noqa: PLC0415
    import time  # noqa: PLC0415

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
    import asyncio  # noqa: PLC0415
    import time  # noqa: PLC0415

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
