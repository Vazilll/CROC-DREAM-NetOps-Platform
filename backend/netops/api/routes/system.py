from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from netops.api.deps import ContainerDep, SessionDep, Viewer
from netops.db import Base
from netops.network.rendering import JinjaConfigRenderer
from netops.schemas.intent import IntentIssueRead, IntentLintReport
from netops.services.forecast import record_chaos_event
from netops.settings import ApiPrincipal

router = APIRouter()


@router.get("/healthz", tags=["system"], summary="Сервис жив")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", tags=["system"], summary="Готовность: база доступна и миграции применены")
def readiness(session: SessionDep) -> JSONResponse:
    try:
        existing = set(inspect(session.connection()).get_table_names())
    except SQLAlchemyError:
        return _unavailable("unreachable")
    if not set(Base.metadata.tables) <= existing:
        return _unavailable("migrations not applied")
    return JSONResponse(content={"status": "ok", "database": "ok"})


def _unavailable(reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "unavailable", "database": reason},
    )


api_router = APIRouter()


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
def inject_chaos(req: ChaosRequest, container: ContainerDep, _: Viewer) -> dict[str, str]:
    lab_dir = container.settings.offline_lab_path
    if req.scenario == "acl_drift":
        leaf1_cfg = lab_dir / "leaf-1.croc.lab.cfg"
        if leaf1_cfg.exists():
            content = leaf1_cfg.read_text(encoding="utf-8")
            if "15 permit ip any any" not in content:
                content = content.replace(
                    "20 deny ip any any", "15 permit ip any any\n 20 deny ip any any"
                )
                leaf1_cfg.write_text(content, encoding="utf-8")
        record_chaos_event(
            scenario="acl_drift",
            target_hostnames=["leaf-1.croc.lab", "leaf-1"],
            title="Chaos: Внедрение несанкционированного ACL",
            description="Внедрен несанкционированный ACL в leaf-1.croc.lab (Дрейф создан!)",
            severity="warning",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Внедрен несанкционированный ACL в leaf-1.croc.lab (Дрейф создан!)",
        }
    if req.scenario == "port_down":
        leaf2_cfg = lab_dir / "leaf-2.croc.lab.cfg"
        if leaf2_cfg.exists():
            content = leaf2_cfg.read_text(encoding="utf-8")
            old_str = (
                "interface GigabitEthernet3\n description Uplink to spine-2\n"
                " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n no shutdown"
            )
            new_str = (
                "interface GigabitEthernet3\n description Uplink to spine-2\n"
                " mtu 9000\n ip address 10.0.2.3 255.255.255.254\n shutdown"
            )
            content = content.replace(old_str, new_str)
            leaf2_cfg.write_text(content, encoding="utf-8")
        record_chaos_event(
            scenario="port_down",
            target_hostnames=["leaf-2.croc.lab", "leaf-2"],
            title="Chaos: Отключение интерфейса GigabitEthernet3",
            description="Интерфейс GigabitEthernet3 на leaf-2 переведен в shutdown",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Интерфейс GigabitEthernet3 на leaf-2 переведен в shutdown",
        }
    if req.scenario == "huawei_drift":
        leaf3_cfg = lab_dir / "leaf-3.croc.lab.cfg"
        if leaf3_cfg.exists():
            content = leaf3_cfg.read_text(encoding="utf-8")
            if "rule 15 permit ip source 10.99.0.0" not in content:
                content = content.replace(
                    "rule 20 deny ip source any destination any",
                    "rule 15 permit ip source 10.99.0.0 0.0.255.255 destination any\n rule 20 deny ip source any destination any",
                )
                leaf3_cfg.write_text(content, encoding="utf-8")
        record_chaos_event(
            scenario="huawei_drift",
            target_hostnames=["leaf-3.croc.lab", "leaf-3"],
            title="Chaos: Внедрение несанкционированного правила в Huawei VRP",
            description="Внедрен дрейф ACL rule 15 в leaf-3.croc.lab (Huawei)",
            severity="warning",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Внедрен несанкционированный ACL в leaf-3.croc.lab (Huawei VRP)",
        }
    if req.scenario == "ai_blackhole":
        from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

        AiTelemetryGuard.inject_anomaly("leaf-3.croc.lab", "blackhole")
        record_chaos_event(
            scenario="ai_blackhole",
            target_hostnames=["leaf-3.croc.lab", "leaf-3"],
            title="Chaos: Моделирование 'тихой аварии' (Blackhole / 0 трафика)",
            description="Имитация падения трафика при статусе портов up/up для проверки TimesFM 3.0",
            severity="critical",
            lab_dir=lab_dir,
        )
        return {
            "status": "ok",
            "message": "Смоделирована 'тихая авария' на leaf-3.croc.lab (TimesFM 3.0 обнаружит дроп)",
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
            "message": "Устройства успешно сброшены к чистому эталону Git SoT",
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
def toggle_freeze(req: FreezeRequest, user: Viewer) -> dict[str, Any]:
    from netops.services.freeze import set_factory_freeze  # noqa: PLC0415

    return set_factory_freeze(req.frozen, req.reason, user.username)


