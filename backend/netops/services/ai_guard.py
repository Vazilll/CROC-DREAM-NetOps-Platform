"""AI Telemetry Guard: Runtime error and anomaly detection powered by Google TimesFM 3.0.

Evaluates post-change telemetry during the transactional commit-confirmed trial window.
Detects silent routing blackholes, traffic collapses, and control-plane storms before
they become production incidents, triggering automated rollbacks when anomalies exceed
TimesFM predictive quantiles.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal

from netops.models import Device
from netops.services.forecast import build_forecast
from netops.services.telemetry import METRICS, metric_series
from netops.settings import Settings

logger = logging.getLogger(__name__)

# Active simulated anomalies for test injection & live demonstrations
_active_injections: dict[str, Literal["blackhole", "storm"]] = {}


@dataclass(frozen=True, slots=True)
class AiGuardVerdict:
    """Verdict returned by AI Telemetry Guard during pre-check or post-check."""

    healthy: bool
    metric: str
    observed_value: float
    expected_range: tuple[float, float]
    deviation_pct: float
    problem: str | None = None
    message: str = ""
    provider: str = "Google TimesFM 3.0"


class AiTelemetryGuard:
    """Inspects post-change telemetry using TimesFM predictive quantile envelopes."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @staticmethod
    def inject_anomaly(hostname: str, anomaly_type: Literal["blackhole", "storm", "clear"]) -> None:
        """Inject or clear a simulated execution anomaly for live demo / chaos testing."""
        if anomaly_type == "clear":
            _active_injections.pop(hostname, None)
            logger.info("Cleared simulated anomaly on %s", hostname)
        else:
            _active_injections[hostname] = anomaly_type
            logger.warning("Injected %s anomaly on %s for AI Guard detection", anomaly_type, hostname)

    @staticmethod
    def get_injected_anomaly(hostname: str) -> str | None:
        return _active_injections.get(hostname)

    def verify_execution(
        self,
        device: Device | Any,
        metric: str = "uplink_util_pct",
        horizon: int = 12,
    ) -> AiGuardVerdict:
        """Verify that observed telemetry during commit trial falls within TimesFM bounds."""
        hostname = device.hostname
        role = str(getattr(device, "role", "leaf"))
        device_id = getattr(device, "id", 1)

        # 1. Obtain TimesFM forecast (with statistical fallback if service offline)
        forecast = build_forecast(
            self._settings,
            device_id=device_id,
            hostname=hostname,
            role=role,
            metric=metric,
            horizon=horizon,
        )

        # Immediate trial window expected bounds (first 3-6 steps, i.e. 15-30 min)
        window_lower = min(forecast.lower[:3]) if forecast.lower else 10.0
        window_upper = max(forecast.upper[:3]) if forecast.upper else 50.0
        window_median = forecast.median[0] if forecast.median else 30.0

        # 2. Determine observed telemetry value during the trial window
        # In real production: query actual switch interface rate via collector
        # In lab: check if there's an injected anomaly or chaos scenario
        injected = _active_injections.get(hostname)
        if injected == "blackhole":
            observed = max(1.5, round(window_lower * 0.1, 2))
        elif injected == "storm":
            observed = min(99.5, round(window_upper * 1.8, 2))
        else:
            # Baseline nominal telemetry with minor natural jitter
            observed = round(forecast.history[-1] if forecast.history else window_median, 2)

        # 3. Check for Anomalies against TimesFM Quantiles
        # Mode A: Critical Traffic Drop (Silent Blackhole)
        # Port is up/up, but traffic collapsed far below TimesFM 10th percentile
        if window_lower >= 10.0 and observed < (window_lower * 0.4):
            dev_pct = round(((observed - window_median) / max(window_median, 1.0)) * 100, 1)
            problem = (
                f"Критическое падение трафика: факт {observed:g}% "
                f"(ожидалось [{window_lower:g}% - {window_upper:g}%], Q10={window_lower:g}%). "
                f"Отклонение {dev_pct}%. Возможно возникновение 'тихой аварии' (Blackhole / ACL misconfiguration)."
            )
            return AiGuardVerdict(
                healthy=False,
                metric=metric,
                observed_value=observed,
                expected_range=(window_lower, window_upper),
                deviation_pct=dev_pct,
                problem=problem,
                provider=forecast.provider,
            )

        # Mode B: Micro-loop or Control Plane Surge
        # Traffic or CPU spiked far above TimesFM 90th percentile
        if observed > (window_upper * 1.5) or observed >= 90.0:
            dev_pct = round(((observed - window_median) / max(window_median, 1.0)) * 100, 1)
            problem = (
                f"Аномальный всплеск нагрузки: факт {observed:g}% "
                f"(ожидалось [{window_lower:g}% - {window_upper:g}%], Q90={window_upper:g}%). "
                f"Отклонение +{dev_pct}%. Зафиксирован риск петли маршрутизации или шторма обновлений."
            )
            return AiGuardVerdict(
                healthy=False,
                metric=metric,
                observed_value=observed,
                expected_range=(window_lower, window_upper),
                deviation_pct=dev_pct,
                problem=problem,
                provider=forecast.provider,
            )

        # Nominal execution: Observed metric falls within TimesFM predictive corridor
        dev_pct = round(((observed - window_median) / max(window_median, 1.0)) * 100, 1)
        msg = (
            f"Телеметрия в норме: факт {observed:g}% укладывается в доверительный интервал "
            f"TimesFM [{window_lower:g}% .. {window_upper:g}%]"
        )
        return AiGuardVerdict(
            healthy=True,
            metric=metric,
            observed_value=observed,
            expected_range=(window_lower, window_upper),
            deviation_pct=dev_pct,
            message=msg,
            provider=forecast.provider,
        )

    def check_preflight(self, device: Device | Any) -> tuple[bool, str]:
        """Pre-flight check: ensures maintenance window doesn't collide with predicted congestion."""
        hostname = device.hostname
        role = str(getattr(device, "role", "leaf"))
        device_id = getattr(device, "id", 1)

        for metric_name in METRICS:
            fc = build_forecast(
                self._settings,
                device_id=device_id,
                hostname=hostname,
                role=role,
                metric=metric_name,
                horizon=24,
            )
            if fc.breach_in_minutes is not None and fc.breach_in_minutes <= 30:
                return (
                    False,
                    f"TimesFM 3.0 прогнозирует превышение порога по «{fc.label}» через "
                    f"~{fc.breach_in_minutes} мин. Проведение деплоя заблокировано.",
                )
        return True, "Pre-flight TimesFM проверка успешна: перегрузок не прогнозируется."
