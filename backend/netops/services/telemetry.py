"""Simulated device telemetry.

The lab devices carry no real traffic, so metric history is generated deterministically from the
hostname: a daily cycle, noise and a per-device trend. Every consumer marks it as simulated.
Replace `metric_series` with a collector (SNMP / gNMI / Scrapli) to use real data.
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass

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


def metric_series(hostname: str, role: str, metric: str, points: int = POINTS_PER_DAY) -> list[float]:
    """Deterministic history, newest value last."""
    seed = int(hashlib.sha256(f"{hostname}:{metric}".encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    base = rng.uniform(22, 38)
    amplitude = rng.uniform(6, 14)
    # Leaves and firewalls creep upwards, spines stay flat: gives the forecast something to predict.
    trend = rng.uniform(0.04, 0.17) if role != "spine" else rng.uniform(-0.005, 0.01)
    phase = rng.uniform(0, 2 * math.pi)
    series = []
    for i in range(points):
        value = base + amplitude * math.sin(2 * math.pi * i / POINTS_PER_DAY + phase) + trend * i
        series.append(round(min(100.0, max(0.0, value + rng.gauss(0, 1.2))), 2))
    return series
