"""ACL, BGP, brownfield YAML intent extraction, and SoT inventory helpers."""

from __future__ import annotations

import contextlib
import fcntl
import ipaddress
import re
import threading
from pathlib import Path
from typing import Any

import yaml
from pydantic import SecretStr

from netops.enums import DeviceRole, Platform
from netops.models import Device
from netops.services.discovery_parsers import _parse_linux_interfaces, _parse_running_interfaces
from netops.services.discovery_profiles import _resolve_fabric_id, load_platform_profiles
from netops.settings import AuthProfile

_SOT_INV_LOCK = threading.RLock()

_PORT_MAP = {
    "bgp": 179,
    "ssh": 22,
    "telnet": 23,
    "snmp": 161,
    "www": 80,
    "https": 443,
    "domain": 53,
}


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
            src, dst = "any", "any"
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
                rule["src_port"] = _PORT_MAP.get(sp_raw) or (
                    int(sp_raw) if sp_raw.isdigit() else None
                )
            m_dp = re.search(r"destination-port\s+eq\s+(\S+)", rest)
            if m_dp:
                dp_raw = m_dp.group(1).lower()
                rule["dst_port"] = _PORT_MAP.get(dp_raw) or (
                    int(dp_raw) if dp_raw.isdigit() else None
                )
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
        if in_bgp and re.match(
            r"^(?:ip\s+access-list|acl\s+name|ospf|router\s+ospf|line)\b", line, re.IGNORECASE
        ):
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
            return {"hostname": hostname, "interfaces": linux_ifaces, "bgp": None, "acls": []}

    parsed_ifaces = _parse_running_interfaces(cfg)
    m_asn = re.search(r"^(?:router\s+bgp|bgp)\s+(\d+)", cfg, re.IGNORECASE | re.MULTILINE)
    if not parsed_ifaces or not m_asn:
        return None

    asn = int(m_asn.group(1))
    m_rid = re.search(r"(?:bgp\s+router-id|router-id)\s+(\d+\.\d+\.\d+\.\d+)", cfg, re.IGNORECASE)
    l3_ips = [str(i["ipv4_address"]).split("/")[0] for i in parsed_ifaces if i.get("ipv4_address")]
    router_id = m_rid.group(1) if m_rid else (l3_ips[0] if l3_ips else None)
    if router_id is None:
        return None

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
            neighbors.append({
                "peer_ip": peer_ip,
                "remote_asn": int(m_nb.group(2)),
                "description": peer_descriptions.get(peer_ip, "fabric-peer"),
                "announced_prefixes": list(announced),
            })
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

    return {"hostname": hostname, "interfaces": parsed_ifaces, "bgp": bgp_dict, "acls": parsed_acls}


def _build_default_device_intent(device: Device) -> dict[str, Any]:
    if device.role == DeviceRole.SERVER or device.platform == Platform.LINUX_SERVER:
        plat_cfg = load_platform_profiles().get(device.platform.value) or {}
        if_name = str(plat_cfg.get("default_interface") or "eth0")
        return {
            "hostname": device.hostname,
            "interfaces": [
                {"name": "lo", "description": "Loopback interface", "enabled": True, "mode": "l3"},
                {
                    "name": if_name,
                    "description": "Primary server network interface",
                    "enabled": True,
                    "mode": "l3",
                },
            ],
            "bgp": None,
            "acls": [],
        }
    return {"hostname": device.hostname, "interfaces": [], "bgp": None, "acls": []}


def _persist_custom_auth(settings: Any, profile_name: str, username: str, password: str) -> None:
    settings.auth_profiles[profile_name] = AuthProfile(
        username=username, password=SecretStr(password)
    )
    with contextlib.suppress(Exception):
        from netops.services.state import get_state_manager

        state = get_state_manager(settings)
        db_url = getattr(settings, "database_url", None)
        loaded = state.get_db_state("custom_auth_profiles", {}, database_url=db_url)
        existing_profiles = dict(loaded) if isinstance(loaded, dict) else {}
        existing_profiles[profile_name] = {"username": username, "password": password}
        state.set_db_state("custom_auth_profiles", existing_profiles, database_url=db_url)


def _sot_inventory_upsert(device: Device, settings: Any) -> None:
    with _SOT_INV_LOCK:
        inv_path = settings.intent_repo_path / "inventory.yaml"
        if not inv_path.is_file():
            return
        with contextlib.suppress(Exception), open(
            inv_path.with_suffix(".lock"), "a+", encoding="utf-8"
        ) as lf:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
            try:
                raw_inv = yaml.safe_load(inv_path.read_text(encoding="utf-8")) or {}
                dev_list = raw_inv.get("devices") or []
                if not any(d.get("hostname") == device.hostname for d in dev_list):
                    default_fab = _resolve_fabric_id(settings)
                    dev_fabric = getattr(device, "fabric_id", default_fab) or default_fab
                    dev_list.append({
                        "hostname": device.hostname,
                        "management_ip": str(device.management_ip),
                        "management_port": int(device.management_port),
                        "platform": device.platform.value,
                        "role": device.role.value,
                        "auth_profile": device.auth_profile,
                        "fabric_id": dev_fabric,
                        "site": getattr(device, "site", None) or dev_fabric,
                    })
                    raw_inv["devices"] = dev_list
                    inv_path.write_text(
                        yaml.safe_dump(raw_inv, sort_keys=False, allow_unicode=True),
                        encoding="utf-8",
                    )
            finally:
                fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def _sot_inventory_remove(hostname: str, intent_repo_path: Path) -> None:
    with _SOT_INV_LOCK:
        inv_path = intent_repo_path / "inventory.yaml"
        if not inv_path.is_file():
            return
        with contextlib.suppress(Exception), open(
            inv_path.with_suffix(".lock"), "a+", encoding="utf-8"
        ) as lf:
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
