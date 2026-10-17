"""Device SSH probing, Brownfield YAML intent extraction, and SoT binding service.

Extracted from `api/routes/devices.py` so the HTTP controller stays thin and declarative.
"""

from __future__ import annotations

import contextlib
import fcntl
import ipaddress
import logging
import os
import re
import socket
import threading
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException, status
from pydantic import SecretStr

from netops.enums import DeviceRole, Platform
from netops.intent.models import DeviceIntent, InventoryDevice
from netops.models import Device
from netops.network.base import Credentials, DeviceTarget
from netops.network.scrapli_driver import _ParamikoConnAdapter
from netops.schemas.devices import (
    DeviceCreate,
    DeviceEmergencyAction,
    DeviceProbeRequest,
    DeviceProbeResult,
)
from netops.settings import AuthProfile
from netops.toolchain import build_toolchain

logger = logging.getLogger(__name__)
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SOT_INV_LOCK = threading.RLock()


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
        with contextlib.suppress(ValueError):
            clean_port = int(parts[1])
    return clean_ip, clean_port


_PLATFORMS_DIR = _REPO_ROOT / "intent" / "platforms"


def load_platform_profiles(intent_repo_path: Path | None = None) -> dict[str, Any]:
    """Load declarative platform rules (SSH banners, version signatures, CLI commands).

    Read from intent/platforms/*.yaml.
    """
    from netops.intent.models import PlatformProfile

    if intent_repo_path is None:
        with contextlib.suppress(Exception):
            from netops.settings import get_settings

            intent_repo_path = get_settings().intent_repo_path

    profiles_dir = (
        intent_repo_path / "platforms"
        if intent_repo_path is not None and (intent_repo_path / "platforms").is_dir()
        else (
            Path("/data/intent/platforms")
            if Path("/data/intent/platforms").is_dir()
            else _PLATFORMS_DIR
        )
    )
    profiles: dict[str, Any] = {}
    if profiles_dir.is_dir():
        for yml_file in sorted(profiles_dir.glob("*.yaml")):
            try:
                raw = yaml.safe_load(yml_file.read_text(encoding="utf-8")) or {}
                if isinstance(raw, dict):
                    profile = PlatformProfile.model_validate(raw)
                    plat_key = str(getattr(profile.platform, "value", profile.platform)).lower()
                    profiles[plat_key] = profile
            except Exception:
                continue
    return profiles


def detect_platform_from_banner(
    banner: str, profiles: dict[str, dict[str, Any]] | None = None
) -> Platform:
    """Resolve Platform enum from TCP SSH banner using declarative ssh_banners."""
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
    """Resolve Platform enum from version command output using version_signatures."""
    active_profiles = profiles if profiles is not None else load_platform_profiles()
    for plat_name, cfg in active_profiles.items():
        for sig in cfg.get("version_signatures") or []:
            if str(sig).lower() in ver_out.lower():
                try:
                    return Platform(plat_name)
                except ValueError:
                    continue
    return initial_platform


def _resolve_domain(settings: Any = None) -> str:
    if settings is None:
        with contextlib.suppress(Exception):
            from netops.settings import get_settings

            settings = get_settings()
    dom = str(getattr(settings, "default_domain", "") or "").strip().lstrip(".")
    if dom:
        return dom
    repo = getattr(settings, "intent_repo_path", None)
    if repo is not None:
        inv_path = Path(repo) / "inventory.yaml"
        if inv_path.is_file():
            with contextlib.suppress(Exception):
                raw = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
                for dev in raw.get("devices") or []:
                    h = str(dev.get("hostname") or "")
                    if "." in h:
                        return h.split(".", 1)[1]
    return "croc.lab"


def _resolve_fabric_id(settings: Any = None) -> str:
    if settings is None:
        with contextlib.suppress(Exception):
            from netops.settings import get_settings

            settings = get_settings()
    fab = str(getattr(settings, "default_fabric_id", "") or "").strip()
    if fab:
        return fab
    repo = getattr(settings, "intent_repo_path", None)
    if repo is not None:
        inv_path = Path(repo) / "inventory.yaml"
        if inv_path.is_file():
            with contextlib.suppress(Exception):
                raw = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
                for dev in raw.get("devices") or []:
                    f_id = str(dev.get("fabric_id") or "").strip()
                    if f_id:
                        return f_id
    return "croc-dc1-pod1"


def _simulate_offline_probe(clean_ip: str, clean_port: int) -> DeviceProbeResult:
    profiles = load_platform_profiles()
    domain = _resolve_domain()
    platform = Platform.CISCO_IOSXE
    for plat_name, cfg in profiles.items():
        if clean_port in (cfg.get("offline_ports") or []):
            try:
                platform = Platform(plat_name)
                break
            except ValueError:
                continue
    plat_cfg = profiles.get(platform.value) or {}
    is_spine = platform in (Platform.CISCO_IOSXE, Platform.ARISTA_EOS) and (
        clean_port % 10 in (1, 2)
    )
    if platform == Platform.LINUX_SERVER:
        role = DeviceRole.SERVER
        hname = f"server-{max(1, clean_port % 10)}.{domain}"
    elif is_spine:
        role = DeviceRole.SPINE
        hname = f"spine-{clean_port % 10}.{domain}"
    else:
        role = DeviceRole.LEAF
        hname = f"leaf-{max(1, clean_port % 10)}.{domain}"

    default_ifaces = (
        ["eth0", "eth1"]
        if platform == Platform.LINUX_SERVER
        else ["GigabitEthernet1", "GigabitEthernet2"]
    )
    ifaces = list(plat_cfg.get("offline_interfaces") or default_ifaces)
    local_p = ifaces[-1] if ifaces else "eth1"
    peer_host = (
        f"leaf-1.{hname.split('.', 1)[1]}" if is_spine else f"spine-1.{hname.split('.', 1)[1]}"
    )
    return DeviceProbeResult(
        reachable=True,
        detected_platform=platform,
        detected_role=role,
        hostname=hname,
        os_version=f"Offline Emulation ({platform.value})",
        cpu_cores=2,
        ram_gb=4.0,
        disk_gb=8.0,
        interfaces=ifaces,
        lldp_neighbors=[{"local_port": local_p, "neighbor": peer_host, "remote_port": local_p}],
        message=f"Офлайн-режим: эмуляция узла {clean_ip}:{clean_port}",
    )


def _probe_tcp_banner(clean_ip: str, clean_port: int) -> tuple[bool, str]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3.0)
    banner = ""
    try:
        sock.connect((clean_ip, clean_port))
        sock.settimeout(2.0)
        with contextlib.suppress(Exception):
            banner = sock.recv(1024).decode("utf-8", errors="ignore").strip()
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
    ver_cmd = str(
        cmds.get("version")
        or ("uname -a" if initial_platform == Platform.LINUX_SERVER else "show version")
    )
    ver_out = conn.send_command(ver_cmd).result
    detected_platform = detect_platform_from_version(ver_out, initial_platform, profiles)
    plat_cfg = profiles.get(detected_platform.value) or plat_cfg
    cmds = plat_cfg.get("commands") or cmds

    if detected_platform == Platform.LINUX_SERVER:
        cpu_cores = 1
        try:
            nproc_out = conn.send_command("nproc").result.strip()
            if nproc_out.isdigit():
                cpu_cores = int(nproc_out)
            else:
                cpuinfo_out = conn.send_command("grep -c ^processor /proc/cpuinfo").result.strip()
                if cpuinfo_out.isdigit():
                    cpu_cores = int(cpuinfo_out)
        except Exception:
            pass

        ram_gb = None
        try:
            mem_out = conn.send_command("grep MemTotal /proc/meminfo").result
            m_mem = re.search(r"MemTotal:\s*(\d+)\s*kB", mem_out, re.IGNORECASE)
            if m_mem:
                ram_gb = round(int(m_mem.group(1)) / (1024 * 1024), 2)
            else:
                top_mem = conn.send_command(
                    str(cmds.get("memory") or "top -bn1 | head -n 5")
                ).result
                m_top = re.search(r"MiB Mem\s*:\s*([\d.]+)\s*total", top_mem, re.IGNORECASE)
                if m_top:
                    ram_gb = round(float(m_top.group(1)) / 1024, 2)
        except Exception:
            pass

        disk_gb = None
        try:
            df_out = conn.send_command("df -m /").result
            for line in df_out.splitlines():
                parts = line.split()
                if parts and (line.strip().endswith(" /") or parts[-1] == "/"):
                    if parts[0].isdigit():
                        disk_gb = round(int(parts[0]) / 1024, 2)
                        break
                    if len(parts) >= 2 and parts[1].isdigit():
                        disk_gb = round(int(parts[1]) / 1024, 2)
                        break
            if disk_gb is None:
                df_h_out = conn.send_command("df -h /").result
                m_h = re.search(
                    r"\s+(\d+(?:\.\d+)?)\s*([GMKT])i?B?\s+.*(?:\s|/)$", df_h_out, re.MULTILINE
                )
                if m_h:
                    val = float(m_h.group(1))
                    unit = m_h.group(2).upper()
                    if unit == "G":
                        disk_gb = round(val, 2)
                    elif unit == "T":
                        disk_gb = round(val * 1024, 2)
                    elif unit == "M":
                        disk_gb = round(val / 1024, 2)
        except Exception:
            pass

        lines_clean = [
            ln.strip()
            for ln in ver_out.splitlines()
            if ln.strip() and not ln.strip().endswith(("#", ">", "]", "$"))
        ]
        os_ver = lines_clean[0][:100] if lines_clean else fallback_ver
        return detected_platform, os_ver, cpu_cores, ram_gb, disk_gb

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


def _parse_linux_interfaces(output: str) -> list[dict[str, Any]]:
    """Parse 'ip addr show' or 'ip -o addr show' into standard L3 interface intent dicts."""
    interfaces: list[dict[str, Any]] = []
    if re.search(r"^\d+:\s+\S+\s+inet\s+", output, re.MULTILINE):
        seen_names: dict[str, dict[str, Any]] = {}
        for line in output.splitlines():
            m = re.match(
                r"^\d+:\s+([A-Za-z0-9._-]+)\s+inet\s+(\d+\.\d+\.\d+\.\d+/\d+)",
                line.strip(),
            )
            if m:
                if_name, ip = m.group(1), m.group(2)
                if if_name not in seen_names:
                    seen_names[if_name] = {
                        "name": if_name,
                        "description": f"Linux network interface {if_name}",
                        "enabled": True,
                        "mode": "l3",
                        "ipv4_address": ip,
                        "mtu": 1500,
                    }
        interfaces = list(seen_names.values())
    else:
        cur_if: dict[str, Any] | None = None
        for raw_line in output.splitlines():
            line = raw_line.strip()
            m_head = re.match(
                r"^\d+:\s+([A-Za-z0-9._-]+)(?:@\S+)?:.*?<([^>]*)>(?:\s+mtu\s+(\d+))?",
                line,
            )
            if m_head:
                if cur_if is not None:
                    interfaces.append(cur_if)
                if_name = m_head.group(1)
                flags = m_head.group(2)
                mtu_val = int(m_head.group(3)) if m_head.group(3) else 1500
                valid_mtu = max(68, min(9216, mtu_val))
                is_up = "UP" in flags.split(",")
                cur_if = {
                    "name": if_name,
                    "description": f"Linux network interface {if_name}",
                    "enabled": is_up,
                    "mode": "l3",
                    "ipv4_address": None,
                    "mtu": valid_mtu,
                }
                continue

            if cur_if is not None:
                m_inet = re.search(r"\binet\s+(\d+\.\d+\.\d+\.\d+/\d+)", line)
                if m_inet and not cur_if.get("ipv4_address"):
                    cur_if["ipv4_address"] = m_inet.group(1)

        if cur_if is not None:
            interfaces.append(cur_if)

    # Prevent overlapping subnets between distinct interfaces and clamp MTU
    filtered: list[dict[str, Any]] = []
    used_nets = []
    for iface in interfaces:
        entry = dict(iface)
        raw_mtu = entry.get("mtu")
        if isinstance(raw_mtu, (int, float, str)) and str(raw_mtu).isdigit():
            entry["mtu"] = max(68, min(9216, int(raw_mtu)))
        else:
            entry["mtu"] = 1500

        ip_str = entry.get("ipv4_address")
        if ip_str:
            try:
                net = ipaddress.IPv4Interface(ip_str).network
                if any(net.overlaps(un) for un in used_nets):
                    entry["ipv4_address"] = None
                else:
                    used_nets.append(net)
            except Exception:
                pass
        filtered.append(entry)

    return filtered


def _parse_ssh_topology(
    conn: _ParamikoConnAdapter, platform: Platform, default_hostname: str
) -> tuple[str, list[str], list[dict[str, Any]]]:
    profiles = load_platform_profiles()
    plat_cfg = profiles.get(platform.value) or {}
    cmds = plat_cfg.get("commands") or {}
    if_prefixes = tuple(
        str(p)
        for p in (
            plat_cfg.get("interface_prefixes")
            or (
                "Gigabit",
                "Ethernet",
                "Loop",
                "Management",
                "GE",
                "MEth",
                "eth",
                "lo",
                "ens",
                "enp",
            )
        )
    )
    lldp_prefixes = tuple(
        str(p)
        for p in (plat_cfg.get("lldp_port_prefixes") or ("Gi", "Et", "GE", "eth", "ens", "enp"))
    )

    hostname = default_hostname
    domain = _resolve_domain()
    run_out = conn.send_command(
        str(cmds.get("hostname_filter") or "show running-config | include hostname")
    ).result
    if platform == Platform.LINUX_SERVER and run_out.strip():
        first_line = run_out.strip().splitlines()[0].strip()
        if re.match(r"^[A-Za-z0-9._-]+$", first_line) and first_line.lower() not in (
            "hostname",
            "sysname",
            "include",
        ):
            hostname = first_line if "." in first_line else f"{first_line}.{domain}"
    else:
        for hm in re.finditer(
            r"^\s*(?:hostname|sysname)\s+([A-Za-z0-9._-]+)", run_out, re.MULTILINE
        ):
            raw_h = hm.group(1).strip()
            if raw_h.lower() not in ("hostname", "sysname", "include"):
                hostname = raw_h if "." in raw_h else f"{raw_h}.{domain}"
                break
        else:
            pm = re.search(r"(?:^|\n)<?([A-Za-z0-9._-]+?)(?:\([^)]*\))?[>#\]]\s*$", run_out.strip())
            if pm and pm.group(1).lower() not in (
                "hostname",
                "sysname",
                "switch",
                "router",
                "huawei",
            ):
                raw_h = pm.group(1).strip()
                hostname = raw_h if "." in raw_h else f"{raw_h}.{domain}"

    int_cmd = str(cmds.get("interfaces_brief") or "show ip interface brief")
    interfaces = [
        line.split()[0]
        for line in conn.send_command(int_cmd).result.splitlines()
        if line.split() and line.split()[0].startswith(if_prefixes)
    ]
    if not interfaces and platform == Platform.LINUX_SERVER:
        try:
            ip_out = conn.send_command("ip addr show").result
            interfaces = [it["name"] for it in _parse_linux_interfaces(ip_out)]
        except Exception:
            pass

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
        from netops.services.telemetry import collect_metrics_from_cli

        with _ParamikoConnAdapter(target, timeout=12, proxy_jump=req.proxy_jump) as conn:
            detected_platform, os_ver, cpu_cores, ram_gb, disk_gb = _parse_ssh_hardware_specs(
                conn, detected_platform, os_ver
            )
            hostname, interfaces, lldp_neighbors = _parse_ssh_topology(
                conn, detected_platform, hostname
            )
            collect_metrics_from_cli(
                hostname, detected_platform.value, lambda c: conn.send_command(c).result
            )
    except Exception as exc:
        return DeviceProbeResult(
            reachable=False,
            detected_platform=detected_platform,
            detected_role=(
                DeviceRole.SERVER
                if detected_platform == Platform.LINUX_SERVER
                else (DeviceRole.SPINE if "spine" in hostname else DeviceRole.LEAF)
            ),
            hostname=hostname,
            os_version=os_ver,
            interfaces=[],
            lldp_neighbors=[],
            message=(
                f"TCP-порт открыт ({banner or 'passthrough'}), но SSH-сессия не установлена: {exc}"
            ),
        )

    role = (
        DeviceRole.SERVER
        if detected_platform == Platform.LINUX_SERVER
        else (DeviceRole.SPINE if "spine" in hostname.lower() else DeviceRole.LEAF)
    )
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


def _flush_parsed_iface(cur_if: dict[str, Any] | None, out: list[dict[str, Any]]) -> None:
    if cur_if and not cur_if.pop("_is_mgmt", False):
        if cur_if.get("ipv4_address") or cur_if.get("mode") == "l2":
            out.append(cur_if)


def _parse_running_interfaces(cfg: str) -> list[dict[str, Any]]:
    parsed_ifaces: list[dict[str, Any]] = []
    cur_if: dict[str, Any] | None = None
    has_global_ospf = bool(re.search(r"^(?:router\s+)?ospf\s+\d+", cfg, re.IGNORECASE | re.MULTILINE))
    for raw_line in cfg.splitlines():
        line = raw_line.strip()
        m_if = re.match(r"^interface\s+(\S+)", line, re.IGNORECASE)
        if m_if:
            _flush_parsed_iface(cur_if, parsed_ifaces)
            if_name = m_if.group(1)
            if not if_name.lower().startswith(
                ("mgmt", "management", "meth", "null", "vlan", "nve")
            ):
                cur_if = {"name": if_name, "enabled": True, "mode": "l3", "mtu": 1500}
            else:
                cur_if = None
            continue
        if cur_if is not None:
            if line.startswith(("!", "#")):
                _flush_parsed_iface(cur_if, parsed_ifaces)
                cur_if = None
                continue
            if re.match(r"^shutdown$", line, re.IGNORECASE):
                cur_if["enabled"] = False
            elif re.match(r"^(?:no|undo)\s+shutdown$", line, re.IGNORECASE):
                cur_if["enabled"] = True
            if re.match(
                r"^(?:vrf\s+forwarding|ip\s+binding\s+vpn-instance)\s+", line, re.IGNORECASE
            ):
                cur_if["_is_mgmt"] = True
            m_desc = re.match(r"^description\s+(.+)$", line, re.IGNORECASE)
            if m_desc:
                desc_val = m_desc.group(1).strip()
                cur_if["description"] = desc_val
                if "management" in desc_val.lower():
                    cur_if["_is_mgmt"] = True
            m_mtu = re.match(r"^mtu\s+(\d+)", line, re.IGNORECASE)
            if m_mtu:
                cur_if["mtu"] = max(68, min(9216, int(m_mtu.group(1))))
            m_vlan = re.match(
                r"^(?:switchport\s+access\s+vlan|port\s+default\s+vlan)\s+(\d+)",
                line,
                re.IGNORECASE,
            )
            if m_vlan:
                cur_if["mode"] = "l2"
                cur_if["access_vlan"] = int(m_vlan.group(1))
            m_ospf = re.match(r"^ip\s+ospf\s+(?:\d+\s+)?area\s+(\S+)", line, re.IGNORECASE)
            if m_ospf:
                cur_if["ospf_area"] = m_ospf.group(1)
            elif re.match(r"^ospf\s+(?:network-type|enable)", line, re.IGNORECASE):
                cur_if["ospf_area"] = "0.0.0.0"
            m_acl = re.match(
                r"^(?:ip\s+access-group\s+(\S+)\s+in|traffic-filter\s+inbound\s+acl\s+name\s+(\S+))",
                line,
                re.IGNORECASE,
            )
            if m_acl:
                cur_if["acl_in"] = m_acl.group(1) or m_acl.group(2)
            m_cidr = re.match(r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+/\d+)", line, re.IGNORECASE)
            if m_cidr:
                cur_if["ipv4_address"] = m_cidr.group(1)
            else:
                m_mask = re.match(
                    r"^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+|\d{1,2})\b",
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
    _flush_parsed_iface(cur_if, parsed_ifaces)
    if has_global_ospf:
        for iface in parsed_ifaces:
            if (
                iface["name"].lower().startswith("loopback")
                and iface.get("ipv4_address")
                and "ospf_area" not in iface
            ):
                lo_ip = str(iface["ipv4_address"]).split("/")[0]
                if f"network {lo_ip} " in cfg:
                    iface["ospf_area"] = "0.0.0.0"
    return parsed_ifaces


_PORT_MAP = {"bgp": 179, "ssh": 22, "telnet": 23, "snmp": 161, "www": 80, "https": 443, "domain": 53}


def _wildcard_to_cidr(ip_str: str, wc_str: str) -> str:
    try:
        mask_octets = [str(255 - int(o)) for o in wc_str.split(".")]
        net = ipaddress.IPv4Network(f"{ip_str}/{'.'.join(mask_octets)}", strict=False)
        return str(net)
    except Exception:
        return "any"


def _parse_acl_endpoint(tokens: list[str], idx: int) -> tuple[str, int]:
    if idx >= len(tokens):
        return "any", idx
    tok = tokens[idx].lower()
    if tok == "any":
        return "any", idx + 1
    if tok == "host" and idx + 1 < len(tokens):
        return f"{tokens[idx + 1]}/32", idx + 2
    if "/" in tokens[idx]:
        return tokens[idx], idx + 1
    if idx + 1 < len(tokens) and re.match(r"^\d+\.\d+\.\d+\.\d+$", tokens[idx + 1]):
        return _wildcard_to_cidr(tokens[idx], tokens[idx + 1]), idx + 2
    return "any", idx + 1


def _parse_running_acls(cfg: str) -> list[dict[str, Any]]:
    acls: list[dict[str, Any]] = []
    cur_acl: dict[str, Any] | None = None
    for raw_line in cfg.splitlines():
        line = raw_line.strip()
        m_head = re.match(
            r"^(?:ip\s+access-list\s+(?:extended\s+)?(\S+)|acl\s+name\s+(\S+)\s+advance)",
            line,
            re.IGNORECASE,
        )
        if m_head:
            if cur_acl and cur_acl["rules"]:
                acls.append(cur_acl)
            cur_acl = {"name": m_head.group(1) or m_head.group(2), "rules": []}
            continue
        if cur_acl is None:
            continue
        if line.startswith(("!", "#")) or re.match(
            r"^(?:interface|router|bgp|ospf|line|snmp-server)\b", line, re.IGNORECASE
        ):
            if cur_acl["rules"]:
                acls.append(cur_acl)
            cur_acl = None
            continue
        m_hw = re.match(
            r"^rule\s+(\d+)\s+(permit|deny)\s+(ip|tcp|udp|icmp|ospf)\b(.*)$",
            line,
            re.IGNORECASE,
        )
        if m_hw:
            seq, act, proto, rest = (
                int(m_hw.group(1)),
                m_hw.group(2).lower(),
                m_hw.group(3).lower(),
                m_hw.group(4),
            )
            src = "any"
            dst = "any"
            m_src = re.search(r"source\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)", rest)
            if m_src:
                src = _wildcard_to_cidr(m_src.group(1), m_src.group(2))
            m_dst = re.search(r"destination\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)", rest)
            if m_dst:
                dst = _wildcard_to_cidr(m_dst.group(1), m_dst.group(2))
            rule: dict[str, Any] = {
                "sequence": seq,
                "action": act,
                "protocol": proto,
                "source": src,
                "destination": dst,
            }
            m_sp = re.search(r"source-port\s+eq\s+(\S+)", rest)
            if m_sp:
                sp_raw = m_sp.group(1).lower()
                rule["src_port"] = _PORT_MAP.get(sp_raw) or (int(sp_raw) if sp_raw.isdigit() else None)
            m_dp = re.search(r"destination-port\s+eq\s+(\S+)", rest)
            if m_dp:
                dp_raw = m_dp.group(1).lower()
                rule["dst_port"] = _PORT_MAP.get(dp_raw) or (int(dp_raw) if dp_raw.isdigit() else None)
            cur_acl["rules"].append(rule)
            continue

        m_cisco = re.match(
            r"^(\d+)\s+(permit|deny)\s+(ip|tcp|udp|icmp|ospf)\s+(.+)$",
            line,
            re.IGNORECASE,
        )
        if m_cisco:
            seq, act, proto = (
                int(m_cisco.group(1)),
                m_cisco.group(2).lower(),
                m_cisco.group(3).lower(),
            )
            toks = m_cisco.group(4).split()
            src, idx = _parse_acl_endpoint(toks, 0)
            src_port = None
            if idx + 1 < len(toks) and toks[idx].lower() == "eq":
                sp_raw = toks[idx + 1].lower()
                src_port = _PORT_MAP.get(sp_raw) or (int(sp_raw) if sp_raw.isdigit() else None)
                idx += 2
            dst, idx = _parse_acl_endpoint(toks, idx)
            dst_port = None
            if idx + 1 < len(toks) and toks[idx].lower() == "eq":
                dp_raw = toks[idx + 1].lower()
                dst_port = _PORT_MAP.get(dp_raw) or (int(dp_raw) if dp_raw.isdigit() else None)
            rule = {
                "sequence": seq,
                "action": act,
                "protocol": proto,
                "source": src,
                "destination": dst,
            }
            if src_port:
                rule["src_port"] = src_port
            if dst_port:
                rule["dst_port"] = dst_port
            cur_acl["rules"].append(rule)
    if cur_acl and cur_acl["rules"]:
        acls.append(cur_acl)
    return acls


def _parse_bgp_announced_prefixes(cfg: str, router_id: str) -> list[str]:
    prefixes: list[str] = []
    in_bgp = False
    for raw_line in cfg.splitlines():
        line = raw_line.strip()
        if re.match(r"^(?:router\s+bgp|bgp)\s+\d+", line, re.IGNORECASE):
            in_bgp = True
            continue
        if in_bgp and re.match(r"^(?:ip\s+access-list|acl\s+name|ospf|router\s+ospf|line)\b", line, re.IGNORECASE):
            in_bgp = False
        if not in_bgp:
            continue
        m_cidr = re.match(r"^network\s+(\d+\.\d+\.\d+\.\d+/\d+)", line, re.IGNORECASE)
        if m_cidr:
            if m_cidr.group(1) not in prefixes:
                prefixes.append(m_cidr.group(1))
            continue
        m_mask = re.match(
            r"^network\s+(\d+\.\d+\.\d+\.\d+)\s+(?:mask\s+)?(\d+\.\d+\.\d+\.\d+)",
            line,
            re.IGNORECASE,
        )
        if m_mask and m_mask.group(2) != "0.0.0.0":
            with contextlib.suppress(ValueError):
                net = ipaddress.IPv4Network(f"{m_mask.group(1)}/{m_mask.group(2)}", strict=False)
                cidr = str(net)
                if cidr not in prefixes:
                    prefixes.append(cidr)
    return prefixes or [f"{router_id}/32"]


def _parse_brownfield_intent_from_config(
    hostname: str, cfg: str, platform: Platform | str | None = None
) -> dict[str, Any] | None:
    plat_str = str(getattr(platform, "value", platform or "")).lower()
    if (
        plat_str == "linux_server"
        or "link/ether" in cfg
        or "link/loopback" in cfg
        or re.search(r"^\d+:\s+\S+:\s+<", cfg, re.MULTILINE)
    ):
        linux_ifaces = _parse_linux_interfaces(cfg)
        if linux_ifaces:
            return {
                "hostname": hostname,
                "interfaces": linux_ifaces,
                "bgp": None,
                "acls": [],
            }

    parsed_ifaces = _parse_running_interfaces(cfg)
    m_asn = re.search(r"^(?:router\s+bgp|bgp)\s+(\d+)", cfg, re.IGNORECASE | re.MULTILINE)
    if not parsed_ifaces or not m_asn:
        return None

    asn = int(m_asn.group(1))
    m_rid = re.search(r"(?:bgp\s+router-id|router-id)\s+(\d+\.\d+\.\d+\.\d+)", cfg, re.IGNORECASE)
    l3_ips = [str(i["ipv4_address"]).split("/")[0] for i in parsed_ifaces if i.get("ipv4_address")]
    router_id = m_rid.group(1) if m_rid else (l3_ips[0] if l3_ips else "10.255.0.1")

    announced = _parse_bgp_announced_prefixes(cfg, router_id)
    peer_descriptions: dict[str, str] = {}
    for m_desc in re.finditer(
        r"(?:neighbor|peer)\s+(\d+\.\d+\.\d+\.\d+)\s+description\s+([^\r\n]+)",
        cfg,
        re.IGNORECASE,
    ):
        peer_descriptions[m_desc.group(1)] = m_desc.group(2).strip().strip('"')

    neighbors: list[dict[str, Any]] = []
    seen_peers: set[str] = set()
    for m_nb in re.finditer(
        r"(?:neighbor|peer)\s+(\d+\.\d+\.\d+\.\d+)\s+(?:remote-as|as-number)\s+(\d+)",
        cfg,
        re.IGNORECASE,
    ):
        peer_ip = m_nb.group(1)
        if peer_ip not in seen_peers:
            seen_peers.add(peer_ip)
            neighbors.append(
                {
                    "peer_ip": peer_ip,
                    "remote_asn": int(m_nb.group(2)),
                    "description": peer_descriptions.get(peer_ip, "fabric-peer"),
                    "announced_prefixes": list(announced),
                }
            )
    if not neighbors:
        return None

    parsed_acls = _parse_running_acls(cfg)
    known_acl_names = {a["name"] for a in parsed_acls}
    for iface in parsed_ifaces:
        if iface.get("acl_in") and iface["acl_in"] not in known_acl_names:
            iface.pop("acl_in", None)

    bgp_dict: dict[str, Any] = {"asn": asn, "router_id": router_id, "neighbors": neighbors}
    if re.search(r"(?:address-family\s+(?:l2vpn\s+)?evpn|l2vpn-family\s+evpn)", cfg, re.IGNORECASE):
        bgp_dict["evpn"] = True
    m_vni = re.search(
        r"(?:\bvni\s+(\d+)(?:\s+head-end)?|\bvxlan\s+vni\s+(\d+))", cfg, re.IGNORECASE
    )
    if m_vni:
        bgp_dict["vxlan_vni"] = int(m_vni.group(1) or m_vni.group(2))

    return {
        "hostname": hostname,
        "interfaces": parsed_ifaces,
        "bgp": bgp_dict,
        "acls": parsed_acls,
    }


def discover_live_switch_via_ssh(
    host: str,
    port: int,
    username: str,
    password: str,
    settings: Any,
    default_hostname: str = "",
    default_role: str = "",
    candidate_passwords: list[str] | None = None,
    passwords_by_platform: dict[str, str] | None = None,
    initial_platform: Platform | None = None,
) -> dict[str, Any] | None:
    """Probe TCP banner, connect via SSH, extract live identity.

    Extracts running-config and brownfield intent.
    """
    profiles = load_platform_profiles(getattr(settings, "intent_repo_path", None))
    if initial_platform is not None:
        reachable = True
        banner = f"SSH-2.0-{initial_platform.value}"
        detected_platform = initial_platform
    else:
        reachable, banner = _probe_tcp_banner(host, port)
        if not reachable or not banner:
            return None
        detected_platform = detect_platform_from_banner(banner, profiles)

    plat_cfg = profiles.get(detected_platform.value) or {}

    default_pw = str(plat_cfg.get("default_password") or "admin")
    plat_pw = (passwords_by_platform or {}).get(detected_platform.value, "")
    non_admin_cands = [p for p in (candidate_passwords or []) if p and p != "admin"]
    pw_candidates: list[str] = []
    for pw in (
        *([plat_pw] if plat_pw and plat_pw != "admin" else []),
        *([password] if password and password != "admin" else []),
        *non_admin_cands,
        plat_pw,
        password,
        *(candidate_passwords or []),
        default_pw,
        "admin",
    ):
        if pw and pw not in pw_candidates:
            pw_candidates.append(pw)

    domain = _resolve_domain(settings)
    fallback_host = default_hostname or f"node-{port}.{domain}"
    os_ver = banner or detected_platform.value
    running_config = ""
    used_pw = pw_candidates[0] if pw_candidates else "admin"
    connected = False
    cpu_cores: int | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    interfaces: list[str] = []
    lldp_neighbors: list[dict[str, Any]] = []
    hostname = fallback_host

    from netops.services.telemetry import collect_metrics_from_cli

    for pw in pw_candidates:
        target = DeviceTarget(
            hostname=fallback_host,
            platform=detected_platform,
            host=host,
            port=port,
            credentials=Credentials(username or "admin", pw),
        )
        try:
            with _ParamikoConnAdapter(target, timeout=8) as conn:
                detected_platform, os_ver, cpu_cores, ram_gb, disk_gb = _parse_ssh_hardware_specs(
                    conn, detected_platform, os_ver
                )
                hostname, interfaces, lldp_neighbors = _parse_ssh_topology(
                    conn, detected_platform, fallback_host
                )
                plat_cfg = profiles.get(detected_platform.value) or plat_cfg
                run_cmd = str(
                    (plat_cfg.get("commands") or {}).get("running_config") or "show running-config"
                )
                running_config = conn.send_command(run_cmd).result
                collect_metrics_from_cli(
                    hostname, detected_platform.value, lambda c: conn.send_command(c).result
                )
                used_pw = pw
                connected = True
                break
        except Exception:
            continue

    if not connected:
        return None

    role = (
        "server"
        if detected_platform == Platform.LINUX_SERVER
        else ("spine" if ("spine" in hostname.lower() or default_role == "spine") else "leaf")
    )
    short_stem = hostname.split(".")[0].replace("-", "")

    auth_profile = f"{short_stem}_auth"
    _persist_custom_auth(settings, auth_profile, username or "admin", used_pw)

    if (
        settings.network_driver == "offline"
        and not _is_protected_repo_path(settings.offline_lab_path)
        and running_config.strip()
    ):
        cfg_file = settings.offline_lab_path / f"{hostname}.cfg"
        cfg_file.parent.mkdir(parents=True, exist_ok=True)
        cfg_file.write_text(running_config, encoding="utf-8")

    if not _is_protected_repo_path(settings.intent_repo_path):
        devices_dir = settings.intent_repo_path / "devices"
        devices_dir.mkdir(parents=True, exist_ok=True)
        intent_file = devices_dir / f"{hostname}.yaml"
        if not intent_file.is_file():
            intent_data = _parse_brownfield_intent_from_config(
                hostname, running_config, detected_platform
            )
            if intent_data is not None:
                try:
                    DeviceIntent.model_validate(intent_data)
                except Exception:
                    intent_data = None
            if intent_data is None:
                dummy_dev = Device(
                    id=port % 100,
                    hostname=hostname,
                    management_ip=host,
                    management_port=port,
                    platform=detected_platform,
                    role=(
                        DeviceRole.SERVER
                        if role == "server"
                        else (DeviceRole.SPINE if role == "spine" else DeviceRole.LEAF)
                    ),
                    auth_profile=auth_profile,
                )
                intent_data = _build_default_device_intent(dummy_dev)
            if intent_data is not None:
                intent_file.write_text(
                    yaml.safe_dump(intent_data, sort_keys=False, allow_unicode=True),
                    encoding="utf-8",
                )

    return {
        "hostname": hostname,
        "platform": detected_platform.value,
        "role": role,
        "management_ip": host,
        "management_port": port,
        "endpoint": f"{host}:{port}",
        "auth_profile": auth_profile,
        "reachable": True,
        "banner": banner,
        "running_config": running_config,
        "hardware_specs": {
            "os_version": os_ver,
            "cpu_cores": cpu_cores,
            "ram_gb": ram_gb,
            "disk_gb": disk_gb,
            "interfaces": interfaces,
            "lldp_neighbors": lldp_neighbors,
        },
    }


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
            default_cmd = (
                "ip addr show"
                if device.platform == Platform.LINUX_SERVER
                else "show running-config"
            )
            cmd = str(cmds.get("running_config") or default_cmd)
            cfg = conn.send_command(cmd).result
    except Exception:
        return None

    return _parse_brownfield_intent_from_config(device.hostname, cfg, device.platform)


def _build_default_device_intent(device: Device) -> dict[str, Any]:
    idx = (device.id or 5) + 10
    plat_cfg = load_platform_profiles().get(device.platform.value) or {}
    default_if = "eth0" if device.platform == Platform.LINUX_SERVER else "GigabitEthernet2"
    if_name = str(plat_cfg.get("default_interface") or default_if)

    if device.role == DeviceRole.SERVER or device.platform == Platform.LINUX_SERVER:
        return {
            "hostname": device.hostname,
            "interfaces": [
                {
                    "name": "lo",
                    "description": "Loopback interface",
                    "enabled": True,
                    "mode": "l3",
                    "ipv4_address": f"10.255.0.{idx}/32",
                    "mtu": 1500,
                },
                {
                    "name": if_name or "eth0",
                    "description": "Primary server network interface",
                    "enabled": True,
                    "mode": "l3",
                    "ipv4_address": f"10.0.{idx}.10/24",
                    "mtu": 1500,
                },
            ],
            "bgp": None,
            "acls": [],
        }

    asn = 65000 if device.role == DeviceRole.SPINE else 65100 + idx
    lo_ip = f"10.255.0.{idx}"
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
    try:
        from netops.services.state import get_state_manager

        state = get_state_manager(settings)
        loaded = state.get_db_state(
            "custom_auth_profiles", {}, database_url=getattr(settings, "database_url", None)
        )
        existing_profiles = dict(loaded) if isinstance(loaded, dict) else {}
        existing_profiles[profile_name] = {"username": username, "password": password}
        state.set_db_state(
            "custom_auth_profiles",
            existing_profiles,
            database_url=getattr(settings, "database_url", None),
        )
    except Exception:
        pass


def bind_device_to_sot(
    data: DeviceCreate, device: Device, container: Any
) -> None:
    """Persist custom SSH credentials and generate baseline Git SoT intent if missing."""
    settings = container.settings
    plat_cfg = load_platform_profiles(settings.intent_repo_path).get(data.platform.value) or {}
    default_pw = str(plat_cfg.get("default_password") or "admin")
    eff_pw = data.password if (data.password and data.password != "admin") else default_pw
    if data.username or default_pw != "admin":
        _persist_custom_auth(settings, data.auth_profile, data.username or "admin", eff_pw)

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
                bgp_data = baseline_intent.get("bgp") or {} if baseline_intent else {}
                rid_val = bgp_data.get("router_id")
                if rid_val and str(rid_val) in existing_rids:
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

    with _SOT_INV_LOCK:
        inv_path = settings.intent_repo_path / "inventory.yaml"
        if inv_path.is_file():
            lock_path = inv_path.with_suffix(".lock")
            try:
                with open(lock_path, "a+", encoding="utf-8") as lf:
                    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
                    try:
                        raw_inv = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
                        dev_list = raw_inv.get("devices") or []
                        if not any(d.get("hostname") == device.hostname for d in dev_list):
                            default_fab = _resolve_fabric_id(settings)
                            dev_fabric = (
                                getattr(device, "fabric_id", default_fab) or default_fab
                            )
                            dev_site = getattr(device, "site", None) or dev_fabric
                            dev_list.append(
                                {
                                    "hostname": device.hostname,
                                    "management_ip": str(device.management_ip),
                                    "management_port": int(device.management_port),
                                    "platform": device.platform.value,
                                    "role": device.role.value,
                                    "auth_profile": device.auth_profile,
                                    "fabric_id": dev_fabric,
                                    "site": dev_site,
                                }
                            )
                            raw_inv["devices"] = dev_list
                            inv_path.write_text(
                                yaml.safe_dump(raw_inv, sort_keys=False, allow_unicode=True),
                                encoding="utf-8",
                            )
                    finally:
                        fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass


def remove_device_from_sot(
    hostname: str, intent_repo_path: Path, offline_lab_path: Path | None = None
) -> None:
    from netops.services.telemetry import clear_live_metrics

    clear_live_metrics(hostname)
    if _is_protected_repo_path(intent_repo_path):
        return
    for extra_file in (
        intent_repo_path / "devices" / f"{hostname}.yaml",
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
    with _SOT_INV_LOCK:
        inv_path = intent_repo_path / "inventory.yaml"
        if inv_path.is_file():
            lock_path = inv_path.with_suffix(".lock")
            try:
                with open(lock_path, "a+", encoding="utf-8") as lf:
                    fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
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
                    finally:
                        fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
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
    from netops.services.ai_guard import AiTelemetryGuard

    AiTelemetryGuard.inject_anomaly(device.hostname, "clear")
    output = ""
    cmd = _emergency_cli_command(device.platform, data.action)
    if container.settings.network_driver == "offline":
        toolchain = build_toolchain(container.settings)
        if data.action == "rollback_last_commit" and not _is_protected_repo_path(
            container.settings.offline_lab_path
        ):
            try:
                intent = toolchain.intents.load().intent_for(device.hostname)
                if intent is not None:
                    rendered = toolchain.renderer.render(
                        InventoryDevice.model_validate(device), intent
                    )
                    cfg_file = container.settings.offline_lab_path / f"{device.hostname}.cfg"
                    cfg_file.parent.mkdir(parents=True, exist_ok=True)
                    cfg_file.write_text(rendered, encoding="utf-8")
                    output = (
                        f"Restored {device.hostname}.cfg to Git SoT baseline "
                        f"({len(rendered.splitlines())} lines)"
                    )
                else:
                    output = f"Offline rollback skipped: no Git intent found for {device.hostname}"
            except Exception as exc:
                output = f"Offline rollback completed ({exc})"
        else:
            output = f"[Offline Lab {device.platform.value}] Executed '{cmd}' on {device.hostname}"
    else:
        toolchain = build_toolchain(container.settings)
        target = toolchain.target_for(InventoryDevice.model_validate(device))
        try:
            with _ParamikoConnAdapter(target, timeout=20) as conn:
                output = conn.send_command(cmd).result
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"SSH ошибка при выполнении '{data.action}' на {device.hostname}: {exc}",
            ) from exc

    from netops.api.routes.emergency import record_audit

    entry = record_audit(
        user=actor_username,
        action=data.action,
        device=device.hostname,
        payload=cmd,
        reason=data.reason,
        success=True,
        output=output,
        settings=container.settings,
    )

    return {
        "status": "SUCCESS",
        "action": data.action,
        "device": device.hostname,
        "message": f"Action '{data.action}' executed on {device.hostname}",
        "entry": entry,
    }
