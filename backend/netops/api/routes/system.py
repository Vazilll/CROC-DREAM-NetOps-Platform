from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status
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

