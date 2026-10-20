"""Unified CLI table parsers and device health table collection.

Extracts BGP session states, interface operational statuses, and ping packet-loss
percentages from vendor CLI outputs (Huawei VRP, Cisco IOS-XE, Arista EOS, etc.).
"""

from __future__ import annotations

import re
import time
from typing import Any

from netops.enums import Platform
from netops.network.base import (
    BgpSessionState,
    DeviceTarget,
    HealthExpectations,
    HealthSnapshot,
    InterfaceState,
)
from netops.services.telemetry import collect_metrics_from_cli


def parse_bgp_table(platform: Platform, output: str) -> dict[str, BgpSessionState]:
    """Parse BGP neighbor table from CLI output ('display bgp peer' or 'show ip bgp summary')."""
    bgp_sessions: dict[str, BgpSessionState] = {}
    if platform == Platform.HUAWEI_VRP:
        for line in output.splitlines():
            match = re.search(
                r"^(\d+\.\d+\.\d+\.\d+)\s+.*?\b(Established|Active|Idle|Connect|OpenSent|OpenConfirm)\b\s*(\d+)?\s*$",
                line.strip(),
                re.IGNORECASE,
            )
            if match:
                peer_ip, state, pfx = match.groups()
                is_est = state.lower() == "established"
                bgp_sessions[peer_ip] = BgpSessionState(
                    "Established" if is_est else state,
                    prefixes_accepted=int(pfx) if (is_est and pfx) else (1 if is_est else 0),
                )
        return bgp_sessions

    ip_pattern = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
    for line in output.splitlines():
        parts = line.strip().split()
        peer_ip = next((p for p in parts if ip_pattern.match(p)), None)
        if not peer_ip or len(parts) < 4 or "identifier" in line.lower():
            continue
        last = parts[-1]
        if len(parts) >= 2 and parts[-2].isdigit() and parts[-1].isdigit():
            bgp_sessions[peer_ip] = BgpSessionState(
                "Established", prefixes_accepted=int(parts[-2])
            )
        elif last.isdigit():
            bgp_sessions[peer_ip] = BgpSessionState(
                "Established", prefixes_accepted=int(last)
            )
        else:
            bgp_sessions[peer_ip] = BgpSessionState(last, prefixes_accepted=0)
    return bgp_sessions


def parse_interface_table(platform: Platform, output: str) -> dict[str, InterfaceState]:
    """Parse interface brief table from CLI output."""
    interfaces: dict[str, InterfaceState] = {}
    if platform == Platform.HUAWEI_VRP:
        for line in output.splitlines():
            parts = line.split()
            if (
                len(parts) >= 4
                and parts[0].startswith(("GE", "Loop", "Gigabit", "Eth", "Vb"))
                and parts[1].lower() != "unassigned"
            ):
                status = "up" if parts[2].lower().startswith("up") else "down"
                proto = "up" if parts[3].lower().startswith("up") else "down"
                interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)
        return interfaces

    for line in output.splitlines():
        parts = line.split()
        if platform == Platform.CISCO_IOSXE and len(parts) >= 6:
            if parts[0].startswith(("Gigabit", "Loop")):
                proto = parts[-1].lower()
                raw_status = " ".join(parts[4:-1]).lower()
                status = (
                    "up"
                    if raw_status == "up"
                    else ("down" if "down" in raw_status else raw_status)
                )
                interfaces[parts[0]] = InterfaceState(
                    status=status, protocol=proto
                )
        elif len(parts) >= 4 and parts[0].startswith(("Ethernet", "Loop", "Management")):
            status = "up" if parts[2].lower().startswith("up") else "down"
            proto = "up" if parts[3].lower().startswith("up") else "down"
            interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)
    return interfaces


def parse_ping_loss(output: str) -> float:
    """Parse ping success rate or packet loss percentage from CLI output into packet loss percentage."""
    if rate_match := re.search(r"Success rate is (\d+(?:\.\d+)?)\s*(?:%|percent)", output, re.I):
        return max(0.0, min(100.0, 100.0 - float(rate_match.group(1))))
    if loss_match := re.search(r"(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:packet\s+)?loss", output, re.I):
        return max(0.0, min(100.0, float(loss_match.group(1))))
    return 100.0 if output.strip() else 0.0


def collect_device_health_tables(
    conn: Any,
    target: DeviceTarget,
    expected: HealthExpectations | None,
    *,
    last_cli_metrics_ts: dict[str, float] | None = None,
    cli_metrics_dedup_sec: float = 12.0,
) -> HealthSnapshot:
    """Collect BGP sessions, interface states, CLI metrics, and ping loss over an open SSH session."""
    if target.platform == Platform.HUAWEI_VRP:
        bgp_out = conn.send_command("display bgp peer").result
        int_out = conn.send_command("display ip interface brief").result
    else:
        bgp_out = conn.send_command("show ip bgp summary").result
        int_out = conn.send_command("show ip interface brief").result

    bgp_sessions = parse_bgp_table(target.platform, bgp_out)
    interfaces = parse_interface_table(target.platform, int_out)

    from netops.telemetry.targets import is_externally_collected

    now_ts = time.monotonic()
    last_m = (last_cli_metrics_ts or {}).get(target.hostname, 0.0)
    if is_externally_collected(target.hostname) or (
        last_cli_metrics_ts is not None and (now_ts - last_m < cli_metrics_dedup_sec)
    ):
        cli_metrics: dict[str, float] = {}
    else:
        if last_cli_metrics_ts is not None:
            last_cli_metrics_ts[target.hostname] = now_ts
        cli_metrics = collect_metrics_from_cli(
            target.hostname,
            target.platform.value,
            lambda c: conn.send_command(c).result,
        )

    ping_losses: dict[str, float] = {}
    if expected:
        for peer in expected.bgp_peers:
            if target.platform == Platform.CISCO_IOSXE:
                ping_cmd = f"ping {peer} repeat 5"
            elif target.platform == Platform.HUAWEI_VRP:
                ping_cmd = f"ping -c 5 {peer}"
            else:
                ping_cmd = f"ping {peer} count 5"
            ping_out = conn.send_command(ping_cmd).result
            ping_losses[peer] = parse_ping_loss(ping_out)

    return HealthSnapshot(
        bgp_sessions=bgp_sessions,
        interfaces=interfaces,
        ping_loss_percent=ping_losses,
        cpu_pct=cli_metrics.get("cpu_pct"),
        memory_pct=cli_metrics.get("memory_pct"),
        uplink_util_pct=cli_metrics.get("uplink_util_pct"),
        disk_util_pct=cli_metrics.get("disk_util_pct"),
        network_rate_mbps=cli_metrics.get("network_rate_mbps"),
        load_1m=cli_metrics.get("load_1m"),
    )
