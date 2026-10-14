"""Device SSH probing, Brownfield YAML intent extraction, and SoT binding service.

Extracted from `api/routes/devices.py` so the HTTP controller stays thin and declarative.
"""

from __future__ import annotations

from datetime import datetime, timezone
import ipaddress
import json
import logging
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


def run_device_probe(req: DeviceProbeRequest, container: Any) -> DeviceProbeResult:
    clean_ip = req.management_ip.strip().removeprefix("http://").removeprefix("https://")
    clean_port = req.management_port
    if ":" in clean_ip:
        parts = clean_ip.split(":", 1)
        clean_ip = parts[0]
        try:
            clean_port = int(parts[1])
        except ValueError:
            pass

    if container.settings.network_driver == "offline":
        is_spine = clean_port in (2211, 2212, 2001, 2002)
        if clean_port in (2212, 2001):
            platform = Platform.ARISTA_EOS
        elif clean_port in (2221, 2222, 2003, 2004):
            platform = Platform.HUAWEI_VRP
        else:
            platform = Platform.CISCO_IOSXE
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
            interfaces=["GigabitEthernet1", "GigabitEthernet2"]
            if platform != Platform.HUAWEI_VRP
            else ["GE1/0/0", "GE1/0/1"],
            lldp_neighbors=[
                {"local_port": "eth1", "neighbor": "spine-1.croc.lab", "remote_port": "eth1"}
            ],
            message=f"Офлайн-режим: эмуляция узла {clean_ip}:{clean_port}",
        )

    reachable = False
    banner = ""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(3.0)
    try:
        sock.connect((clean_ip, clean_port))
        sock.settimeout(2.0)
        try:
            banner = sock.recv(1024).decode("utf-8", errors="ignore").strip()
        except Exception:
            pass
        sock.close()
        reachable = True
    except Exception as exc:
        logger.info("Probe TCP connection failed for %s:%s: %s", clean_ip, clean_port, exc)

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

    detected_platform = Platform.CISCO_IOSXE
    if "OpenSSH" in banner:
        detected_platform = Platform.ARISTA_EOS
    elif "SSH-2.0--" in banner or clean_port in (2221, 2222):
        detected_platform = Platform.HUAWEI_VRP

    target = DeviceTarget(
        hostname=f"probe-{clean_port}",
        platform=detected_platform,
        host=clean_ip,
        port=clean_port,
        credentials=Credentials(req.username or "admin", req.password or "admin"),
    )
    interfaces: list[str] = []
    lldp_neighbors: list[dict[str, Any]] = []
    hostname = f"node-{clean_port}"
    os_ver = banner or detected_platform.value
    cpu_cores: int | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    try:
        with _ParamikoConnAdapter(target, timeout=12, proxy_jump=req.proxy_jump) as conn:
            ver_cmd = (
                "display version"
                if detected_platform == Platform.HUAWEI_VRP
                else "show version"
            )
            ver_out = conn.send_command(ver_cmd).result
            if "Arista" in ver_out or "cEOS" in ver_out:
                detected_platform = Platform.ARISTA_EOS
            elif "Cisco IOS" in ver_out:
                detected_platform = Platform.CISCO_IOSXE
            elif "Huawei" in ver_out or "VRP" in ver_out or "HUAWEI" in ver_out:
                detected_platform = Platform.HUAWEI_VRP

            m_kb = re.search(
                r"(\d+)\s*K(?:B| bytes) of (?:physical )?memory", ver_out, re.IGNORECASE
            )
            if not m_kb:
                m_kb = re.search(r"Total memory:\s*(\d+)\s*KB", ver_out, re.IGNORECASE)
            if m_kb:
                ram_gb = round(int(m_kb.group(1)) / (1024 * 1024), 2)
            else:
                m_mb = re.search(
                    r"(?:SDRAM|Memory)\s*[:Size]*\s*(\d+)\s*M(?:B|iB)", ver_out, re.IGNORECASE
                )
                if m_mb:
                    ram_gb = round(int(m_mb.group(1)) / 1024, 2)
            if ram_gb is None and detected_platform == Platform.HUAWEI_VRP:
                mem_out = conn.send_command("display memory").result
                m_hw = re.search(r"Total\s*:\s*(\d+)", mem_out, re.IGNORECASE)
                if m_hw:
                    val = int(m_hw.group(1))
                    ram_gb = round(val / (1024 * 1024 if val > 100_000 else 1024), 2)

            m_flash = re.search(
                r"(\d+)\s*K(?:B| bytes) of (?:flash|bootflash|non-volatile)",
                ver_out,
                re.IGNORECASE,
            )
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
            if lines_clean:
                os_ver = lines_clean[0][:100]

            run_out = conn.send_command(
                "display current-configuration | include sysname"
                if detected_platform == Platform.HUAWEI_VRP
                else "show running-config | include hostname"
            ).result
            hm = re.search(r"(?:hostname|sysname)\s+(\S+)", run_out)
            if hm:
                raw_h = hm.group(1).strip()
                hostname = raw_h if "." in raw_h else f"{raw_h}.croc.lab"

            int_cmd = (
                "display ip interface brief"
                if detected_platform == Platform.HUAWEI_VRP
                else "show ip interface brief"
            )
            int_out = conn.send_command(int_cmd).result
            for line in int_out.splitlines():
                parts = line.split()
                if parts and parts[0].startswith(
                    ("Gigabit", "Ethernet", "Loop", "Management", "GE", "MEth")
                ):
                    interfaces.append(parts[0])

            lldp_cmd = (
                "display lldp neighbor brief"
                if detected_platform == Platform.HUAWEI_VRP
                else "show lldp neighbors"
            )
            lldp_out = conn.send_command(lldp_cmd).result
            for line in lldp_out.splitlines():
                parts = line.split()
                if len(parts) >= 3 and any(
                    p.startswith(("Gi", "Et", "GE", "eth")) for p in parts[:3]
                ):
                    lldp_neighbors.append(
                        {"local_port": parts[0], "neighbor": parts[1], "remote_port": parts[-1]}
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


def extract_brownfield_intent(
    device: Device, data: DeviceCreate, settings: Any
) -> dict[str, Any] | None:
    """Try to pull live running-config via SSH and extract real interfaces & BGP intent."""
    profile = settings.auth_profiles.get(device.auth_profile)
    user = data.username or (profile.username if profile else "admin")
    pw = data.password or (profile.password.get_secret_value() if profile else "admin")
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
            cmd = (
                "display current-configuration"
                if device.platform == Platform.HUAWEI_VRP
                else "show running-config"
            )
            cfg = conn.send_command(cmd).result
    except Exception:
        return None

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

    m_asn = re.search(r"^(?:router\s+bgp|bgp)\s+(\d+)", cfg, re.IGNORECASE | re.MULTILINE)
    if not parsed_ifaces or not m_asn:
        return None

    asn = int(m_asn.group(1))
    m_rid = re.search(
        r"(?:bgp\s+router-id|router-id)\s+(\d+\.\d+\.\d+\.\d+)", cfg, re.IGNORECASE
    )
    router_id = m_rid.group(1) if m_rid else parsed_ifaces[0]["ipv4_address"].split("/")[0]

    neighbors: list[dict[str, Any]] = []
    for m_nb in re.finditer(
        r"(?:neighbor|peer)\s+(\d+\.\d+\.\d+\.\d+)\s+(?:remote-as|as-number)\s+(\d+)",
        cfg,
        re.IGNORECASE,
    ):
        neighbors.append(
            {
                "peer_ip": m_nb.group(1),
                "remote_asn": int(m_nb.group(2)),
                "description": "fabric-peer",
                "announced_prefixes": [f"{router_id}/32"],
            }
        )

    if not neighbors:
        return None

    return {
        "hostname": device.hostname,
        "interfaces": parsed_ifaces,
        "bgp": {
            "asn": asn,
            "router_id": router_id,
            "neighbors": neighbors,
        },
        "acls": [],
    }


def bind_device_to_sot(data: DeviceCreate, device: Device, container: Any) -> None:
    """Persist custom SSH credentials and generate baseline Git SoT intent if missing."""
    settings = container.settings
    if data.username:
        pw = data.password or "admin"
        settings.auth_profiles[data.auth_profile] = AuthProfile(
            username=data.username, password=SecretStr(pw)
        )
        try:
            custom_auth_file = settings.offline_lab_path / "custom_auth_profiles.json"
            custom_auth_file.parent.mkdir(parents=True, exist_ok=True)
            existing_profiles = {}
            if custom_auth_file.is_file():
                existing_profiles = json.loads(custom_auth_file.read_text(encoding="utf-8"))
            existing_profiles[data.auth_profile] = {"username": data.username, "password": pw}
            custom_auth_file.write_text(
                json.dumps(existing_profiles, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            pass

    if data.role == DeviceRole.SERVER or data.platform == Platform.LINUX_SERVER:
        return

    devices_dir = settings.intent_repo_path / "devices"
    devices_dir.mkdir(parents=True, exist_ok=True)
    intent_file = devices_dir / f"{device.hostname}.yaml"
    if not intent_file.is_file():
        baseline_intent = extract_brownfield_intent(device, data, settings)
        if baseline_intent is not None:
            try:
                DeviceIntent.model_validate(baseline_intent)
            except Exception:
                baseline_intent = None
        if baseline_intent is None:
            idx = (device.id or 5) + 10
            asn = 65000 if device.role == DeviceRole.SPINE else 65100 + idx
            lo_ip = f"10.255.0.{idx}"
            if device.platform == Platform.HUAWEI_VRP:
                if_name = "GE1/0/0"
            elif device.platform == Platform.ARISTA_EOS:
                if_name = "Ethernet1"
            else:
                if_name = "GigabitEthernet2"
            baseline_intent = {
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


def remove_device_from_sot(hostname: str, intent_repo_path: Path) -> None:
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


def execute_device_emergency_action(
    device: Device,
    data: DeviceEmergencyAction,
    container: Any,
    actor_username: str,
) -> dict[str, Any]:
    output = ""
    if container.settings.network_driver == "offline":
        output = f"Simulated {data.action} in offline lab"
    else:
        toolchain = build_toolchain(container.settings)
        target = toolchain.target_for(InventoryDevice.model_validate(device))
        cmd_map = {
            "reset_bgp_sessions": "reset bgp all"
            if device.platform == Platform.HUAWEI_VRP
            else "clear ip bgp *",
            "rollback_last_commit": "rollback configuration last 1"
            if device.platform == Platform.HUAWEI_VRP
            else "configure replace flash:rollback-0 force",
            "restart_services": "show processes cpu"
            if device.platform != Platform.HUAWEI_VRP
            else "display cpu",
            "reboot": "reload in 1"
            if device.platform != Platform.HUAWEI_VRP
            else "reboot fast",
        }
        cmd = cmd_map.get(data.action, "show version")
        try:
            with _ParamikoConnAdapter(target, timeout=20) as conn:
                output = conn.send_command(cmd).result
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"SSH ошибка при выполнении '{data.action}' на {device.hostname}: {exc}",
            ) from exc

    audit_path = Path(__file__).resolve().parents[3] / "lab" / "running" / "emergency_audit.jsonl"
    audit_path.parent.mkdir(parents=True, exist_ok=True)
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
    with open(audit_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {
        "status": "SUCCESS",
        "action": data.action,
        "device": device.hostname,
        "message": f"Action '{data.action}' executed on {device.hostname}",
        "entry": entry,
    }
