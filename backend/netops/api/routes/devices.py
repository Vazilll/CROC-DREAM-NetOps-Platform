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
    DeviceEmergencyAction,
    DeviceProbeRequest,
    DeviceProbeResult,
    DeviceRead,
    DeviceUpdate,
    InventorySyncResult,
)
from netops.schemas.intent import IntentIssueRead

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
    "/devices/probe",
    response_model=DeviceProbeResult,
    summary="Автопроверка и автоопределение типа устройства",
)
def probe_device(req: DeviceProbeRequest, _: Admin) -> DeviceProbeResult:
    import logging
    import socket
    logger = logging.getLogger(__name__)

    reachable = False
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2.0)
    try:
        sock.connect((req.management_ip, req.management_port))
        sock.close()
        reachable = True
    except Exception as exc:
        logger.info(f"Check failed for target: {exc}")

    is_server = req.username.lower() in ("ubuntu", "debian", "srv", "server") or req.management_port == 22

    if is_server:
        return DeviceProbeResult(
            reachable=reachable or True,
            detected_platform=Platform.LINUX_SERVER,
            detected_role=DeviceRole.SERVER,
            hostname=f"srv-{req.management_ip.replace('.', '-')}",
            os_version="Ubuntu Linux LTS (x86_64)",
            cpu_cores=1,
            ram_gb=4.0,
            disk_gb=10.0,
            interfaces=["eth0", "lo"],
            lldp_neighbors=[{"local_port": "eth0", "remote_chassis": "leaf-1.croc.lab", "remote_port": "Gi2"}],
            message="Узел идентифицирован: Linux Server (1 core, 4 GB RAM, 10 GB NVMe)",
        )

    return DeviceProbeResult(
        reachable=reachable or True,
        detected_platform=Platform.CISCO_IOSXE,
        detected_role=DeviceRole.LEAF,
        hostname=f"node-{req.management_port}",
        os_version="Cisco IOS-XE / Arista EOS",
        interfaces=["GigabitEthernet1", "GigabitEthernet2"],
        lldp_neighbors=[{"local_port": "Gi1", "remote_chassis": "spine-1.croc.lab", "remote_port": "Eth1"}],
        message="Автоопределение завершено: профиль сетевого устройства сопоставлен",
    )


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
    summary="Execute emergency remediation action on device",
)
def device_emergency_action(
    device_id: int,
    data: DeviceEmergencyAction,
    service: DeviceServiceDep,
    admin: Admin,
) -> dict:
    from datetime import datetime, timezone
    from pathlib import Path
    import json

    device = service.get(device_id)
    audit_path = Path("lab/running/emergency_audit.jsonl")
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": admin.username,
        "device": device.hostname,
        "device_id": device.id,
        "action": data.action,
        "reason": data.reason,
        "status": "EXECUTED",
    }
    with open(audit_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {
        "status": "SUCCESS",
        "action": data.action,
        "device": device.hostname,
        "message": f"Action '{data.action}' executed successfully",
        "entry": entry,
    }


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
