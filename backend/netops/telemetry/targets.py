"""Платформа управляет сборщиками, а не собирает всё сама.

Для каждого устройства из базы определяем лучший доказанно работающий протокол
(detect_optimal_telemetry_protocol) и раскладываем устройства по целям внешних сборщиков:

- gnmic_targets.yaml             — file loader gnmic (gNMI-подписки, без паролей: они в env gnmic);
- prometheus_snmp_targets (БД)     — http_sd джобы snmp_fabric / snmp_hardware (snmp-exporter);
- prometheus_exporter_targets (БД) — http_sd джобы node_exporter_fleet.

Устройства, для которых ничего не доказано, остаются на SSH CLI-опросе платформы.
Цели для Prometheus отдаются напрямую из БД через HTTP SD endpoints без JSON-файлов на диске.
"""

from __future__ import annotations

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

from netops.constants import const
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
SNMP_TARGETS_FILE = "prometheus_snmp_targets"
EXPORTER_TARGETS_FILE = "prometheus_exporter_targets"
PROTOCOLS_STATE_KEY = "netops:telemetry:protocols"
PROTOCOL_OVERRIDES_KEY = "netops:telemetry:overrides"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def get_protocol_overrides() -> dict[str, str]:
    sm = get_state_manager()
    raw = sm.get_json(PROTOCOL_OVERRIDES_KEY) or sm.get_db_state(PROTOCOL_OVERRIDES_KEY, {})
    return {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def _make_ssh_trigger_sender(device: Device, toolchain: Toolchain) -> Callable[[str], str] | None:
    if toolchain.health_probe.__class__.__name__ != "ScrapliNetworkDriver":
        return None
    try:
        from netops.network.scrapli_driver import _ParamikoConnAdapter

        target = toolchain.target_for(InventoryDevice.model_validate(device))

        def _send(cmd: str) -> str:
            with _ParamikoConnAdapter(target, timeout=6) as conn:
                return str(conn.send_command(cmd).result or "")

        return _send
    except Exception:
        return None


def _apply_protocol_override(
    item: dict[str, Any], override: str | None, platform: str, management_port: int
) -> dict[str, Any]:
    from netops.services.telemetry import resolve_device_ports

    item["selected_mode"] = override or "auto"
    if not override or override == "auto":
        return item
    norm = (
        TelemetryProtocol.PROMETHEUS_EXPORTER.value
        if override == "node_exporter"
        else override
    )
    supported = item.get("supported_protocols") or {}
    ports = resolve_device_ports(
        item.get("host"), management_port=management_port, platform=platform
    )
    spec = supported.get(norm) if isinstance(supported, dict) else None
    port_map = {
        TelemetryProtocol.GNMI.value: ports.get("gnmi", 6030),
        TelemetryProtocol.SNMP.value: ports.get("snmp", 161),
        TelemetryProtocol.PROMETHEUS_EXPORTER.value: ports.get("exporter", 9100),
        TelemetryProtocol.SSH_CLI.value: ports.get("ssh", management_port or 22),
    }
    resolved_port = (spec.get("port") if isinstance(spec, dict) else None) or port_map.get(norm, 22)
    return {
        **item,
        "protocol": norm,
        "port": int(resolved_port),
        "verified_by": f"manual_override:{norm}",
        "selected_mode": norm,
    }


def _probe_device(
    device: Device, toolchain: Toolchain, settings: Settings, detect: Callable[..., dict]
) -> dict[str, Any]:
    try:
        creds = toolchain.target_for(InventoryDevice.model_validate(device)).credentials
        username, password = creds.username, creds.password
    except Exception:
        username = password = None
    community = settings.snmp_community.get_secret_value() if settings.snmp_community else None
    override = get_protocol_overrides().get(device.hostname)
    extra_kwargs: dict[str, Any] = {}
    if detect is detect_optimal_telemetry_protocol:
        ssh_send = _make_ssh_trigger_sender(device, toolchain)
        if ssh_send is not None:
            extra_kwargs["ssh_send"] = ssh_send
        if override:
            extra_kwargs["preferred_protocol"] = override
    try:
        result = detect(
            str(device.management_ip),
            device.platform.value,
            management_port=device.management_port,
            username=username,
            password=password,
            snmp_community=community,
            **extra_kwargs,
        )
    except Exception as exc:  # одна сломанная нода не должна ронять планирование всего флота
        logger.warning("Проба протоколов для %s упала: %s", device.hostname, exc)
        result = {"protocol": TelemetryProtocol.SSH_CLI, "error": str(exc)}
    protocol = result.get("protocol", TelemetryProtocol.SSH_CLI)
    base_item = {
        **result,
        "protocol": str(getattr(protocol, "value", protocol)),
        "host": str(device.management_ip),
        "platform": device.platform.value,
        "fabric_id": device.fabric_id or "default",
    }
    return _apply_protocol_override(
        base_item, override, device.platform.value, device.management_port
    )


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
    sm = get_state_manager()
    sm.set_db_state(SNMP_TARGETS_FILE, files[SNMP_TARGETS_FILE])
    sm.set_db_state(EXPORTER_TARGETS_FILE, files[EXPORTER_TARGETS_FILE])

    summary = {
        "refreshed_at": utcnow().isoformat(),
        "protocols": dict(Counter(item["protocol"] for item in plan.values())),
        "devices": plan,
    }
    sm.set_json(PROTOCOLS_STATE_KEY, summary)
    sm.set_db_state(PROTOCOLS_STATE_KEY, summary)
    sync_grafana_dashboard_to_db()
    return summary


def sync_grafana_dashboard_to_db(grafana_url: str | None = None) -> dict[str, Any] | None:
    """Load NOC dashboard from configurable YAML, save to PostgreSQL system_state & Grafana DB."""
    import base64
    import contextlib
    import json
    import urllib.request

    rel = "grafana/dashboards/croc-dream-noc.yaml"
    candidates = [
        Path(f"/data/monitoring/{rel}"),
        Path(f"/app/monitoring/{rel}"),
        Path(__file__).resolve().parents[3] / f"monitoring/{rel}",
    ]
    yaml_path = next((p for p in candidates if p.is_file()), None)
    sm = get_state_manager()
    dash: dict[str, Any] | None = None
    if yaml_path is not None:
        loaded = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            dash = loaded
            sm.set_db_state("grafana_noc_dashboard", dash)
    if dash is None:
        raw = sm.get_db_state("grafana_noc_dashboard")
        if isinstance(raw, dict):
            dash = raw
    if not dash:
        return None

    target_url = (grafana_url or os.environ.get("GRAFANA_URL") or const("services.grafana_url")).rstrip("/")
    user = os.environ.get("GRAFANA_ADMIN_USER") or const("services.grafana_admin_user")
    password = os.environ.get("GRAFANA_ADMIN_PASSWORD") or const("services.grafana_admin_password")
    auth_hdr = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode("ascii")
    payload = json.dumps({"dashboard": dash, "overwrite": True}).encode("utf-8")
    with contextlib.suppress(Exception):
        req = urllib.request.Request(
            f"{target_url}/api/dashboards/db",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": auth_hdr},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
        pref_payload = json.dumps({"homeDashboardUID": dash.get("uid", "croc-dream-noc")}).encode(
            "utf-8"
        )
        pref_req = urllib.request.Request(
            f"{target_url}/api/org/preferences",
            data=pref_payload,
            headers={"Content-Type": "application/json", "Authorization": auth_hdr},
            method="PUT",
        )
        with urllib.request.urlopen(pref_req, timeout=2.0) as resp:
            resp.read()
    return dash


def get_snmp_sd_targets() -> list[dict[str, Any]]:
    raw = get_state_manager().get_db_state(SNMP_TARGETS_FILE, [])
    return raw if isinstance(raw, list) else []


def get_exporter_sd_targets() -> list[dict[str, Any]]:
    raw = get_state_manager().get_db_state(EXPORTER_TARGETS_FILE, [])
    return raw if isinstance(raw, list) else []


def last_collector_plan() -> dict[str, Any] | None:
    sm = get_state_manager()
    cached = sm.get_json(PROTOCOLS_STATE_KEY)
    if isinstance(cached, dict):
        return cached
    db_val = sm.get_db_state(PROTOCOLS_STATE_KEY)
    return db_val if isinstance(db_val, dict) else None


def is_externally_collected(hostname: str) -> bool:
    plan = last_collector_plan()
    if not plan:
        return False
    proto = (plan.get("devices") or {}).get(hostname, {}).get("protocol")
    return proto in (
        TelemetryProtocol.GNMI.value,
        TelemetryProtocol.PROMETHEUS_EXPORTER.value,
        TelemetryProtocol.SNMP.value,
    )


def set_device_protocol_override(
    session: Session,
    toolchain: Toolchain,
    settings: Settings,
    hostname: str,
    protocol: str,
) -> dict[str, Any]:
    """Persist user/AI telemetry protocol choice ('auto', 'gnmi', 'snmp', 'prometheus_exporter', 'ssh_cli')."""
    sm = get_state_manager()
    overrides = get_protocol_overrides()
    norm = (
        TelemetryProtocol.PROMETHEUS_EXPORTER.value
        if protocol == "node_exporter"
        else protocol.strip().lower()
    )
    if norm in ("auto", ""):
        overrides.pop(hostname, None)
    else:
        overrides[hostname] = norm
    sm.set_json(PROTOCOL_OVERRIDES_KEY, overrides)
    sm.set_db_state(PROTOCOL_OVERRIDES_KEY, overrides)

    device = session.scalar(select(Device).where(Device.hostname == hostname))
    plan_doc = last_collector_plan() or {"refreshed_at": utcnow().isoformat(), "protocols": {}, "devices": {}}
    devices_map = dict(plan_doc.get("devices") or {})
    if device is not None:
        devices_map[hostname] = _probe_device(
            device, toolchain, settings, detect_optimal_telemetry_protocol
        )
    elif hostname in devices_map:
        devices_map[hostname] = _apply_protocol_override(
            dict(devices_map[hostname]), norm, str(devices_map[hostname].get("platform", "linux_server")), 22
        )

    files = build_target_files(devices_map)
    _atomic_write(
        settings.offline_lab_path / GNMIC_TARGETS_FILE,
        yaml.safe_dump(files[GNMIC_TARGETS_FILE], sort_keys=True, allow_unicode=True),
    )
    sm.set_db_state(SNMP_TARGETS_FILE, files[SNMP_TARGETS_FILE])
    sm.set_db_state(EXPORTER_TARGETS_FILE, files[EXPORTER_TARGETS_FILE])

    summary = {
        "refreshed_at": utcnow().isoformat(),
        "protocols": dict(Counter(item.get("protocol", "ssh_cli") for item in devices_map.values())),
        "devices": devices_map,
        "overrides": overrides,
    }
    sm.set_json(PROTOCOLS_STATE_KEY, summary)
    sm.set_db_state(PROTOCOLS_STATE_KEY, summary)
    return summary

