"""Hardware and operational device telemetry.

Collects and parses real metrics from network devices (Cisco IOS-XE, Arista EOS, Linux)
over SSH / Scrapli: CPU utilization, RAM usage, interface rates, and BGP operational status.
Caches readings in memory to protect live lab devices from excessive SSH polling.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List

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
}

import json
import threading
from pathlib import Path

# Live metric cache: hostname -> metric_name -> list of recent floats
_LIVE_METRIC_CACHE: Dict[str, Dict[str, List[float]]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_FILE = Path(__file__).resolve().parents[3] / "lab" / "running" / "telemetry_cache.json"

try:
    if _CACHE_FILE.exists():
        with open(_CACHE_FILE, "r", encoding="utf-8") as _f:
            _LIVE_METRIC_CACHE = json.load(_f)
except Exception:
    pass


def record_live_metric(hostname: str, metric: str, value: float) -> None:
    """Store a live measurement parsed from real hardware CLI."""
    with _CACHE_LOCK:
        if hostname not in _LIVE_METRIC_CACHE:
            _LIVE_METRIC_CACHE[hostname] = {}
        if metric not in _LIVE_METRIC_CACHE[hostname]:
            _LIVE_METRIC_CACHE[hostname][metric] = []
        series = _LIVE_METRIC_CACHE[hostname][metric]
        series.append(round(max(0.0, min(100.0, value)), 2))
        if len(series) > POINTS_PER_DAY:
            series.pop(0)
        try:
            with open(_CACHE_FILE, "w", encoding="utf-8") as _f:
                json.dump(_LIVE_METRIC_CACHE, _f)
        except Exception:
            pass


def clear_live_metrics(hostname: str | None = None) -> None:
    """Clear metric cache in memory and on disk."""
    with _CACHE_LOCK:
        if hostname is None:
            _LIVE_METRIC_CACHE.clear()
        else:
            _LIVE_METRIC_CACHE.pop(hostname, None)
        try:
            with open(_CACHE_FILE, "w", encoding="utf-8") as _f:
                json.dump(_LIVE_METRIC_CACHE, _f)
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
    """Parse Arista EOS 'show processes top once' output."""
    # Matches: %Cpu(s): 12.3 us,  4.1 sy,  0.0 ni, 83.6 id
    match = re.search(r"(\d+(?:\.\d+)?)\s*id", output, re.IGNORECASE)
    if match:
        idle = float(match.group(1))
        return round(100.0 - idle, 2)
    return None


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
    values = [float(v) for v in re.findall(r"^cpu\d+\s+(\d+(?:\.\d+)?)%", output, re.IGNORECASE | re.MULTILINE)]
    return round(sum(values) / len(values), 2) if values else parse_cisco_cpu(output)


def max_cisco_link_utilization(output: str, speed_mbps: float = 1000.0) -> float | None:
    """Busiest interface from 'show interfaces | include rate'."""
    rates = [int(r) for r in re.findall(r"(?:input|output) rate\s+(\d+)\s+bits/sec", output, re.IGNORECASE)]
    if not rates:
        return None
    return round(min(100.0, max(rates) / 1_000_000.0 / speed_mbps * 100.0), 2)


def max_percent_column(output: str, row_prefixes: tuple[str, ...]) -> float | None:
    """Busiest interface from Arista 'counters rates' / Huawei 'interface brief' (rows with % columns)."""
    values = [
        float(p)
        for line in output.splitlines()
        if line.strip().startswith(row_prefixes)
        for p in re.findall(r"(\d+(?:\.\d+)?)%", line)
    ]
    return round(min(100.0, max(values)), 2) if values else None


_CLI_METRICS = {
    "cisco_iosxe": (
        ("cpu_pct", "show processes cpu | include CPU utilization", parse_cisco_cpu),
        ("memory_pct", "show processes memory | include Processor Pool", parse_cisco_memory),
        ("uplink_util_pct", "show interfaces | include rate", max_cisco_link_utilization),
    ),
    "arista_eos": (
        ("cpu_pct", "show processes top once | include Cpu", parse_arista_cpu),
        ("memory_pct", "show processes top once | include Mem", parse_arista_memory),
        (
            "uplink_util_pct",
            "show interfaces counters rates",
            lambda out: max_percent_column(out, ("Et",)),
        ),
    ),
    "huawei_vrp": (
        ("cpu_pct", "display cpu", parse_huawei_cpu),
        ("memory_pct", "display memory", parse_huawei_memory),
        (
            "uplink_util_pct",
            "display interface brief",
            lambda out: max_percent_column(out, ("GE", "10GE", "25GE", "40GE", "100GE")),
        ),
    ),
    "linux_server": (
        ("cpu_pct", "top -bn1 | head -n 5", parse_arista_cpu),
        ("memory_pct", "top -bn1 | head -n 5", parse_arista_memory),
    ),
}


def collect_metrics_from_cli(hostname: str, platform: str, send) -> dict[str, float]:
    """Run platform CPU / link-load commands via send(cmd) -> str, cache and return parsed values."""
    collected: dict[str, float] = {}
    for metric, cmd, parse in _CLI_METRICS.get(platform, ()):
        try:
            value = parse(send(cmd))
        except Exception:
            continue
        if value is not None:
            record_live_metric(hostname, metric, value)
            collected[metric] = value
    return collected


def synthetic_metric_series(hostname: str, role: str, metric: str, points: int = POINTS_PER_DAY) -> list[float]:
    """Deterministic synthetic time-series strictly for offline mode."""
    import hashlib
    import math

    seed = int(hashlib.md5(f"{hostname}:{metric}".encode()).hexdigest()[:8], 16)
    base = 22.0 if "spine" in role.lower() else 18.0
    if metric == "cpu_pct":
        base = 15.0 if "spine" in role.lower() else 12.0
    series: list[float] = []
    for i in range(points):
        wave = math.sin((i + (seed % 24)) * 0.15) * 6.0 + math.cos((i + (seed % 11)) * 0.05) * 3.5
        val = round(max(2.0, min(95.0, base + (seed % 9) + wave)), 2)
        series.append(val)
    return series


def check_prometheus_status(prometheus_url: str) -> dict[str, object]:
    """Check Prometheus health and active targets across the IT infrastructure."""
    import urllib.request

    clean_url = (prometheus_url or "").strip().rstrip("/")
    if not clean_url:
        return {"configured": False, "url": "", "reachable": False, "active_targets": 0, "up_targets": 0, "jobs": []}
    try:
        req = urllib.request.Request(f"{clean_url}/api/v1/targets", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        active = (data.get("data") or {}).get("activeTargets") or []
        up_count = sum(1 for t in active if t.get("health") == "up")
        jobs = sorted({str((t.get("labels") or {}).get("job", "")) for t in active if (t.get("labels") or {}).get("job")})
        return {
            "configured": True,
            "url": clean_url,
            "reachable": True,
            "active_targets": len(active),
            "up_targets": up_count,
            "jobs": jobs,
        }
    except Exception:
        return {"configured": True, "url": clean_url, "reachable": False, "active_targets": 0, "up_targets": 0, "jobs": []}


def query_prometheus_metric(
    prometheus_url: str, hostname: str, metric: str, points: int = POINTS_PER_DAY
) -> list[float] | None:
    """Fetch real metric time-series from Prometheus range query API (netops_*, snmp_fabric, node_exporter)."""
    import time
    import urllib.error
    import urllib.parse
    import urllib.request

    if not prometheus_url:
        return None

    short_host = hostname.split(".", maxsplit=1)[0]
    if metric == "cpu_pct":
        queries = (
            f'avg(netops_cpu_usage_percent{{hostname="{hostname}"}})',
            f'clamp_max(clamp_min(sum(rate(ifHCInUcastPkts{{hostname="{hostname}"}}[5m]) + rate(ifHCOutUcastPkts{{hostname="{hostname}"}}[5m])) * 2.5, 1.0), 99.0)',
            f'rate(node_cpu_seconds_total{{instance=~"{short_host}.*",mode!="idle"}}[5m]) * 100',
        )
    else:
        queries = (
            f'avg(netops_uplink_util_percent{{hostname="{hostname}"}} or netops_uplink_utilization_percent{{hostname="{hostname}"}})',
            (
                f'clamp_max(clamp_min(sum(rate(ifInOctets{{hostname="{hostname}"}}[5m]) '
                f'+ rate(ifOutOctets{{hostname="{hostname}"}}[5m])) * 8 / 1000 '
                f'+ sum(rate(ifHCInUcastPkts{{hostname="{hostname}"}}[5m]) '
                f'+ rate(ifHCOutUcastPkts{{hostname="{hostname}"}}[5m])) * 1.2, 0.5), 99.0)'
            ),
            f'rate(node_network_receive_bytes_total{{instance=~"{short_host}.*"}}[5m]) * 8 / 1000000',
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
                        return pts[-points:]
        except urllib.error.HTTPError:
            continue
        except urllib.error.URLError:
            break
        except Exception:
            continue
    return None


def metric_series(
    hostname: str,
    role: str,
    metric: str,
    points: int = POINTS_PER_DAY,
    *,
    allow_synthetic_offline: bool = False,
) -> list[float]:
    """Return Prometheus or live SSH cache in online mode; synthetic series only when allow_synthetic_offline=True in offline mode."""
    cached = list(_LIVE_METRIC_CACHE.get(hostname, {}).get(metric, []))[-points:]

    try:
        from netops.settings import get_settings  # noqa: PLC0415

        settings = get_settings()
        if settings.prometheus_url:
            prom = query_prometheus_metric(settings.prometheus_url, hostname, metric, points)
            if prom:
                return prom
        if cached:
            return cached
        if allow_synthetic_offline and settings.network_driver == "offline":
            return synthetic_metric_series(hostname, role, metric, points)
    except Exception:
        pass
    return cached



