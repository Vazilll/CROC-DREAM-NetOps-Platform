from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from netops.api.deps import ContainerDep, SessionDep, Viewer
from netops.network.rendering import JinjaConfigRenderer
from netops.schemas.intent import IntentIssueRead, IntentLintReport
from netops.services.forecast import record_chaos_event
from netops.settings import ApiPrincipal

router = APIRouter()


@router.get("/healthz", tags=["system"], summary="Liveness probe")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", tags=["system"], summary="Readiness probe (database)")
def readiness(session: SessionDep) -> JSONResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "database": "unreachable"},
        )
    return JSONResponse(content={"status": "ok", "database": "ok"})


api_router = APIRouter()


class ChaosRequest(BaseModel):
    scenario: str


@api_router.get("/auth/me", response_model=ApiPrincipal, tags=["auth"], summary="Current user")
def current_user(user: Viewer) -> ApiPrincipal:
    return user


@api_router.get(
    "/intent/lint",
    response_model=IntentLintReport,
    tags=["intent"],
    summary="Pre-flight lint of the intent repository",
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
    if req.scenario == "reset_lab":
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

