"""Prometheus / VictoriaMetrics TSDB query and health check client."""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request

STEP_SECONDS = 300
POINTS_PER_DAY = 288

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
                    pts = [
                        round(val, 2)
                        for v in values
                        if len(v) >= 2 and math.isfinite(val := float(v[1]))
                    ]
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
