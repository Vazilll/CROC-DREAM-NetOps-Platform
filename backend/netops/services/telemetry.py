"""Hardware and operational device telemetry.

Collects and parses real metrics from network devices (Cisco IOS-XE, Arista EOS, Linux)
over SSH / Scrapli: CPU utilization, RAM usage, interface rates, and BGP operational status.
Caches readings in memory to protect live lab devices from excessive SSH polling.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STEP_SECONDS = 300
POINTS_PER_DAY = 288


@dataclass(frozen=True)
class MetricSpec:
    label: str
    unit: str
    threshold: float


METRICS: dict[str, MetricSpec] = {
    "uplink_util_pct": MetricSpec("Загрузка аплинка", "%", 85.0),
    "cpu_pct": MetricSpec("Загрузка CPU", "%", 80.0),
    "memory_pct": MetricSpec("Использование RAM", "%", 85.0),
    "disk_util_pct": MetricSpec("Загрузка диска", "%", 90.0),
    "network_rate_mbps": MetricSpec("Сетевой трафик", "Mbps", 1000.0),
    "load_1m": MetricSpec("Load Average (1 мин)", "", 8.0),
}

# Live metric cache: hostname -> metric_name -> list of recent floats
_LIVE_METRIC_CACHE: dict[str, dict[str, list[float]]] = {}
_CACHE_LOCK = threading.Lock()


def record_live_metric(hostname: str, metric: str, value: float) -> None:
    """Store a live measurement parsed from real hardware CLI."""
    from netops.services.state import get_state_manager

    get_state_manager().append_telemetry(hostname, metric, value, max_points=POINTS_PER_DAY)
    with _CACHE_LOCK:
        series = _LIVE_METRIC_CACHE.setdefault(hostname, {}).setdefault(metric, [])
        is_pct = metric.endswith(("_pct", "percent", "utilization"))
        clamped_val = round(max(0.0, min(100.0, value)), 2) if is_pct else round(max(0.0, value), 2)
        series.append(clamped_val)
        if len(series) > POINTS_PER_DAY:
            series.pop(0)


def clear_live_metrics(hostname: str | None = None) -> None:
    """Clear metric cache in memory and StateManager."""
    from netops.services.state import get_state_manager

    get_state_manager().clear_telemetry(hostname)
    with _CACHE_LOCK:
        if hostname is None:
            _LIVE_METRIC_CACHE.clear()
        else:
            _LIVE_METRIC_CACHE.pop(hostname, None)
    try:
        from netops.services.forecast import clear_forecast_cache

        clear_forecast_cache()
    except Exception:
        pass


def parse_cisco_cpu(output: str) -> float | None:
    """Parse Cisco IOS-XE 'show processes cpu sorted' output."""
    # Matches: CPU utilization for five seconds: 14%/2%; one minute: 12%; five minutes: 10%
    match = re.search(r"one minute:\s*(\d+)%", output, re.IGNORECASE)
    if match:
        return float(match.group(1))
    match_sec = re.search(r"five seconds:\s*(\d+)%", output, re.IGNORECASE)
    if match_sec:
        return float(match_sec.group(1))
    return None


def parse_arista_cpu(output: str) -> float | None:
    """Parse Arista EOS 'show processes top once' or Junos 'Idle N percent' output."""
    # Matches: %Cpu(s): 12.3 us,  4.1 sy,  0.0 ni, 83.6 id  OR  Idle 82 percent
    match = re.search(r"(\d+(?:\.\d+)?)\s*id", output, re.IGNORECASE)
    if not match:
        match = re.search(r"Idle\s+(\d+(?:\.\d+)?)\s*(?:%|percent)?", output, re.IGNORECASE)
    if match:
        idle = float(match.group(1))
        return round(100.0 - idle, 2)
    return parse_cisco_cpu(output)


def parse_cisco_memory(output: str) -> float | None:
    """Parse Cisco 'show memory statistics' or 'show processes memory' to utilization %."""
    match = re.search(r"Processor\s+\S+\s+(\d+)\s+(\d+)", output)
    if match:
        total = float(match.group(1))
        used = float(match.group(2))
        if total > 0:
            return round((used / total) * 100.0, 2)
    m2 = re.search(r"Processor Pool Total:\s*(\d+)\s+Used:\s*(\d+)", output, re.IGNORECASE)
    if m2:
        total = float(m2.group(1))
        used = float(m2.group(2))
        if total > 0:
            return round((used / total) * 100.0, 2)
    return None


def parse_arista_memory(output: str) -> float | None:
    """Parse Arista 'show version' or 'show processes top once' memory usage %."""
    m_top = re.search(
        r"MiB Mem\s*:\s*([\d.]+)\s*total,\s*[\d.]+\s*free,\s*([\d.]+)\s*used",
        output,
        re.IGNORECASE,
    )
    if m_top:
        total, used = float(m_top.group(1)), float(m_top.group(2))
        if total > 0:
            return round((used / total) * 100.0, 2)
    m_ver = re.search(r"Total memory:\s*(\d+)\s*kB.*?Free memory:\s*(\d+)\s*kB", output, re.DOTALL)
    if m_ver:
        total, free = float(m_ver.group(1)), float(m_ver.group(2))
        if total > 0:
            return round(((total - free) / total) * 100.0, 2)
    return None


def parse_huawei_memory(output: str) -> float | None:
    """Parse Huawei 'display memory' or 'display health' memory usage %."""
    m = re.search(r"Memory Using Percentage Is:\s*(\d+)%", output, re.IGNORECASE)
    if m:
        return float(m.group(1))
    vals = [float(v) for v in re.findall(r"(\d+(?:\.\d+)?)%", output)]
    return round(vals[0], 2) if vals else None


def parse_huawei_cpu(output: str) -> float | None:
    """Parse Huawei CE 'display cpu': mean of the 'Current' column over cpuN rows."""
    values = [
        float(v)
        for v in re.findall(r"^cpu\d+\s+(\d+(?:\.\d+)?)%", output, re.IGNORECASE | re.MULTILINE)
    ]
    return round(sum(values) / len(values), 2) if values else parse_cisco_cpu(output)


def max_cisco_link_utilization(output: str, speed_mbps: float = 1000.0) -> float | None:
    """Busiest interface from 'show interfaces | include rate'."""
    rates = [
        int(r)
        for r in re.findall(r"(?:input|output) rate\s+(\d+)\s+bits/sec", output, re.IGNORECASE)
    ]
    if not rates:
        return None
    return round(min(100.0, max(rates) / 1_000_000.0 / speed_mbps * 100.0), 2)


def max_percent_column(output: str, row_prefixes: tuple[str, ...]) -> float | None:
    """Busiest interface from Arista 'counters rates' / Huawei 'interface brief'."""
    values = [
        float(p)
        for line in output.splitlines()
        if line.strip().startswith(row_prefixes)
        for p in re.findall(r"(\d+(?:\.\d+)?)%", line)
    ]
    return round(min(100.0, max(values)), 2) if values else None


def parse_linux_cpu(output: str) -> float | None:
    """Parse Linux top/mpstat CPU idle percentage to utilization %."""
    res = parse_arista_cpu(output)
    if res is not None:
        return res
    m_idle = re.search(r"(\d+(?:\.\d+)?)\s*(?:%?\s*)?id(?:le)?\b", output, re.IGNORECASE)
    if m_idle:
        return round(100.0 - float(m_idle.group(1)), 2)
    return None


def parse_linux_memory(output: str) -> float | None:
    """Parse Linux /proc/meminfo or free/top output to memory utilization %."""
    m_tot = re.search(r"MemTotal:\s*(\d+)", output, re.IGNORECASE)
    m_avail = re.search(r"MemAvailable:\s*(\d+)", output, re.IGNORECASE)
    m_free = re.search(r"MemFree:\s*(\d+)", output, re.IGNORECASE)
    if m_tot:
        tot = float(m_tot.group(1))
        if tot > 0:
            if m_avail:
                used = tot - float(m_avail.group(1))
                return max(0.0, min(100.0, round((used / tot) * 100.0, 2)))
            if m_free:
                used = tot - float(m_free.group(1))
                return max(0.0, min(100.0, round((used / tot) * 100.0, 2)))
    val = parse_arista_memory(output)
    if val is not None:
        return max(0.0, min(100.0, val))
    return None


def parse_linux_disk(output: str) -> float | None:
    """Parse Linux df output (df -h / or df -m /) for disk utilization percentage."""
    root_match = re.search(r"(\d+(?:\.\d+)?)%\s+/\s*$", output, re.MULTILINE)
    if root_match:
        return max(0.0, min(100.0, float(root_match.group(1))))
    for line in output.splitlines():
        if re.search(r"\s+/\S*\s*$", line):
            m = re.search(r"(\d+(?:\.\d+)?)%", line)
            if m:
                return max(0.0, min(100.0, float(m.group(1))))
    matches = re.findall(r"(\d+(?:\.\d+)?)%", output)
    if matches:
        return max(0.0, min(100.0, float(matches[0])))
    return None


def parse_linux_load(output: str) -> float | None:
    """Parse Linux uptime or /proc/loadavg for 1-minute load average."""
    m = re.search(r"load\s+average[s]?:\s*(\d+(?:\.\d+)?)", output, re.IGNORECASE)
    if m:
        return round(float(m.group(1)), 2)
    m2 = re.search(r"^\s*(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?", output)
    if m2:
        return round(float(m2.group(1)), 2)
    return None


def parse_linux_network_rate(output: str) -> float | None:
    """Parse Linux /proc/net/dev or interface byte statistics to rate in Mbps."""
    total_bytes = 0
    for line in output.splitlines():
        if ":" in line:
            parts = line.split(":", 1)[1].split()
            if len(parts) >= 9:
                with contextlib.suppress(ValueError):
                    total_bytes += int(parts[0]) + int(parts[8])
    if total_bytes > 0:
        return round(min(10000.0, (total_bytes * 8.0) / 1_000_000.0), 2)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:mbps|mbit/s|mb/s)", output, re.IGNORECASE)
    if m:
        return round(float(m.group(1)), 2)
    return 10.0


PARSER_REGISTRY: dict[str, Any] = {
    "parse_cisco_cpu": parse_cisco_cpu,
    "parse_arista_cpu": parse_arista_cpu,
    "parse_huawei_cpu": parse_huawei_cpu,
    "parse_cisco_memory": parse_cisco_memory,
    "parse_arista_memory": parse_arista_memory,
    "parse_huawei_memory": parse_huawei_memory,
    "parse_eltex_cpu": parse_cisco_cpu,
    "parse_eltex_memory": parse_huawei_memory,
    "parse_juniper_cpu": parse_arista_cpu,
    "parse_juniper_memory": parse_huawei_memory,
    "parse_linux_cpu": parse_linux_cpu,
    "parse_linux_memory": parse_linux_memory,
    "parse_linux_disk": parse_linux_disk,
    "parse_linux_load": parse_linux_load,
    "parse_linux_network_rate": parse_linux_network_rate,
    "max_cisco_link_utilization": max_cisco_link_utilization,
    "max_arista_link_utilization": lambda out: max_percent_column(out, ("Et",)),
    "max_huawei_link_utilization": lambda out: max_percent_column(
        out, ("GE", "10GE", "25GE", "40GE", "100GE")
    ),
    "max_yadro_link_utilization": lambda out: max_percent_column(out, ("Ethernet", "Eth")),
    "max_percent_column": lambda out: max_percent_column(out, ("Et", "GE", "Ethernet", "Eth")),
    "parse_linux_net_util": lambda out: 1.0,
}


def register_parser(name: str, fn: Any) -> None:
    """Register or override a metric parser function by key in the global parser registry."""
    PARSER_REGISTRY[name] = fn


_PROFILE_CACHE: dict[tuple[str, str | None], Any] = {}


def clear_platform_profile_cache() -> None:
    """Clear cached platform profiles."""
    _PROFILE_CACHE.clear()


def load_profile_for_platform(
    platform: str | object,
    *,
    repo_path: Path | None = None,
) -> Any | None:
    """Dynamically load and validate a declarative PlatformProfile from intent/platforms/*.yaml."""
    import yaml

    from netops.intent.models import PlatformProfile

    plat_key = str(getattr(platform, "value", platform)).lower()
    cache_key = (plat_key, str(repo_path) if repo_path else None)
    if cache_key in _PROFILE_CACHE:
        return _PROFILE_CACHE[cache_key]

    search_dirs: list[Path] = []
    if repo_path is not None:
        search_dirs.extend([repo_path / "platforms", repo_path / "intent" / "platforms", repo_path])
    repo_root = Path(__file__).resolve().parents[3]
    search_dirs.extend(
        [
            repo_root / "intent" / "platforms",
            repo_root / "backend" / "tests" / "fixtures" / "intent-repo" / "platforms",
        ]
    )
    for sdir in search_dirs:
        if sdir.is_dir():
            for suffix in (".yaml", ".yml"):
                pfile = sdir / f"{plat_key}{suffix}"
                if pfile.is_file():
                    try:
                        raw = yaml.safe_load(pfile.read_text(encoding="utf-8"))
                        if isinstance(raw, dict):
                            prof = PlatformProfile.model_validate(raw)
                            _PROFILE_CACHE[cache_key] = prof
                            return prof
                    except Exception:
                        pass
    return None


class _DynamicCliMetrics(dict):
    """Shim for backward compatibility; dynamically resolves from PlatformProfile."""

    def get(self, key: Any, default: Any = ()):
        prof = load_profile_for_platform(key)
        if prof and prof.telemetry:
            items = []
            for metric, spec in prof.telemetry.items():
                parser_fn = PARSER_REGISTRY.get(spec.parser, parse_cisco_cpu)
                items.append((metric, spec.command, parser_fn))
            return tuple(items)
        return default

    def __getitem__(self, key: Any) -> Any:
        res = self.get(key, None)
        if res is None:
            raise KeyError(key)
        return res

    def __contains__(self, key: object) -> bool:
        return load_profile_for_platform(str(key)) is not None


_CLI_METRICS = _DynamicCliMetrics()


class _DynamicGnmiPlatforms(dict):
    """Shim for backward compatibility; dynamically resolves from PlatformProfile."""

    def get(self, key: Any, default: Any = None):
        prof = load_profile_for_platform(key)
        if prof and prof.gnmi:
            return (prof.gnmi.default_port, prof.gnmi.check_command)
        return default

    def __getitem__(self, key: Any) -> Any:
        res = self.get(key)
        if res is None:
            raise KeyError(key)
        return res

    def __contains__(self, key: object) -> bool:
        prof = load_profile_for_platform(str(key))
        return prof is not None and prof.gnmi is not None


_GNMI_PLATFORMS = _DynamicGnmiPlatforms()


def collect_metrics_from_cli(
    hostname: str,
    platform: str,
    send: Any,
    *,
    platform_profile: Any = None,
    repo_path: Path | None = None,
) -> dict[str, float]:
    """Run platform CPU / link-load commands via send(cmd) -> str, cache and return parsed values.

    Dynamically consumes declarative PlatformProfile without hardcoded command dictionaries.
    """
    profile = platform_profile or load_profile_for_platform(platform, repo_path=repo_path)
    collected: dict[str, float] = {}
    if profile and profile.telemetry:
        for metric, spec in profile.telemetry.items():
            parser_fn = PARSER_REGISTRY.get(spec.parser)
            if not parser_fn:
                continue
            try:
                cmd_out = send(spec.command)
                value = parser_fn(cmd_out)
            except Exception:
                continue
            if value is not None:
                record_live_metric(hostname, metric, value)
                collected[metric] = value
    return collected


def resolve_device_ports(
    management_ip: str | None = None,
    management_port: int | None = None,
    platform: str | object = "linux_server",
    *,
    platform_profile: Any = None,
    gnmi_port: int | None = None,
    snmp_port: int | None = None,
    exporter_port: int | None = None,
    repo_path: Path | None = None,
) -> dict[str, int]:
    """Unified port resolution for switches and servers across direct IP and Containerlab NAT.

    Driven by declarative YAML PlatformProfile (snmp base_port / clab_offset, gnmi default_port,
    exporter port) and target parameters.

    Returns dict mapping protocol name -> resolved port integer:
    - 'ssh': 22 (direct) or 22xx (Containerlab NAT)
    - 'snmp': 161 (direct) or 16xx (forwarded NAT)
    - 'gnmi': 6030/9339/57400/32767 (direct) or 603x (forwarded NAT)
    - 'exporter': 9100 (direct) or custom forwarded port
    """
    profile = platform_profile or load_profile_for_platform(platform, repo_path=repo_path)
    ssh_port = int(management_port) if management_port and int(management_port) > 0 else 22
    is_clab = 2000 <= ssh_port <= 2999

    snmp_spec = getattr(profile, "snmp", None)
    base_snmp = int(getattr(snmp_spec, "base_port", 161) or 161)
    clab_offset = int(getattr(snmp_spec, "clab_offset", 0) or 0)
    if snmp_port is not None:
        resolved_snmp = int(snmp_port)
    elif is_clab and clab_offset:
        resolved_snmp = ssh_port + clab_offset
    else:
        resolved_snmp = base_snmp

    gnmi_spec = getattr(profile, "gnmi", None)
    def_gnmi = getattr(gnmi_spec, "default_port", None)
    if gnmi_port is not None:
        resolved_gnmi = int(gnmi_port)
    elif def_gnmi is not None:
        def_port = int(def_gnmi)
        resolved_gnmi = 6030 + (ssh_port % 10) if (is_clab and def_port == 6030) else def_port
    else:
        resolved_gnmi = None

    exp_spec = getattr(profile, "exporter", None)
    resolved_exporter = int(exporter_port or getattr(exp_spec, "port", 9100) or 9100)

    res = {
        "ssh": ssh_port,
        "snmp": resolved_snmp,
        "exporter": resolved_exporter,
    }
    if resolved_gnmi is not None:
        res["gnmi"] = resolved_gnmi
    return res


_CLI_NEGATION = re.compile(
    r"\b(inactive|disabled|down|not\s+running|not\s+configured|stopped|"
    r"not\s+active|not\s+enabled|not\s+started|failed|shutdown|"
    r"invalid|unknown|syntax\s+error|unrecognized|error|no\s+process)\b"
)


def _cli_reports_gnmi(ssh_send: Any, gnmi_spec: Any) -> bool:
    if ssh_send is None:
        return False
    try:
        out = str(ssh_send(gnmi_spec.check_command) or "").lower()
    except Exception:
        return False
    has_match = any(
        re.search(rf"\b{re.escape(tok.lower())}\b", out) for tok in gnmi_spec.match_tokens
    )
    return has_match and not _CLI_NEGATION.search(out)


def detect_optimal_telemetry_protocol(
    host: str,
    platform: str,
    *,
    ssh_send: Any = None,
    username: str | None = None,
    password: str | None = None,
    snmp_community: str | None = None,
    gnmi_port: int | None = None,
    snmp_port: int | None = None,
    exporter_port: int | None = None,
    management_port: int | None = None,
    timeout: float = 0.5,
    platform_profile: Any = None,
    repo_path: Path | None = None,
    gnmi_probe: Any = None,
) -> dict[str, object]:
    """Pick the best telemetry protocol from PlatformProfile.protocol_priority.

    A protocol is chosen only when it is *proven* to work for the collector:
    gNMI — gRPC Capabilities via gnmic (or, without gnmic, CLI says enabled AND port open);
    exporter — HTTP answer in Prometheus text format; SNMP — UDP answer to a v2c GET with
    the configured community. Otherwise the device stays on ssh_cli.
    """
    from netops.enums import TelemetryProtocol
    from netops.services import protocol_probe

    profile = platform_profile or load_profile_for_platform(platform, repo_path=repo_path)
    ports = resolve_device_ports(
        host,
        management_port=management_port,
        platform=platform,
        platform_profile=profile,
        gnmi_port=gnmi_port,
        snmp_port=snmp_port,
        exporter_port=exporter_port,
        repo_path=repo_path,
    )
    fallback: dict[str, object] = {
        "protocol": TelemetryProtocol.SSH_CLI,
        "port": ports.get("ssh", 22),
        "verified_by": "ssh_session" if ssh_send is not None else None,
        "cli_supported": ssh_send is not None,
        "tcp_open": False,
    }
    if profile is None:
        return fallback

    probe_gnmi = gnmi_probe or protocol_probe.gnmic_capabilities
    snmp_agent: list[str] = []
    for proto in profile.protocol_priority or ["gnmi", "node_exporter", "snmp", "ssh_cli"]:
        if proto in ("ssh_cli", "ssh"):
            break
        if proto == "gnmi" and profile.gnmi:
            port = ports.get("gnmi") or profile.gnmi.default_port
            if not protocol_probe.tcp_open(host, port, timeout):
                continue
            caps = (
                probe_gnmi(host, port, username, password, timeout=max(timeout, 3.0))
                if username and password
                else None
            )
            cli_ok = _cli_reports_gnmi(ssh_send, profile.gnmi)
            if caps is not None and not caps.ok:
                continue  # gnmic ответил отказом — это не gNMI (или неверные учётные данные)
            if caps is None and not cli_ok:
                continue  # проверить нечем: открытый порт сам по себе ничего не доказывает
            return {
                "protocol": TelemetryProtocol.GNMI,
                "port": port,
                "verified_by": "gnmi_capabilities" if caps is not None else "cli+tcp",
                "tls": caps.tls if caps is not None else None,
                "cli_supported": cli_ok,
                "tcp_open": True,
            }
        if proto in ("node_exporter", "prometheus_exporter") and profile.exporter:
            port = ports.get("exporter") or profile.exporter.port
            path = profile.exporter.path or "/metrics"
            if protocol_probe.prometheus_exporter_ok(host, port, path, timeout):
                return {
                    "protocol": TelemetryProtocol.PROMETHEUS_EXPORTER,
                    "port": port,
                    "path": path,
                    "verified_by": "http_metrics",
                    "cli_supported": False,
                    "tcp_open": True,
                }
        elif proto == "snmp" and profile.snmp:
            port = ports.get("snmp") or profile.snmp.base_port
            versions = protocol_probe.snmp_agent_versions(
                host, port, community=snmp_community, timeout=timeout
            )
            snmp_agent = sorted(versions)
            if "v2c" in versions:
                return {
                    "protocol": TelemetryProtocol.SNMP,
                    "port": port,
                    "verified_by": "snmp_v2c_response",
                    "snmp_agent": snmp_agent,
                    "cli_supported": False,
                    "tcp_open": False,
                }
    # SNMPv3-агент без USM-учётки сборщику бесполезен, но факт его наличия полезен оператору.
    return {**fallback, "snmp_agent": snmp_agent} if snmp_agent else fallback


def collect_fleet_metrics_parallel(
    items: list[tuple[str, str, object]],
    *,
    max_workers: int = 16,
) -> dict[str, dict[str, float]]:
    """Collect live CLI metrics across multiple devices concurrently.

    Uses a bounded ThreadPoolExecutor.
    """
    from concurrent.futures import ThreadPoolExecutor

    if not items:
        return {}

    def _poll_one(entry: tuple[str, str, object]) -> tuple[str, dict[str, float]]:
        hostname, platform, send_fn = entry
        try:
            return hostname, collect_metrics_from_cli(hostname, platform, send_fn)
        except Exception:
            return hostname, {}

    workers = max(1, min(max_workers, len(items)))
    if workers == 1:
        pairs = [_poll_one(it) for it in items]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pairs = list(pool.map(_poll_one, items))
    return dict(pairs)


_PROM_QUERY_CACHE: dict[tuple[str, str, str, int], tuple[float, list[float] | None]] = {}


def check_prometheus_status(prometheus_url: str) -> dict[str, object]:
    """Check Prometheus health and active targets across the IT infrastructure."""
    clean_url = (prometheus_url or "").strip().rstrip("/")
    if not clean_url:
        return {
            "configured": False,
            "url": "",
            "reachable": False,
            "active_targets": 0,
            "up_targets": 0,
            "jobs": [],
        }
    try:
        req = urllib.request.Request(
            f"{clean_url}/api/v1/targets", headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        active = (data.get("data") or {}).get("activeTargets") or []
        up_count = sum(1 for t in active if t.get("health") == "up")
        jobs = sorted(
            {
                str((t.get("labels") or {}).get("job", ""))
                for t in active
                if (t.get("labels") or {}).get("job")
            }
        )
        return {
            "configured": True,
            "url": clean_url,
            "reachable": True,
            "active_targets": len(active),
            "up_targets": up_count,
            "jobs": jobs,
        }
    except Exception:
        return {
            "configured": True,
            "url": clean_url,
            "reachable": False,
            "active_targets": 0,
            "up_targets": 0,
            "jobs": [],
        }


def query_prometheus_metric(
    prometheus_url: str, hostname: str, metric: str, points: int = POINTS_PER_DAY
) -> list[float] | None:
    """Fetch real metric time-series from Prometheus range query API."""
    if not prometheus_url:
        return None

    cache_key = (prometheus_url, hostname, metric, points)
    now_mono = time.monotonic()
    cached_entry = _PROM_QUERY_CACHE.get(cache_key)
    if cached_entry is not None and (now_mono - cached_entry[0]) < 10.0:
        return list(cached_entry[1]) if cached_entry[1] is not None else None

    short_host = hostname.split(".", maxsplit=1)[0]
    by_metric: dict[str, tuple[str, ...]] = {
        "cpu_pct": (
            (
                f'avg(netops_device_cpu_utilization_percent{{hostname="{hostname}"}} '
                f'or netops_cpu_usage_percent{{hostname="{hostname}"}} '
                f'or netops_server_cpu_utilization_percent{{hostname="{hostname}"}})'
            ),
            f'avg(gnmi_components_component_cpu_utilization_state_instant{{hostname="{hostname}"}})',
            (
                f'100 * (1 - avg(rate(node_cpu_seconds_total'
                f'{{instance=~"{short_host}.*",mode="idle"}}[5m])))'
            ),
        ),
        "memory_pct": (
            (
                f'avg(netops_device_memory_utilization_percent{{hostname="{hostname}"}} '
                f'or netops_memory_usage_percent{{hostname="{hostname}"}} '
                f'or netops_server_memory_utilization_percent{{hostname="{hostname}"}})'
            ),
            (
                f'100 * avg(gnmi_system_memory_state_used{{hostname="{hostname}"}}) '
                f'/ clamp_min(avg(gnmi_system_memory_state_physical{{hostname="{hostname}"}}), 1)'
            ),
        ),
        "disk_util_pct": (
            f'avg(netops_server_disk_utilization_percent{{hostname="{hostname}"}})',
        ),
        "network_rate_mbps": (
            f'avg(netops_server_network_rate_mbps{{hostname="{hostname}"}})',
            (
                f'rate(node_network_receive_bytes_total{{instance=~"{short_host}.*"}}[5m]) '
                f'* 8 / 1000000'
            ),
        ),
        "load_1m": (
            (
                f'avg(netops_server_load_1m{{hostname="{hostname}"}} '
                f'or node_load1{{hostname="{hostname}"}})'
            ),
        ),
    }
    queries = by_metric.get(
        metric,
        (
            (
                f'avg(netops_device_uplink_utilization_percent{{hostname="{hostname}"}} '
                f'or netops_uplink_util_percent{{hostname="{hostname}"}} '
                f'or netops_uplink_utilization_percent{{hostname="{hostname}"}})'
            ),
            (
                f'clamp_max(max((rate(gnmi_interfaces_interface_state_counters_in_octets'
                f'{{hostname="{hostname}"}}[5m]) '
                f'+ rate(gnmi_interfaces_interface_state_counters_out_octets'
                f'{{hostname="{hostname}"}}[5m])) * 8 / 1e7), 100)'
            ),
            (
                f'clamp_max(max((rate(ifHCInOctets{{hostname="{hostname}"}}[5m]) '
                f'+ rate(ifHCOutOctets{{hostname="{hostname}"}}[5m])) * 8 / 1e7), 100)'
            ),
        ),
    )

    now = int(time.time())
    start = now - (points * STEP_SECONDS)
    base_url = prometheus_url.rstrip("/")
    for prom_query in queries:
        params = {
            "query": prom_query,
            "start": str(start),
            "end": str(now),
            "step": str(STEP_SECONDS),
        }
        url = f"{base_url}/api/v1/query_range?{urllib.parse.urlencode(params)}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = data.get("data", {}).get("result", [])
                if results:
                    values = results[0].get("values", [])
                    pts = [round(float(v[1]), 2) for v in values if len(v) >= 2]
                    if len(pts) >= 2:
                        res_pts = pts[-points:]
                        if len(_PROM_QUERY_CACHE) >= 512:
                            _PROM_QUERY_CACHE.clear()
                        _PROM_QUERY_CACHE[cache_key] = (now_mono, res_pts)
                        return list(res_pts)
        except urllib.error.HTTPError:
            continue
        except urllib.error.URLError:
            break
        except Exception:
            continue
    if len(_PROM_QUERY_CACHE) >= 512:
        _PROM_QUERY_CACHE.clear()
    _PROM_QUERY_CACHE[cache_key] = (now_mono, None)
    return None


def metric_series(
    hostname: str,
    role: str,
    metric: str,
    points: int = POINTS_PER_DAY,
) -> list[float]:
    """Return real telemetry readings from Redis/live cache or Prometheus TSDB; empty list if none."""
    from netops.services.state import get_state_manager

    cached = get_state_manager().get_telemetry_series(hostname, metric, points)
    if not cached:
        cached = list(_LIVE_METRIC_CACHE.get(hostname, {}).get(metric, []))[-points:]
    if len(cached) >= min(points, 4):
        return cached[-points:]

    try:
        from netops.settings import get_settings

        settings = get_settings()
        if "PYTEST_CURRENT_TEST" not in os.environ:
            settings.apply_runtime_overlay(respect_explicit=True)
        if settings.prometheus_url:
            prom = query_prometheus_metric(settings.prometheus_url, hostname, metric, points)
            if prom:
                return prom
    except Exception:
        pass
    return cached
