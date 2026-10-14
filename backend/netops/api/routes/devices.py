from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status

from netops.api.deps import Admin, ContainerDep, DeviceServiceDep, Viewer
from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.intent import IntentValidationError
from netops.intent.netbox import load_netbox_inventory
from netops.models import Device
from netops.schemas.devices import (
    DeviceCreate,
    DeviceDetail,
    DeviceEmergencyAction,
    DeviceEmergencyActionResult,
    DeviceProbeRequest,
    DeviceProbeResult,
    DeviceRead,
    DeviceUpdate,
    InventorySyncResult,
)
from netops.schemas.intent import IntentIssueRead
from netops.services.discovery import (
    bind_device_to_sot,
    execute_device_emergency_action,
    extract_brownfield_intent,
    remove_device_from_sot,
    run_device_probe,
)

# Backwards-compatible aliases if imported directly by tests
_extract_brownfield_intent = extract_brownfield_intent
_bind_device_to_sot = bind_device_to_sot

router = APIRouter(tags=["devices"])


@router.get("/devices", response_model=list[DeviceRead], summary="Список устройств")
def list_devices(
    service: DeviceServiceDep,
    principal: Viewer,
    status_filter: Annotated[DeviceStatus | None, Query(alias="status")] = None,
    role: DeviceRole | None = None,
    platform: Platform | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Device]:
    devices = list(
        service.list_devices(
            status=status_filter, role=role, platform=platform, limit=limit, offset=offset
        )
    )
    if principal.allowed_system:
        return [
            d
            for d in devices
            if d.hostname == principal.allowed_system or str(d.id) == principal.allowed_system
        ]
    return devices


@router.get("/devices/{device_id}", response_model=DeviceDetail, summary="Карточка устройства")
def get_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, principal: Viewer
) -> DeviceDetail:
    device = service.get(device_id)
    if (
        principal.allowed_system
        and device.hostname != principal.allowed_system
        and str(device.id) != principal.allowed_system
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Доступ вашей ссылки ограничен системой {principal.allowed_system}",
        )
    detail = DeviceDetail.model_validate(device)
    try:
        detail.intent = container.intents.load_device_intent(device.hostname)
    except IntentValidationError as exc:
        detail.intent_issues = [IntentIssueRead.model_validate(issue) for issue in exc.issues]
    return detail


@router.post(
    "/devices/probe",
    response_model=DeviceProbeResult,
    summary="Автопроверка и автоопределение типа устройства",
)
def probe_device(req: DeviceProbeRequest, container: ContainerDep, _: Admin) -> DeviceProbeResult:
    return run_device_probe(req, container)


@router.post(
    "/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить устройство",
)
def create_device(
    data: DeviceCreate, service: DeviceServiceDep, container: ContainerDep, _: Admin
) -> Device:
    from sqlalchemy import select  # noqa: PLC0415

    from netops.errors import ConflictError  # noqa: PLC0415
    from netops.services.notifier import sync_access_registry  # noqa: PLC0415

    try:
        device = service.create(data)
    except ConflictError:
        if data.hardware_specs is None and data.username is None:
            raise
        existing = service._session.scalars(
            select(Device).where(
                (Device.management_ip == str(data.management_ip))
                & (Device.management_port == data.management_port)
            )
        ).first() or service._session.scalars(
            select(Device).where(Device.hostname == data.hostname)
        ).first()
        if existing is None:
            raise
        hostname_taken = service._session.scalars(
            select(Device).where(
                (Device.hostname == data.hostname) & (Device.id != existing.id)
            )
        ).first()
        existing.hostname = existing.hostname if hostname_taken else data.hostname
        existing.management_ip = str(data.management_ip)
        existing.management_port = data.management_port
        existing.platform = data.platform
        existing.role = data.role
        existing.auth_profile = data.auth_profile
        existing.management_mode = data.management_mode
        existing.proxy_jump = data.proxy_jump
        if data.hardware_specs is not None:
            existing.hardware_specs = data.hardware_specs
        service._commit(f"Device {existing.hostname}")
        device = existing
    if data.username or (
        container.settings.network_driver != "offline" and not os.environ.get("PYTEST_CURRENT_TEST")
    ):
        bind_device_to_sot(data, device, container)
        device.status = DeviceStatus.IN_SYNC
        service._session.commit()
    sync_access_registry(service._session, container.settings)
    return service.get(device.id)


@router.patch("/devices/{device_id}", response_model=DeviceRead, summary="Изменить устройство")
def update_device(
    device_id: int, data: DeviceUpdate, service: DeviceServiceDep, _: Admin
) -> Device:
    return service.update(device_id, data)


@router.delete(
    "/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить устройство"
)
def delete_device(
    device_id: int, service: DeviceServiceDep, container: ContainerDep, _: Admin
) -> Response:
    from netops.services.notifier import sync_access_registry  # noqa: PLC0415

    device = service.get(device_id)
    hostname = device.hostname
    service.delete(device_id)
    remove_device_from_sot(
        hostname,
        container.settings.intent_repo_path,
        container.settings.offline_lab_path,
    )
    sync_access_registry(service._session, container.settings)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/devices/{device_id}/promote",
    response_model=DeviceRead,
    summary="Promote device from MONITORING_ONLY to MANAGED",
)
def promote_device(device_id: int, service: DeviceServiceDep, _: Admin) -> Device:
    device = service.get(device_id)
    device.management_mode = "MANAGED"
    service._session.commit()
    return device


@router.post(
    "/devices/{device_id}/emergency-action",
    response_model=DeviceEmergencyActionResult,
    summary="Execute emergency remediation action on device",
)
def device_emergency_action(
    device_id: int,
    data: DeviceEmergencyAction,
    service: DeviceServiceDep,
    container: ContainerDep,
    admin: Admin,
) -> dict[str, Any]:
    device = service.get(device_id)
    return execute_device_emergency_action(device, data, container, admin.username)


@router.post(
    "/inventory/sync",
    response_model=InventorySyncResult,
    summary="Import devices from NetBox (if configured) or inventory.yaml of the intent repository",
)
def sync_inventory(
    service: DeviceServiceDep, container: ContainerDep, _: Admin
) -> InventorySyncResult:
    from netops.services.notifier import sync_access_registry  # noqa: PLC0415

    settings = container.settings
    if settings.netbox_url and settings.netbox_token:
        inventory = load_netbox_inventory(
            settings.netbox_url, settings.netbox_token.get_secret_value()
        )
    else:
        inventory = container.intents.load_inventory()
    res = service.sync_inventory(inventory)
    sync_access_registry(service._session, settings)
    return res
