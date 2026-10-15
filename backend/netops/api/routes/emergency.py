from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from netops.api.deps import Admin, ContainerDep, DeviceServiceDep, JobServiceDep, SessionDep
from netops.enums import DeviceStatus
from netops.errors import ConflictError, NotFoundError
from netops.intent import InventoryDevice
from netops.models import EmergencyAction
from netops.network import CommandRunner
from netops.toolchain import build_toolchain

router = APIRouter(prefix="/emergency", tags=["emergency"])

# Ручная диагностика разрешена только на чтение: платформа не должна стать способом
# выполнить на оборудовании произвольную команду в обход пайплайна.
READ_ONLY_PREFIXES = ("show ", "display ", "ping ", "traceroute ")
OUTPUT_PREVIEW_LIMIT = 2000
AUDIT_LIMIT = 50


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device: str = Field(examples=["leaf-1.croc.lab"])
    command: str = Field(min_length=1, max_length=200, examples=["display bgp peer"])


class CommandResult(BaseModel):
    status: str
    device: str
    command: str
    output: str
    failed: bool = False


class PatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device: str
    patch: str
    reason: str | None = None


class FabricActionResult(BaseModel):
    status: str
    message: str
    details: str


class AuditRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime = Field(validation_alias="created_at")
    user: str
    action: str
    device: str
    payload: str
    success: bool
    output_preview: str


@router.get("/audit", response_model=list[AuditRecord], summary="Журнал ручных вмешательств")
def audit_log(session: SessionDep, _: Admin) -> list[EmergencyAction]:
    return list(
        session.scalars(
            select(EmergencyAction).order_by(EmergencyAction.id.desc()).limit(AUDIT_LIMIT)
        )
    )


@router.post(
    "/command",
    response_model=CommandResult,
    summary="Выполнить на устройстве команду чтения",
)
def run_command(
    request: CommandRequest,
    session: SessionDep,
    devices: DeviceServiceDep,
    container: ContainerDep,
    admin: Admin,
) -> CommandResult:
    command = request.command.strip()
    device = next(
        (d for d in devices.list_devices(limit=500) if d.hostname == request.device), None
    )
    if device is None:
        raise NotFoundError(f"Устройство {request.device} не найдено")
    if not command.lower().startswith(READ_ONLY_PREFIXES):
        _record(session, admin.username, "command", request.device, command, False, "отклонено")
        raise ConflictError(
            "Разрешены только команды чтения ("
            + ", ".join(prefix.strip() for prefix in READ_ONLY_PREFIXES)
            + "). Изменения конфигурации идут через dry-run и деплой."
        )

    toolchain = build_toolchain(container.settings)
    runner = toolchain.collector
    if not isinstance(runner, CommandRunner):
        _record(session, admin.username, "command", request.device, command, False, "нет драйвера")
        raise ConflictError(
            "Текущий драйвер не выполняет команды: включите NETOPS_NETWORK_DRIVER=scrapli"
        )

    target = toolchain.target_for(InventoryDevice.model_validate(device))
    try:
        output = runner.run_read_only(target, command)
    except Exception as exc:
        _record(session, admin.username, "command", request.device, command, False, str(exc))
        return CommandResult(
            status="failed", device=request.device, command=command, output=str(exc), failed=True
        )
    _record(session, admin.username, "command", request.device, command, True, output)
    return CommandResult(status="ok", device=request.device, command=command, output=output)


@router.post(
    "/soft-reset",
    response_model=FabricActionResult,
    summary="Сверить фабрику с эталоном (скан дрейфа)",
)
def soft_reset(session: SessionDep, jobs: JobServiceDep, admin: Admin) -> FabricActionResult:
    job = jobs.create_drift_scan(None, requested_by=admin.username)
    _record(session, admin.username, "soft-reset", "fabric", str(job.id), True, "скан запущен")
    return FabricActionResult(
        status="accepted",
        message="Запущен скан дрейфа по всем устройствам",
        details=f"job_id={job.id}",
    )


@router.post(
    "/hard-reset",
    response_model=FabricActionResult,
    summary="Вернуть к эталону устройства с дрейфом",
)
def hard_reset(
    session: SessionDep, devices: DeviceServiceDep, jobs: JobServiceDep, admin: Admin
) -> FabricActionResult:
    drifted = [
        device
        for device in devices.list_devices(limit=500)
        if device.status is DeviceStatus.DRIFT_DETECTED
    ]
    if not drifted:
        _record(session, admin.username, "hard-reset", "fabric", "", True, "дрейфа нет")
        return FabricActionResult(
            status="noop", message="Дрейфа нет, возвращать нечего", details=""
        )
    started = [
        str(jobs.create_drift_remediation(device.id, requested_by=admin.username).id)
        for device in drifted
    ]
    hostnames = ", ".join(device.hostname for device in drifted)
    _record(
        session, admin.username, "hard-reset", hostnames, ",".join(started), True, "откат запущен"
    )
    return FabricActionResult(
        status="accepted",
        message=f"Устранение дрейфа запущено на {len(started)} устройствах",
        details=hostnames,
    )


# Накат произвольного патча минует intent, pre-check и расчёт отката, поэтому через
# платформу он не выполняется: правка идёт в intent, дальше dry-run и деплой.
@router.post(
    "/patch",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    summary="Ручной патч: не поддерживается",
)
def apply_patch(request: PatchRequest, session: SessionDep, admin: Admin) -> FabricActionResult:
    _record(
        session,
        admin.username,
        "patch",
        request.device,
        request.patch,
        False,
        "отклонено: только через dry-run и деплой",
    )
    return FabricActionResult(
        status="rejected",
        message="Ручной накат конфигурации в обход пайплайна не поддерживается",
        details=(
            "Изменение нужно внести в intent и применить через dry-run → deploy: "
            "так считается патч отката, работает post-check и остаётся история."
        ),
    )


def _record(
    session: SessionDep,
    user: str,
    action: str,
    device: str,
    payload: str,
    success: bool,
    output: str,
) -> None:
    session.add(
        EmergencyAction(
            user=user,
            action=action,
            device=device,
            payload=payload[:OUTPUT_PREVIEW_LIMIT],
            success=success,
            output_preview=output[:OUTPUT_PREVIEW_LIMIT],
        )
    )
    session.commit()
