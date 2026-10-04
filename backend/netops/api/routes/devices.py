from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from netops.api.deps import Admin, ContainerDep, DeviceServiceDep, Viewer
from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.intent import IntentValidationError
from netops.intent.netbox import load_netbox_inventory
from netops.models import Device
from netops.schemas.devices import (
    DeviceCreate,
    DeviceDetail,
    DeviceRead,
    DeviceUpdate,
    InventorySyncResult,
)
from netops.schemas.intent import IntentIssueRead

router = APIRouter(tags=["devices"])


@router.get("/devices", response_model=list[DeviceRead], summary="List devices")
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


@router.get("/devices/{device_id}", response_model=DeviceDetail, summary="Device card")
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
    summary="Register a device",
)
def create_device(data: DeviceCreate, service: DeviceServiceDep, _: Admin) -> Device:
    return service.create(data)


@router.patch("/devices/{device_id}", response_model=DeviceRead, summary="Update a device")
def update_device(
    device_id: int, data: DeviceUpdate, service: DeviceServiceDep, _: Admin
) -> Device:
    return service.update(device_id, data)


@router.delete(
    "/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a device"
)
def delete_device(device_id: int, service: DeviceServiceDep, _: Admin) -> Response:
    service.delete(device_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/inventory/sync",
    response_model=InventorySyncResult,
    summary="Import devices from NetBox (if configured) or inventory.yaml of the intent repository",
)
def sync_inventory(
    service: DeviceServiceDep, container: ContainerDep, _: Admin
) -> InventorySyncResult:
    settings = container.settings
    if settings.netbox_url and settings.netbox_token:
        inventory = load_netbox_inventory(settings.netbox_url, settings.netbox_token.get_secret_value())
    else:
        inventory = container.intents.load_inventory()
    return service.sync_inventory(inventory)
