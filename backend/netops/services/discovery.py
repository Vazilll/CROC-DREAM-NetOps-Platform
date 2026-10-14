"""Device SSH probing, Brownfield YAML intent extraction, and SoT binding service.

Extracted from `api/routes/devices.py` so the HTTP controller stays thin and declarative.
"""

from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import socket
from typing import Any
import yaml

from fastapi import HTTPException, status
from pydantic import SecretStr

from netops.enums import DeviceRole, Platform
from netops.intent.models import DeviceIntent, InventoryDevice
from netops.models import Device
from netops.network.base import Credentials, DeviceTarget
from netops.network.scrapli_driver import _ParamikoConnAdapter
from netops.schemas.devices import DeviceCreate, DeviceEmergencyAction, DeviceProbeRequest, DeviceProbeResult
from netops.settings import AuthProfile
from netops.toolchain import build_toolchain

logger = logging.getLogger(__name__)
_REPO_ROOT = Path(__file__).resolve().parents[3]


def _is_protected_repo_path(path: Path) -> bool:
    """Prevent pytest runs using default settings from wiping tracked repo intent/lab files."""
    if "PYTEST_CURRENT_TEST" not in os.environ:
        return False
    try:
        return path.resolve().is_relative_to(_REPO_ROOT.resolve())
    except Exception:
        return False


def _normalize_probe_endpoint(raw_ip: str, default_port: int) -> tuple[str, int]:
    clean_ip = raw_ip.strip().removeprefix("http://").removeprefix("https://")
    clean_port = default_port
    if ":" in clean_ip:
        parts = clean_ip.split(":", 1)
        clean_ip = parts[0]
        try:
            clean_port = int(parts[1])
        except ValueError:
            pass
    return clean_ip, clean_port


_PLATFORMS_DIR = _REPO_ROOT / "intent" / "platforms"


def load_platform_profiles(intent_repo_path: Path | None = None) -> dict[str, dict[str, Any]]:
    """Load declarative platform rules (SSH banners, version signatures, CLI commands) from intent/platforms/*.yaml."""
    profiles_dir = (
        intent_repo_path / "platforms"
        if intent_repo_path is not None and (intent_repo_path / "platforms").is_dir()
        else _PLATFORMS_DIR
    )
    profiles: dict[str, dict[str, Any]] = {}
    if profiles_dir.is_dir():
        for yml_file in sorted(profiles_dir.glob("*.yaml")):
            try:
                raw = yaml.safe_load(yml_file.read_text(encoding="utf-8")) or {}
                if isinstance(raw, dict):
                    plat_key = str(raw.get("platform") or yml_file.stem)
                    profiles[plat_key] = raw
            except Exception:
                continue
    return profiles


def detect_platform_from_banner(
    banner: str, profiles: dict[str, dict[str, Any]] | None = None
) -> Platform:
    """Resolve Platform enum from TCP SSH banner using declarative ssh_banners in intent/platforms/*.yaml."""
    low = (banner or "").lower()
    if not low:
        return Platform.CISCO_IOSXE
    active_profiles = profiles if profiles is not None else load_platform_profiles()
    for plat_name, cfg in active_profiles.items():
        for sig in cfg.get("ssh_banners") or []:
            if str(sig).lower() in low:
                try:
                    return Platform(plat_name)
                except ValueError:
                    continue
    return Platform.CISCO_IOSXE


def detect_platform_from_version(
    ver_out: str,
    initial_platform: Platform,
    profiles: dict[str, dict[str, Any]] | None = None,
) -> Platform:
    """Resolve Platform enum from version command output using version_signatures in intent/platforms/*.yaml."""
    active_profiles = profiles if profiles is not None else load_platform_profiles()
    for plat_name, cfg in active_profiles.items():
        for sig in cfg.get("version_signatures") or []:
            if str(sig) in ver_out:
                try:
                    return Platform(plat_name)
                except ValueError:
                    continue
    return initial_platform


def _simulate_offline_probe(clean_ip: str, clean_port: int) -> DeviceProbeResult:
    profiles = load_platform_profiles()
    platform = Platform.CISCO_IOSXE
    for plat_name, cfg in profiles.items():
        if clean_port in (cfg.get("offline_ports") or []):
            try:
                platform = Platform(plat_name)
                break
            except ValueError:
                continue
    plat_cfg = profiles.get(platform.value) or {}
    is_spine = clean_port in (2211, 2212, 2001, 2002)
    return DeviceProbeResult(
        reachable=True,
        detected_platform=platform,
        detected_role=DeviceRole.SPINE if is_spine else DeviceRole.LEAF,
        hostname=f"spine-{clean_port % 10}.croc.lab"
        if is_spine
        else f"leaf-{max(1, clean_port % 10)}.croc.lab",
        os_version=f"Offline Emulation ({platform.value})",
        cpu_cores=2,
        ram_gb=4.0,
        disk_gb=8.0,
        interfaces=list(plat_cfg.get("offline_interfaces") or ["GigabitEthernet1", "GigabitEthernet2"]),
        lldp_neighbors=[
            {"local_port": "eth1", "neighbor": "spine-1.croc.lab", "remote_port": "eth1"}
        ],
        message=f"Офлайн-режим: эмуляция узла {clean_ip}:{clean_port}",
    )


def _probe_tcp_banner(clean_ip: str, clean_port: int) -> tuple[bool, str]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3.0)
    banner = ""
    try:
        sock.connect((clean_ip, clean_port))
        sock.settimeout(2.0)
        try:
            banner = sock.recv(1024).decode("utf-8", errors="ignore").strip()
        except Exception:
            pass
        sock.close()
        return True, banner
    except Exception as exc:
        logger.info("Probe TCP connection failed for %s:%s: %s", clean_ip, clean_port, exc)
        sock.close()
        return False, ""


def _parse_ssh_hardware_specs(
    conn: _ParamikoConnAdapter, initial_platform: Platform, fallback_ver: str
) -> tuple[Platform, str, int, float | None, float | None]:
    profiles = load_platform_profiles()
    plat_cfg = profiles.get(initial_platform.value) or {}
    cmds = plat_cfg.get("commands") or {}
    ver_cmd = str(cmds.get("version") or "show version")
    ver_out = conn.send_command(ver_cmd).result
    detected_platform = detect_platform_from_version(ver_out, initial_platform, profiles)
    plat_cfg = profiles.get(detected_platform.value) or plat_cfg
    cmds = plat_cfg.get("commands") or cmds

    ram_gb: float | None = None
    m_kb = (
        re.search(r"(\d+)\s*K(?:B| bytes) of physical memory", ver_out, re.IGNORECASE)
        or re.search(
            r"(\d+)\s*K(?:/\d+K)?\s*(?:B|bytes) of (?:physical )?memory", ver_out, re.IGNORECASE
        )
        or re.search(r"Total memory:\s*(\d+)\s*KB", ver_out, re.IGNORECASE)
    )
    if m_kb:
        ram_gb = round(int(m_kb.group(1)) / (1024 * 1024), 2)
    else:
        m_mb = re.search(r"(?:SDRAM|Memory)\s*[:Size]*\s*(\d+)\s*M(?:B|iB)", ver_out, re.IGNORECASE)
        if m_mb:
            ram_gb = round(int(m_mb.group(1)) / 1024, 2)
    if ram_gb is None and cmds.get("memory"):
        mem_out = conn.send_command(str(cmds["memory"])).result
        m_hw = re.search(r"Total\s*:\s*(\d+)", mem_out, re.IGNORECASE)
        if m_hw:
            val = int(m_hw.group(1))
            ram_gb = round(val / (1024 * 1024 if val > 100_000 else 1024), 2)

    disk_gb: float | None = None
    m_flash = re.search(
        r"(\d+)\s*K(?:B| bytes) of (?:virtual hard disk|flash|bootflash)", ver_out, re.IGNORECASE
    ) or re.search(r"(\d+)\s*K(?:B| bytes) of non-volatile", ver_out, re.IGNORECASE)
    if m_flash:
        disk_gb = round(int(m_flash.group(1)) / (1024 * 1024), 2)
    else:
        dir_out = conn.send_command("dir").result
        m_bytes = re.search(r"(\d+)\s*bytes total", dir_out, re.IGNORECASE)
        m_kb_dir = re.search(r"([\d,]+)\s*KB total", dir_out, re.IGNORECASE)
        if m_bytes:
            disk_gb = round(int(m_bytes.group(1)) / (1024**3), 2)
        elif m_kb_dir:
            disk_gb = round(int(m_kb_dir.group(1).replace(",", "")) / (1024 * 1024), 2)

    m_cpu = re.search(r"(\d+)\s*(?:Virtual )?CPU", ver_out, re.IGNORECASE)
    cpu_cores = int(m_cpu.group(1)) if m_cpu else 1

    lines_clean = [
        ln.strip()
        for ln in ver_out.splitlines()
        if ln.strip()
        and not ln.strip().endswith(("#", ">", "]"))
        and "version" not in ln.strip().lower()[:15]
    ]
    os_ver = lines_clean[0][:100] if lines_clean else fallback_ver
    return detected_platform, os_ver, cpu_cores, ram_gb, disk_gb


def _parse_ssh_topology(
    conn: _ParamikoConnAdapter, platform: Platform, default_hostname: str
) -> tuple[str, list[str], list[dict[str, Any]]]:
    profiles = load_platform_profiles()
    plat_cfg = profiles.get(platform.value) or {}
    cmds = plat_cfg.get("commands") or {}
    if_prefixes = tuple(
        str(p) for p in (plat_cfg.get("interface_prefixes") or ("Gigabit", "Ethernet", "Loop", "Management", "GE", "MEth"))
    )
    lldp_prefixes = tuple(
        str(p) for p in (plat_cfg.get("lldp_port_prefixes") or ("Gi", "Et", "GE", "eth"))
    )

    hostname = default_hostname
    run_out = conn.send_command(
        str(cmds.get("hostname_filter") or "show running-config | include hostname")
    ).result
    for hm in re.finditer(r"^\s*(?:hostname|sysname)\s+([A-Za-z0-9._-]+)", run_out, re.MULTILINE):
        raw_h = hm.group(1).strip()
        if raw_h.lower() not in ("hostname", "sysname", "include"):
            hostname = raw_h if "." in raw_h else f"{raw_h}.croc.lab"
            break
    else:
        pm = re.search(r"(?:^|\n)<?([A-Za-z0-9._-]+?)(?:\([^)]*\))?[>#\]]\s*$", run_out.strip())
        if pm and pm.group(1).lower() not in ("hostname", "sysname", "switch", "router", "huawei"):
            raw_h = pm.group(1).strip()
            hostname = raw_h if "." in raw_h else f"{raw_h}.croc.lab"

    int_cmd = str(cmds.get("interfaces_brief") or "show ip interface brief")
    interfaces = [
        line.split()[0]
        for line in conn.send_command(int_cmd).result.splitlines()
        if line.split() and line.split()[0].startswith(if_prefixes)
    ]

    lldp_cmd = str(cmds.get("lldp_neighbors") or "show lldp neighbors")
    lldp_neighbors: list[dict[str, Any]] = []
    for line in conn.send_command(lldp_cmd).result.splitlines():
        parts = line.split()
        if len(parts) >= 3 and any(p.startswith(lldp_prefixes) for p in parts[:3]):
            lldp_neighbors.append(
                {"local_port": parts[0], "neighbor": parts[1], "remote_port": parts[-1]}
            )
    return hostname, interfaces, lldp_neighbors


def run_device_probe(req: DeviceProbeRequest, container: Any) -> DeviceProbeResult:
    clean_ip, clean_port = _normalize_probe_endpoint(req.management_ip, req.management_port)
    if container.settings.network_driver == "offline":
        return _simulate_offline_probe(clean_ip, clean_port)

    reachable, banner = _probe_tcp_banner(clean_ip, clean_port)
    if not reachable and not req.proxy_jump:
        return DeviceProbeResult(
            reachable=False,
            detected_platform=Platform.CISCO_IOSXE,
            detected_role=DeviceRole.LEAF,
            hostname=f"node-{clean_port}",
            os_version="Unreachable",
            cpu_cores=None,
            ram_gb=None,
            disk_gb=None,
            interfaces=[],
            lldp_neighbors=[],
            message=f"Узел {clean_ip}:{clean_port} недоступен по сети.",
        )

    profiles = load_platform_profiles(container.settings.intent_repo_path)
    detected_platform = detect_platform_from_banner(banner, profiles)
    plat_cfg = profiles.get(detected_platform.value) or {}
    default_pw = str(plat_cfg.get("default_password") or "admin")
    req_pw = req.password if (req.password and req.password != "admin") else default_pw
    target = DeviceTarget(
        hostname=f"probe-{clean_port}",
        platform=detected_platform,
        host=clean_ip,
        port=clean_port,
        credentials=Credentials(req.username or "admin", req_pw),
    )
    hostname = f"node-{clean_port}"
    os_ver = banner or detected_platform.value
    try:
        with _ParamikoConnAdapter(target, timeout=12, proxy_jump=req.proxy_jump) as conn:
            detected_platform, os_ver, cpu_cores, ram_gb, disk_gb = _parse_ssh_hardware_specs(
                conn, detected_platform, os_ver
            )
            hostname, interfaces, lldp_neighbors = _parse_ssh_topology(
                conn, detected_platform, hostname
            )
    except Exception as exc:
        return DeviceProbeResult(
            reachable=False,
            detected_platform=detected_platform,
            detected_role=DeviceRole.SPINE if "spine" in hostname else DeviceRole.LEAF,
            hostname=hostname,
            os_version=os_ver,
            interfaces=[],
            lldp_neighbors=[],
            message=f"TCP-порт открыт ({banner or 'passthrough'}), но SSH-сессия не установлена: {exc}",
        )

    role = DeviceRole.SPINE if "spine" in hostname.lower() else DeviceRole.LEAF
    return DeviceProbeResult(
        reachable=True,
        detected_platform=detected_platform,
        detected_role=role,
        hostname=hostname,
        os_version=os_ver,
        cpu_cores=cpu_cores,
        ram_gb=ram_gb,
        disk_gb=disk_gb,
        interfaces=interfaces,
        lldp_neighbors=lldp_neighbors,
        message=f"Успешно: подключено по SSH к {hostname} ({detected_platform.value})",
    )


def _parse_running_interfaces(cfg: str) -> list[dict[str, Any]]:
    parsed_ifaces: list[dict[str, Any]] = []
    cur_if: dict[str, Any] | None = None
    for raw_line in cfg.splitlines():
        line = raw_line.strip()
        m_if = re.match(r"^interface\s+(\S+)", line, re.IGNORECASE)
        if m_if:
            if cur_if and cur_if.get("ipv4_address"):
                parsed_ifaces.append(cur_if)
            if_name = m_if.group(1)
            if not if_name.lower().startswith(("mgmt", "management", "meth", "null", "vlan")):
                cur_if = {"name": if_name, "enabled": True, "mode": "l3", "mtu": 1500}
            else:
                cur_if = None
            continue
        if cur_if is not None:
            if line.startswith(("!", "#")):
                if cur_if.get("ipv4_address"):
                    parsed_ifaces.append(cur_if)
                cur_if = None
                continue
            m_desc = re.match(r"^description\s+(.+)$", line, re.IGNORECASE)
            if m_desc:
                cur_if["description"] = m_desc.group(1).strip()
            m_cidr = re.match(r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+/\d+)", line, re.IGNORECASE)
            if m_cidr:
                cur_if["ipv4_address"] = m_cidr.group(1)
            else:
                m_mask = re.match(
                    r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)",
                    line,
                    re.IGNORECASE,
                )
                if m_mask:
                    try:
                        net = ipaddress.IPv4Network(
                            f"{m_mask.group(1)}/{m_mask.group(2)}", strict=False
                        )
                        cur_if["ipv4_address"] = f"{m_mask.group(1)}/{net.prefixlen}"
                    except ValueError:
                        pass
    if cur_if and cur_if.get("ipv4_address"):
        parsed_ifaces.append(cur_if)
    return parsed_ifaces


def extract_brownfield_intent(
    device: Device, data: DeviceCreate, settings: Any
) -> dict[str, Any] | None:
    """Try to pull live running-config via SSH and extract real interfaces & BGP intent."""
    profiles = load_platform_profiles(settings.intent_repo_path)
    plat_cfg = profiles.get(device.platform.value) or {}
    cmds = plat_cfg.get("commands") or {}
    profile = settings.auth_profiles.get(device.auth_profile)
    user = data.username or (profile.username if profile else "admin")
    default_pw = str(plat_cfg.get("default_password") or "admin")
    pw = (
        data.password
        if (data.password and data.password != "admin")
        else (profile.password.get_secret_value() if profile else default_pw)
    )
    target = DeviceTarget(
        hostname=device.hostname,
        platform=device.platform,
        host=str(device.management_ip),
        port=int(device.management_port),
        credentials=Credentials(user, pw),
        proxy_jump=data.proxy_jump,
    )
    try:
        with _ParamikoConnAdapter(target, timeout=10, proxy_jump=data.proxy_jump) as conn:
            cmd = str(cmds.get("running_config") or "show running-config")
            cfg = conn.send_command(cmd).result
    except Exception:
        return None

    parsed_ifaces = _parse_running_interfaces(cfg)
    m_asn = re.search(r"^(?:router\s+bgp|bgp)\s+(\d+)", cfg, re.IGNORECASE | re.MULTILINE)
    if not parsed_ifaces or not m_asn:
        return None

    asn = int(m_asn.group(1))
    m_rid = re.search(
        r"(?:bgp\s+router-id|router-id)\s+(\d+\.\d+\.\d+\.\d+)", cfg, re.IGNORECASE
    )
    router_id = m_rid.group(1) if m_rid else parsed_ifaces[0]["ipv4_address"].split("/")[0]

    neighbors = [
        {
            "peer_ip": m_nb.group(1),
            "remote_asn": int(m_nb.group(2)),
            "description": "fabric-peer",
            "announced_prefixes": [f"{router_id}/32"],
        }
        for m_nb in re.finditer(
            r"(?:neighbor|peer)\s+(\d+\.\d+\.\d+\.\d+)\s+(?:remote-as|as-number)\s+(\d+)",
            cfg,
            re.IGNORECASE,
        )
    ]
    if not neighbors:
        return None

    return {
        "hostname": device.hostname,
        "interfaces": parsed_ifaces,
        "bgp": {"asn": asn, "router_id": router_id, "neighbors": neighbors},
        "acls": [],
    }


def _build_default_device_intent(device: Device) -> dict[str, Any]:
    idx = (device.id or 5) + 10
    asn = 65000 if device.role == DeviceRole.SPINE else 65100 + idx
    lo_ip = f"10.255.0.{idx}"
    plat_cfg = load_platform_profiles().get(device.platform.value) or {}
    if_name = str(plat_cfg.get("default_interface") or "GigabitEthernet2")
    return {
        "hostname": device.hostname,
        "interfaces": [
            {
                "name": "Loopback0",
                "description": "Router-ID and BGP source",
                "enabled": True,
                "mode": "l3",
                "ipv4_address": f"{lo_ip}/32",
                "mtu": 1500,
            },
            {
                "name": if_name,
                "description": "Fabric link",
                "enabled": True,
                "mode": "l3",
                "ipv4_address": f"10.0.{idx}.0/31",
                "mtu": 1500,
            },
        ],
        "bgp": {
            "asn": asn,
            "router_id": lo_ip,
            "neighbors": [
                {
                    "peer_ip": f"10.0.{idx}.1",
                    "remote_asn": 65000 if device.role == DeviceRole.LEAF else 65101,
                    "description": "fabric-peer",
                    "announced_prefixes": [f"{lo_ip}/32"],
                }
            ],
        },
        "acls": [],
    }


def _persist_custom_auth(settings: Any, profile_name: str, username: str, password: str) -> None:
    settings.auth_profiles[profile_name] = AuthProfile(
        username=username, password=SecretStr(password)
    )
    if _is_protected_repo_path(settings.offline_lab_path):
        return
    try:
        custom_auth_file = settings.offline_lab_path / "custom_auth_profiles.json"
        custom_auth_file.parent.mkdir(parents=True, exist_ok=True)
        existing_profiles = {}
        if custom_auth_file.is_file():
            existing_profiles = json.loads(custom_auth_file.read_text(encoding="utf-8"))
        existing_profiles[profile_name] = {"username": username, "password": password}
        custom_auth_file.write_text(
            json.dumps(existing_profiles, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def bind_device_to_sot(data: DeviceCreate, device: Device, container: Any) -> None:
    """Persist custom SSH credentials and generate baseline Git SoT intent if missing."""
    settings = container.settings
    plat_cfg = load_platform_profiles(settings.intent_repo_path).get(data.platform.value) or {}
    default_pw = str(plat_cfg.get("default_password") or "admin")
    eff_pw = data.password if (data.password and data.password != "admin") else default_pw
    if data.username or default_pw != "admin":
        _persist_custom_auth(settings, data.auth_profile, data.username or "admin", eff_pw)

    if data.role == DeviceRole.SERVER or data.platform == Platform.LINUX_SERVER:
        return
    if _is_protected_repo_path(settings.intent_repo_path):
        return

    devices_dir = settings.intent_repo_path / "devices"
    devices_dir.mkdir(parents=True, exist_ok=True)
    intent_file = devices_dir / f"{device.hostname}.yaml"
    if not intent_file.is_file():
        baseline_intent = extract_brownfield_intent(device, data, settings)
        if baseline_intent is not None:
            try:
                DeviceIntent.model_validate(baseline_intent)
                existing_rids = set()
                for f in devices_dir.glob("*.yaml"):
                    if f.name != intent_file.name:
                        raw = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
                        rid = (raw.get("bgp") or {}).get("router_id")
                        if rid:
                            existing_rids.add(str(rid))
                if str((baseline_intent.get("bgp") or {}).get("router_id")) in existing_rids:
                    baseline_intent = None
            except Exception:
                baseline_intent = None
        if baseline_intent is None:
            baseline_intent = _build_default_device_intent(device)
            DeviceIntent.model_validate(baseline_intent)
        intent_file.write_text(
            yaml.safe_dump(baseline_intent, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    for inv_name in ("inventory.yaml", "inventory.live.yaml"):
        inv_path = settings.intent_repo_path / inv_name
        if not inv_path.is_file():
            continue
        try:
            raw_inv = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
            dev_list = raw_inv.get("devices") or []
            if not any(d.get("hostname") == device.hostname for d in dev_list):
                dev_list.append(
                    {
                        "hostname": device.hostname,
                        "management_ip": str(device.management_ip),
                        "management_port": int(device.management_port),
                        "platform": device.platform.value,
                        "role": device.role.value,
                        "auth_profile": device.auth_profile,
                    }
                )
                raw_inv["devices"] = dev_list
                inv_path.write_text(
                    yaml.safe_dump(raw_inv, sort_keys=False, allow_unicode=True),
                    encoding="utf-8",
                )
        except Exception:
            pass


def remove_device_from_sot(
    hostname: str, intent_repo_path: Path, offline_lab_path: Path | None = None
) -> None:
    from netops.services.telemetry import clear_live_metrics  # noqa: PLC0415

    clear_live_metrics(hostname)
    if _is_protected_repo_path(intent_repo_path):
        return
    for extra_file in (
        intent_repo_path / "devices" / f"{hostname}.yaml",
        intent_repo_path / "diffs" / f"{hostname}.intended.cfg",
        intent_repo_path / "diffs" / f"{hostname}.remediation.patch",
        *(
            [offline_lab_path / f"{hostname}.cfg"]
            if offline_lab_path is not None and not _is_protected_repo_path(offline_lab_path)
            else []
        ),
    ):
        try:
            if extra_file.is_file():
                extra_file.unlink()
        except Exception:
            pass
    for inv_name in ("inventory.yaml", "inventory.live.yaml"):
        inv_path = intent_repo_path / inv_name
        if not inv_path.is_file():
            continue
        try:
            raw_inv = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
            dev_list = raw_inv.get("devices") or []
            filtered = [d for d in dev_list if d.get("hostname") != hostname]
            if len(filtered) != len(dev_list):
                raw_inv["devices"] = filtered
                inv_path.write_text(
                    yaml.safe_dump(raw_inv, sort_keys=False, allow_unicode=True),
                    encoding="utf-8",
                )
        except Exception:
            pass


def _emergency_cli_command(platform: Platform, action: str) -> str:
    plat_cfg = load_platform_profiles().get(platform.value) or {}
    em_cmds = plat_cfg.get("emergency_commands") or {}
    return str(em_cmds.get(action) or em_cmds.get("default") or "show version")


def execute_device_emergency_action(
    device: Device,
    data: DeviceEmergencyAction,
    container: Any,
    actor_username: str,
) -> dict[str, Any]:
    from netops.services.ai_guard import AiTelemetryGuard  # noqa: PLC0415

    AiTelemetryGuard.inject_anomaly(device.hostname, "clear")
    output = ""
    if container.settings.network_driver == "offline":
        toolchain = build_toolchain(container.settings)
        if data.action == "rollback_last_commit" and not _is_protected_repo_path(
            container.settings.offline_lab_path
        ):
            try:
                intent = toolchain.intent_repo.load_device(device.hostname)
                rendered = toolchain.renderer.render(device.platform, intent)
                cfg_file = container.settings.offline_lab_path / f"{device.hostname}.cfg"
                cfg_file.parent.mkdir(parents=True, exist_ok=True)
                cfg_file.write_text(rendered, encoding="utf-8")
                output = f"Restored {device.hostname}.cfg to Git SoT baseline ({len(rendered.splitlines())} lines)"
            except Exception as exc:
                output = f"Offline rollback completed ({exc})"
        else:
            cmd = _emergency_cli_command(device.platform, data.action)
            output = f"[Offline Lab {device.platform.value}] Executed '{cmd}' on {device.hostname}"
    else:
        toolchain = build_toolchain(container.settings)
        target = toolchain.target_for(InventoryDevice.model_validate(device))
        cmd = _emergency_cli_command(device.platform, data.action)
        try:
            with _ParamikoConnAdapter(target, timeout=20) as conn:
                output = conn.send_command(cmd).result
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"SSH ошибка при выполнении '{data.action}' на {device.hostname}: {exc}",
            ) from exc

    audit_path = container.settings.offline_lab_path / "emergency_audit.jsonl"
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor_username,
        "device": device.hostname,
        "device_id": device.id,
        "action": data.action,
        "reason": data.reason,
        "status": "EXECUTED",
        "output": output[:200],
    }
    if not _is_protected_repo_path(audit_path):
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with open(audit_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {
        "status": "SUCCESS",
        "action": data.action,
        "device": device.hostname,
        "message": f"Action '{data.action}' executed on {device.hostname}",
        "entry": entry,
    }
