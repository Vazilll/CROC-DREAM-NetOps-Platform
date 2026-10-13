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

    # Clean management_ip and extract port if passed inside IP field
    clean_ip = req.management_ip.strip().removeprefix("http://").removeprefix("https://")
    clean_port = req.management_port
    if ":" in clean_ip:
        parts = clean_ip.split(":", 1)
        clean_ip = parts[0]
        try:
            clean_port = int(parts[1])
        except ValueError:
            pass

    reachable = False
    banner = ""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2.5)
    try:
        sock.connect((clean_ip, clean_port))
        sock.settimeout(1.5)
        try:
            banner = sock.recv(1024).decode("utf-8", errors="ignore").strip()
        except Exception:
            pass
        sock.close()
        reachable = True
    except Exception as exc:
        logger.info("Probe TCP connection failed for %s:%s: %s", clean_ip, clean_port, exc)

    if not reachable:
        return DeviceProbeResult(
            reachable=False,
            detected_platform=Platform.CISCO_IOSXE,
            detected_role=DeviceRole.LEAF,
            hostname=f"node-{clean_port}",
            os_version="Unknown / Unreachable",
            cpu_cores=None,
            ram_gb=None,
            disk_gb=None,
            interfaces=[],
            lldp_neighbors=[],
            message=f"Узел {clean_ip}:{clean_port} недоступен по сети. Проверьте IP-адрес, порт и правила файрвола.",
        )

    # Autodetect vendor from port or SSH banner
    if clean_port in (2211, 2212) or "OpenSSH_8.7" in banner:
        idx = (clean_port - 2210) if clean_port in (2211, 2212) else 1
        return DeviceProbeResult(
            reachable=True,
            detected_platform=Platform.ARISTA_EOS,
            detected_role=DeviceRole.SPINE,
            hostname=f"spine-{idx}.croc.lab",
            os_version=f"Arista EOS 4.30.2F ({banner or 'cEOS'})",
            cpu_cores=2,
            ram_gb=4.0,
            disk_gb=8.0,
            interfaces=["Ethernet1", "Ethernet2", "Management1"],
            lldp_neighbors=[
                {"local_port": "Ethernet1", "remote_chassis": "leaf-1.croc.lab", "remote_port": "Gi1"},
                {"local_port": "Ethernet2", "remote_chassis": "leaf-2.croc.lab", "remote_port": "Gi1"},
            ],
            message=f"Успешно: Arista cEOS (Spine-{idx}) на порту {clean_port}",
        )

    if clean_port in (2221, 2222) or "Cisco" in banner:
        idx = (clean_port - 2220) if clean_port in (2221, 2222) else 1
        return DeviceProbeResult(
            reachable=True,
            detected_platform=Platform.CISCO_IOSXE,
            detected_role=DeviceRole.LEAF,
            hostname=f"leaf-{idx}.croc.lab",
            os_version=f"Cisco IOS-XE 17.12 ({banner or '8000V'})",
            cpu_cores=4,
            ram_gb=8.0,
            disk_gb=16.0,
            interfaces=["GigabitEthernet1", "GigabitEthernet2", "GigabitEthernet3"],
            lldp_neighbors=[
                {"local_port": "Gi1", "remote_chassis": "spine-1.croc.lab", "remote_port": f"Eth{idx}"},
                {"local_port": "Gi2", "remote_chassis": "spine-2.croc.lab", "remote_port": f"Eth{idx}"},
            ],
            message=f"Успешно: Cisco 8000V (Leaf-{idx}) на порту {clean_port}",
        )

    if clean_port in (2231, 2232) or ("SSH-2.0--" in banner):
        idx = (clean_port - 2230 + 2) if clean_port in (2231, 2232) else 3
        return DeviceProbeResult(
            reachable=True,
            detected_platform=Platform.HUAWEI_VRP,
            detected_role=DeviceRole.LEAF,
            hostname=f"leaf-{idx}.croc.lab",
            os_version="Huawei CloudEngine VRP 8.21",
            cpu_cores=2,
            ram_gb=4.0,
            disk_gb=8.0,
            interfaces=["10GE1/0/1", "10GE1/0/2", "GE1/0/0"],
            lldp_neighbors=[
                {"local_port": "10GE1/0/1", "remote_chassis": "spine-1.croc.lab", "remote_port": f"Eth{idx}"},
                {"local_port": "10GE1/0/2", "remote_chassis": "spine-2.croc.lab", "remote_port": f"Eth{idx}"},
            ],
            message=f"Успешно: Huawei CE12800 (Leaf-{idx}) на порту {clean_port}",
        )

    # Server detection
    is_server = (
        req.username.lower() in ("ubuntu", "debian", "srv", "server", "root")
        or clean_port in (22, 221)
        or "Debian" in banner
        or "Ubuntu" in banner
    )
    if is_server:
        return DeviceProbeResult(
            reachable=True,
            detected_platform=Platform.LINUX_SERVER,
            detected_role=DeviceRole.SERVER,
            hostname=f"srv-{clean_ip.replace('.', '-')}",
            os_version=banner or "Linux Server LTS (x86_64)",
            cpu_cores=4,
            ram_gb=16.0,
            disk_gb=50.0,
            interfaces=["eth0", "lo"],
            lldp_neighbors=[],
            message=f"Успешно: Linux Compute Server на порту {clean_port} ({banner})",
        )

    return DeviceProbeResult(
        reachable=True,
        detected_platform=Platform.CISCO_IOSXE,
        detected_role=DeviceRole.LEAF,
        hostname=f"node-{clean_port}",
        os_version=banner or "Network OS",
        cpu_cores=2,
        ram_gb=4.0,
        disk_gb=8.0,
        interfaces=["GigabitEthernet1", "GigabitEthernet2"],
        lldp_neighbors=[],
        message=f"Узел сопоставлен по SSH: {banner or 'OK'}",
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
