from __future__ import annotations

import logging
import socket
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from netops.api.deps import Admin, ContainerDep, DeviceServiceDep, Viewer
from netops.enums import DeviceRole, DeviceStatus, ManagementMode, Platform
from netops.intent import IntentValidationError
from netops.models import Device
from netops.schemas.devices import (
    DeviceCreate,
    DeviceDetail,
    DeviceProbeRequest,
    DeviceProbeResult,
    DeviceRead,
    DeviceUpdate,
    InventorySyncResult,
)
from netops.schemas.intent import IntentIssueRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["devices"])


@router.get("/devices", response_model=list[DeviceRead], summary="Список устройств")
def list_devices(
    service: DeviceServiceDep,
    _: Viewer,
    status_filter: Annotated[DeviceStatus | None, Query(alias="status")] = None,
    role: DeviceRole | None = None,
    platform: Platform | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Device]:
    return list(
        service.list_devices(
            status=status_filter, role=role, platform=platform, limit=limit, offset=offset
        )
    )


@router.get("/devices/{device_id}", response_model=DeviceDetail, summary="Карточка устройства")
def get_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, _: Viewer
) -> DeviceDetail:
    device = service.get(device_id)
    detail = DeviceDetail.model_validate(device)
    try:
        detail.intent = container.intents.load_device_intent(device.hostname)
    except IntentValidationError as exc:
        detail.intent_issues = [IntentIssueRead.model_validate(issue) for issue in exc.issues]
    return detail


@router.post(
    "/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить устройство",
)
def create_device(data: DeviceCreate, service: DeviceServiceDep, _: Admin) -> Device:
    return service.create(data)


@router.patch("/devices/{device_id}", response_model=DeviceRead, summary="Изменить устройство")
def update_device(
    device_id: int, data: DeviceUpdate, service: DeviceServiceDep, _: Admin
) -> Device:
    return service.update(device_id, data)


@router.delete(
    "/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить устройство"
)
def delete_device(device_id: int, service: DeviceServiceDep, _: Admin) -> Response:
    service.delete(device_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Проверяем только то, что действительно видно: открыт ли SSH-порт и что отвечает баннером.
# Платформу подсказываем, если она в баннере названа; угадывать по номеру порта нельзя.
@router.post(
    "/devices/probe",
    response_model=DeviceProbeResult,
    summary="Проверка доступности устройства по SSH",
)
def probe_device(request: DeviceProbeRequest, _: Admin) -> DeviceProbeResult:
    banner = _ssh_banner(request.management_ip, request.management_port)
    if banner is None:
        return DeviceProbeResult(
            reachable=False,
            message=(
                f"{request.management_ip}:{request.management_port} не отвечает. "
                "Проверьте адрес, порт и доступ по сети."
            ),
        )
    return DeviceProbeResult(
        reachable=True,
        message=f"SSH-порт открыт{', баннер: ' + banner if banner else ''}",
        banner=banner or None,
        detected_platform=_platform_from_banner(banner),
        os_version=banner or None,
    )


def _ssh_banner(host: str, port: int, timeout: float = 2.5) -> str | None:
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(1.5)
            try:
                return sock.recv(256).decode("utf-8", errors="ignore").strip()
            except OSError:
                return ""
    except OSError as exc:
        logger.info("Проверка %s:%s не прошла: %s", host, port, exc)
        return None


_BANNER_PLATFORMS = (
    ("cisco", Platform.CISCO_IOSXE),
    ("arista", Platform.ARISTA_EOS),
    ("huawei", Platform.HUAWEI_VRP),
    ("eltex", Platform.ELTEX_ESR),
)


def _platform_from_banner(banner: str) -> Platform | None:
    lowered = banner.lower()
    return next((platform for mark, platform in _BANNER_PLATFORMS if mark in lowered), None)


@router.post(
    "/devices/{device_id}/promote",
    response_model=DeviceRead,
    summary="Разрешить изменения конфигурации на устройстве",
)
def promote_device(device_id: int, service: DeviceServiceDep, _: Admin) -> Device:
    return service.set_management_mode(device_id, ManagementMode.MANAGED)


@router.post(
    "/inventory/sync",
    response_model=InventorySyncResult,
    summary="Импорт устройств из inventory.yaml",
)
def sync_inventory(
    service: DeviceServiceDep, container: ContainerDep, _: Admin
) -> InventorySyncResult:
    return service.sync_inventory(container.intents.load_inventory())
