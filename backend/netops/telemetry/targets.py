"""Платформа управляет сборщиками, а не собирает всё сама.

Для каждого устройства из базы определяем лучший доказанно работающий протокол
(detect_optimal_telemetry_protocol) и раскладываем устройства по целям внешних сборщиков:

- gnmic_targets.yaml      — file loader gnmic (gNMI-подписки, без паролей: они в env gnmic);
- prometheus_targets.json — file_sd джобы snmp_fabric (snmp-exporter);
- exporter_targets.json   — file_sd джобы node_exporter_fleet.

Устройства, для которых ничего не доказано, остаются на SSH CLI-опросе платформы.
Файлы пишутся атомарно (tmp + os.replace): Prometheus и gnmic перечитывают их сами.
"""

from __future__ import annotations

import json
import logging
import os
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.enums import TelemetryProtocol
from netops.intent import InventoryDevice
from netops.models import Device
from netops.services.state import get_state_manager
from netops.services.telemetry import (
    detect_optimal_telemetry_protocol,
    load_profile_for_platform,
)
from netops.settings import Settings
from netops.toolchain import Toolchain

logger = logging.getLogger(__name__)

GNMIC_TARGETS_FILE = "gnmic_targets.yaml"
SNMP_TARGETS_FILE = "prometheus_targets.json"
EXPORTER_TARGETS_FILE = "exporter_targets.json"
PROTOCOLS_STATE_KEY = "netops:telemetry:protocols"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _probe_device(
    device: Device, toolchain: Toolchain, settings: Settings, detect: Callable[..., dict]
) -> dict[str, Any]:
    try:
        creds = toolchain.target_for(InventoryDevice.model_validate(device)).credentials
        username, password = creds.username, creds.password
    except Exception:
        username = password = None
    community = settings.snmp_community.get_secret_value() if settings.snmp_community else None
    try:
        result = detect(
            str(device.management_ip),
            device.platform.value,
            management_port=device.management_port,
            username=username,
            password=password,
            snmp_community=community,
        )
    except Exception as exc:  # одна сломанная нода не должна ронять планирование всего флота
        logger.warning("Проба протоколов для %s упала: %s", device.hostname, exc)
        result = {"protocol": TelemetryProtocol.SSH_CLI, "error": str(exc)}
    protocol = result.get("protocol", TelemetryProtocol.SSH_CLI)
    return {
        **result,
        "protocol": str(getattr(protocol, "value", protocol)),
        "host": str(device.management_ip),
        "platform": device.platform.value,
        "fabric_id": device.fabric_id or "default",
    }


def build_target_files(plan: dict[str, dict[str, Any]]) -> dict[str, Any]:
    gnmic: dict[str, Any] = {}
    snmp: list[dict[str, Any]] = []
    exporter: list[dict[str, Any]] = []
    for hostname, item in sorted(plan.items()):
        if item["protocol"] == TelemetryProtocol.SSH_CLI.value or not item.get("port"):
            continue  # остаётся на SSH CLI-опросе платформы
        labels = {
            "hostname": hostname,
            "fabric_id": item["fabric_id"],
            "platform": item["platform"],
        }
        address = f"{item['host']}:{item['port']}"
        if item["protocol"] == TelemetryProtocol.GNMI.value:
            entry: dict[str, Any] = {"address": address, "event-tags": labels}
            # tls=None — проверено по CLI+TCP без gnmic: режим TLS неизвестен, пусть gnmic решает.
            if item.get("tls") is True:
                entry["skip-verify"] = True
            elif item.get("tls") is False:
                entry["insecure"] = True
            gnmic[hostname] = entry
        elif item["protocol"] == TelemetryProtocol.SNMP.value:
            profile = load_profile_for_platform(item["platform"])
            snmp_mod = profile.snmp.hardware_module if profile else "host_resources"
            snmp_labels = labels | ({"snmp_module": snmp_mod} if snmp_mod else {})
            snmp.append({"targets": [address], "labels": snmp_labels})
        elif item["protocol"] == TelemetryProtocol.PROMETHEUS_EXPORTER.value:
            path = item.get("path") or "/metrics"
            exporter_labels = labels | ({"__metrics_path__": path} if path != "/metrics" else {})
            exporter.append({"targets": [address], "labels": exporter_labels})
    return {
        GNMIC_TARGETS_FILE: gnmic,
        SNMP_TARGETS_FILE: snmp,
        EXPORTER_TARGETS_FILE: exporter,
    }


def refresh_collector_targets(
    session: Session,
    toolchain: Toolchain,
    settings: Settings,
    *,
    detect: Callable[..., dict] = detect_optimal_telemetry_protocol,
    max_workers: int = 32,
) -> dict[str, Any]:
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    workers = max(1, min(max_workers, len(devices) or 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        probed = list(pool.map(lambda d: _probe_device(d, toolchain, settings, detect), devices))
    plan = {dev.hostname: item for dev, item in zip(devices, probed, strict=True)}

    files = build_target_files(plan)
    out_dir = settings.offline_lab_path
    _atomic_write(
        out_dir / GNMIC_TARGETS_FILE,
        yaml.safe_dump(files[GNMIC_TARGETS_FILE], sort_keys=True, allow_unicode=True),
    )
    for name in (SNMP_TARGETS_FILE, EXPORTER_TARGETS_FILE):
        _atomic_write(out_dir / name, json.dumps(files[name], ensure_ascii=False, indent=2))

    summary = {
        "refreshed_at": utcnow().isoformat(),
        "protocols": dict(Counter(item["protocol"] for item in plan.values())),
        "devices": plan,
    }
    get_state_manager().set_json(PROTOCOLS_STATE_KEY, summary)
    return summary


def last_collector_plan() -> dict[str, Any] | None:
    return get_state_manager().get_json(PROTOCOLS_STATE_KEY)


def is_externally_collected(hostname: str) -> bool:
    plan = last_collector_plan()
    if not plan:
        return False
    proto = (plan.get("devices") or {}).get(hostname, {}).get("protocol")
    return proto in (TelemetryProtocol.GNMI.value, TelemetryProtocol.PROMETHEUS_EXPORTER.value)
