"""Metric forecasting: TimesFM over HTTP with statistical fallback and causal events."""

from __future__ import annotations

import json
import logging
import statistics
import time
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from netops.enums import DriftStatus, JobStatus, JobType, TargetStatus
from netops.models import DriftRecord, Job, JobTarget
from netops.services.telemetry import METRICS, POINTS_PER_DAY, STEP_SECONDS, metric_series
from netops.settings import Settings

logger = logging.getLogger(__name__)

HISTORY_SHOWN = 144
_CACHE_TTL = 60.0
# Cache stores ML prediction result (median, lower, upper, provider) rather than whole ForecastRead
_cache: dict[tuple[str, str, int], tuple[float, dict[str, Any]]] = {}

# Short-circuit error caching for unreachable TimesFM service
_SERVICE_FAILURE_COOLDOWN = 30.0
_service_failure_cooldown: dict[str, float] = {}

# In-memory chaos event ring buffer
_MAX_CHAOS_EVENTS = 200
_chaos_events: list[dict[str, Any]] = []


class ForecastEvent(BaseModel):
    type: Literal["DEPLOY", "DRIFT_DETECTED", "REMEDIATE", "CHAOS"]
    timestamp: str
    title: str
    description: str
    severity: Literal["info", "warning", "critical", "success"]
    relative_index: int | None = None


class ForecastRead(BaseModel):
    device_id: int
    hostname: str
    metric: str
    label: str
    unit: str
    threshold: float
    simulated: bool = True
    step_seconds: int = STEP_SECONDS
    end_ts: str
    history: list[float]
    median: list[float]
    lower: list[float]
    upper: list[float]
    provider: str
    breach_in_minutes: int | None = None
    events: list[ForecastEvent] = Field(default_factory=list)


def _normalize_dt(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def calculate_relative_index(
    event_time: datetime,
    end_time: datetime,
    step_seconds: int = STEP_SECONDS,
    history_len: int = HISTORY_SHOWN,
    horizon: int = 72,
) -> int | None:
    """Compute integer coordinate on the chart X-axis [0 .. history_len + horizon - 1]."""
    norm_event = _normalize_dt(event_time)
    norm_end = _normalize_dt(end_time)
    diff_seconds = (norm_end - norm_event).total_seconds()

    if diff_seconds >= 0:
        steps_ago = diff_seconds / step_seconds
        idx = (history_len - 1) - round(steps_ago)
        if 0 <= idx < history_len:
            return idx
        return None
    future_steps = -diff_seconds / step_seconds
    idx = (history_len - 1) + round(future_steps)
    if idx < history_len + horizon:
        return idx
    return None


def record_chaos_event(
    scenario: str,
    target_hostnames: list[str],
    title: str,
    description: str,
    severity: Literal["info", "warning", "critical", "success"] = "warning",
    timestamp: str | None = None,
    lab_dir: Path | None = None,
) -> dict[str, Any]:
    """Record an incident simulation event in memory and optionally persist to lab path."""
    ts = timestamp or datetime.now(UTC).isoformat()
    record = {
        "type": "CHAOS",
        "scenario": scenario,
        "target_hostnames": target_hostnames,
        "title": title,
        "description": description,
        "severity": severity,
        "timestamp": ts,
    }
    _chaos_events.append(record)
    if len(_chaos_events) > _MAX_CHAOS_EVENTS:
        _chaos_events.pop(0)

    # Invalidate ML cache so latest events display immediately
    _cache.clear()

    if lab_dir is not None:
        try:
            log_file = lab_dir / "chaos_events.json"
            events_to_save = _chaos_events[-50:]
            payload = json.dumps(events_to_save, indent=2, ensure_ascii=False)
            log_file.write_text(payload, encoding="utf-8")
        except Exception as exc:
            logger.debug("Failed writing chaos events to %s: %s", lab_dir, exc)

    return record


def get_chaos_events(hostname: str | None = None) -> list[dict[str, Any]]:
    """Return chaos events for a specific hostname or all events if hostname is None."""
    if not hostname:
        return list(_chaos_events)
    short = hostname.split(".", maxsplit=1)[0]
    matched: list[dict[str, Any]] = []
    for ev in _chaos_events:
        targets = ev.get("target_hostnames", [])
        if "*" in targets or hostname in targets or short in targets:
            matched.append(ev)
    return matched


def clear_chaos_events() -> None:
    """Reset chaos events (for test isolation)."""
    _chaos_events.clear()
    _cache.clear()


def clear_forecast_cache() -> None:
    """Clear ML forecasting cache and reset service failure cooldown."""
    _cache.clear()
    _service_failure_cooldown.clear()


def _get_baseline_demo_events(
    device_id: int,
    hostname: str,
    end_time: datetime,
    step_seconds: int = STEP_SECONDS,
    history_points: int = HISTORY_SHOWN,
) -> list[ForecastEvent]:
    """Deterministic baseline annotations for demo mode when database history is empty."""
    demo_events: list[ForecastEvent] = []

    # Baseline 1: DEPLOY 6 hours ago
    deploy_time = end_time - timedelta(hours=6)
    deploy_idx = calculate_relative_index(deploy_time, end_time, step_seconds, history_points)
    demo_events.append(
        ForecastEvent(
            type="DEPLOY",
            timestamp=deploy_time.isoformat(),
            title="Плановый деплой CLOS-фабрики",
            description="Синхронизация с эталоном Git SoT (main branch)",
            severity="success",
            relative_index=deploy_idx,
        )
    )

    # Baseline 2: For leaf switches, simulate a DRIFT_DETECTED event 2 hours ago
    if "leaf" in hostname.lower():
        drift_time = end_time - timedelta(hours=2)
        drift_idx = calculate_relative_index(drift_time, end_time, step_seconds, history_points)
        demo_events.append(
            ForecastEvent(
                type="DRIFT_DETECTED",
                timestamp=drift_time.isoformat(),
                title="Дрейф ACL политики",
                description="Обнаружено несанкционированное правило permit ip any any",
                severity="warning",
                relative_index=drift_idx,
            )
        )

    return demo_events


def _query_job_events(
    sess: Session,
    device_id: int,
    hostname: str,
    short_hostname: str,
    end_time: datetime,
    step_seconds: int,
    history_points: int,
    horizon: int,
) -> list[ForecastEvent]:
    events: list[ForecastEvent] = []
    try:
        job_stmt = (
            select(Job, JobTarget)
            .join(JobTarget, Job.id == JobTarget.job_id)
            .where(
                or_(
                    JobTarget.device_id == device_id,
                    JobTarget.hostname == hostname,
                    JobTarget.hostname == short_hostname,
                ),
                Job.type.in_([JobType.DEPLOY, JobType.DRIFT_REMEDIATE]),
            )
            .order_by(Job.created_at.desc())
            .limit(20)
        )
        for job, target in sess.execute(job_stmt):
            ts = job.finished_at or job.started_at or job.created_at
            if ts is None:
                continue
            is_deploy = job.type == JobType.DEPLOY
            is_success = target.status == TargetStatus.SUCCESS or job.status == JobStatus.SUCCESS
            is_fail = (
                target.status in (TargetStatus.FAILED, TargetStatus.ROLLED_BACK)
                or job.status == JobStatus.FAILED
            )
            if is_deploy:
                event_type: Literal["DEPLOY", "DRIFT_DETECTED", "REMEDIATE", "CHAOS"] = "DEPLOY"
                if is_success:
                    title, desc, sev = (
                        "Деплой конфигурации",
                        f"Успешное применение конфигурации (Job {str(job.id)[:8]})",
                        "success",
                    )
                elif is_fail:
                    title, desc, sev = (
                        "Сбой деплоя",
                        f"Ошибка применения: {target.error or job.error or 'Сбой'}",
                        "critical",
                    )
                else:
                    title, desc, sev = (
                        "Деплой конфигурации",
                        f"Статус: {target.status.value}",
                        "info",
                    )
            else:
                event_type = "REMEDIATE"
                if is_success:
                    title, desc, sev = (
                        "Устранение дрейфа",
                        f"Дрейф устранен через Git SoT (Job {str(job.id)[:8]})",
                        "success",
                    )
                elif is_fail:
                    title, desc, sev = (
                        "Сбой устранения дрейфа",
                        f"Ошибка: {target.error or job.error or 'Сбой'}",
                        "critical",
                    )
                else:
                    title, desc, sev = (
                        "Устранение дрейфа",
                        f"Статус: {target.status.value}",
                        "info",
                    )

            rel_idx = calculate_relative_index(ts, end_time, step_seconds, history_points, horizon)
            events.append(
                ForecastEvent(
                    type=event_type,
                    timestamp=ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    title=title,
                    description=desc,
                    severity=sev,
                    relative_index=rel_idx,
                )
            )
    except Exception as exc:
        logger.warning("Error querying jobs for forecast events: %s", exc)
    return events


def _query_drift_events(
    sess: Session,
    device_id: int,
    end_time: datetime,
    step_seconds: int,
    history_points: int,
    horizon: int,
) -> list[ForecastEvent]:
    events: list[ForecastEvent] = []
    try:
        drift_stmt = (
            select(DriftRecord)
            .where(
                DriftRecord.device_id == device_id,
                DriftRecord.status == DriftStatus.DRIFT_DETECTED,
            )
            .order_by(DriftRecord.checked_at.desc())
            .limit(20)
        )
        for drift in sess.scalars(drift_stmt):
            ts = drift.checked_at
            if ts is None:
                continue
            unauth = len(drift.unauthorized_lines or [])
            missing = len(drift.missing_lines or [])
            desc = f"Зафиксирован дрейф (+{unauth} / -{missing} строк)"
            rel_idx = calculate_relative_index(ts, end_time, step_seconds, history_points, horizon)
            events.append(
                ForecastEvent(
                    type="DRIFT_DETECTED",
                    timestamp=ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    title="Обнаружен дрейф конфигурации",
                    description=desc,
                    severity="warning",
                    relative_index=rel_idx,
                )
            )
    except Exception as exc:
        logger.warning("Error querying drift records for forecast events: %s", exc)
    return events


def collect_forecast_events(
    device_id: int,
    hostname: str,
    end_time: datetime,
    step_seconds: int = STEP_SECONDS,
    history_points: int = HISTORY_SHOWN,
    horizon: int = 72,
    session: Session | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> list[ForecastEvent]:
    """Aggregate historical events (DEPLOY, DRIFT_REMEDIATE, DRIFT_DETECTED, CHAOS)."""
    events: list[ForecastEvent] = []
    short_hostname = hostname.split(".", maxsplit=1)[0]

    def _query_db(sess: Session) -> None:
        events.extend(
            _query_job_events(
                sess,
                device_id,
                hostname,
                short_hostname,
                end_time,
                step_seconds,
                history_points,
                horizon,
            )
        )
        events.extend(
            _query_drift_events(
                sess, device_id, end_time, step_seconds, history_points, horizon
            )
        )

    if session is not None:
        _query_db(session)
    elif session_factory is not None:
        try:
            with session_factory() as sess:
                _query_db(sess)
        except Exception as exc:
            logger.warning("Error executing session_factory query for forecast events: %s", exc)

    # 3. Add Chaos Events
    chaos_list = get_chaos_events(hostname)
    for item in chaos_list:
        ts_str = item["timestamp"]
        try:
            ts_dt = datetime.fromisoformat(ts_str)
        except Exception:
            ts_dt = end_time
        rel_idx = calculate_relative_index(ts_dt, end_time, step_seconds, history_points, horizon)
        events.append(
            ForecastEvent(
                type="CHAOS",
                timestamp=ts_str,
                title=item["title"],
                description=item["description"],
                severity=item["severity"],
                relative_index=rel_idx,
            )
        )

    # 4. If no events exist from DB or Chaos, provide synthetic baseline events for demo
    if not events:
        events.extend(
            _get_baseline_demo_events(device_id, hostname, end_time, step_seconds, history_points)
        )

    # Sort events chronologically
    events.sort(key=lambda e: e.timestamp)
    return events


def _remote_forecast(
    url: str, timeout: float, series: list[float], horizon: int
) -> dict[str, Any]:
    body = json.dumps({"series": series, "horizon": horizon}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _statistical_forecast(series: list[float], horizon: int) -> dict[str, Any]:
    # ponytail: linear trend over the last 8h + residual band; no seasonality. Use TimesFM for that.
    tail = series[-96:]
    xs = list(range(len(tail)))
    fit = statistics.linear_regression(xs, tail)
    resid = statistics.pstdev([
        y - (fit.intercept + fit.slope * x) for x, y in zip(xs, tail, strict=True)
    ])
    median = [fit.intercept + fit.slope * (len(tail) + i) for i in range(horizon)]
    spread = [resid * (1 + i / horizon) * 1.28 for i in range(horizon)]
    return {
        "median": median,
        "lower": [m - s for m, s in zip(median, spread, strict=True)],
        "upper": [m + s for m, s in zip(median, spread, strict=True)],
        "provider": "Статистический тренд (fallback)",
    }


def build_forecast(
    settings: Settings,
    device_id: int,
    hostname: str,
    role: str,
    metric: str,
    horizon: int,
    *,
    session: Session | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> ForecastRead:
    key = (hostname, metric, horizon)
    cached = _cache.get(key)
    result: dict[str, Any] | None = None
    if cached and time.monotonic() - cached[0] < _CACHE_TTL:
        result = cached[1]

    spec = METRICS[metric]
    series = metric_series(hostname, role, metric, POINTS_PER_DAY)
    if result is None:
        if settings.forecast_url:
            cooldown_until = _service_failure_cooldown.get(settings.forecast_url, 0.0)
            if time.monotonic() >= cooldown_until:
                try:
                    probe_timeout = min(settings.forecast_timeout_seconds, 1.5)
                    result = _remote_forecast(
                        settings.forecast_url, probe_timeout, series, horizon
                    )
                    result.setdefault("provider", "Google TimesFM 3.0")
                    _service_failure_cooldown.pop(settings.forecast_url, None)
                except Exception as exc:
                    _service_failure_cooldown[settings.forecast_url] = (
                        time.monotonic() + _SERVICE_FAILURE_COOLDOWN
                    )
                    logger.warning(
                        "TimesFM service unavailable (%s); marking down for %gs and using "
                        "statistical fallback",
                        exc,
                        _SERVICE_FAILURE_COOLDOWN,
                    )
        if result is None:
            result = _statistical_forecast(series, horizon)
        _cache[key] = (time.monotonic(), result)

    median = [round(v, 2) for v in result["median"]]
    breach = next((i for i, v in enumerate(median) if v >= spec.threshold), None)
    end_dt = datetime.now(UTC)
    end_ts = end_dt.isoformat()

    events = collect_forecast_events(
        device_id=device_id,
        hostname=hostname,
        end_time=end_dt,
        step_seconds=STEP_SECONDS,
        history_points=HISTORY_SHOWN,
        horizon=horizon,
        session=session,
        session_factory=session_factory,
    )

    return ForecastRead(
        device_id=device_id,
        hostname=hostname,
        metric=metric,
        label=spec.label,
        unit=spec.unit,
        threshold=spec.threshold,
        end_ts=end_ts,
        history=series[-HISTORY_SHOWN:],
        median=median,
        lower=[round(v, 2) for v in result["lower"]],
        upper=[round(v, 2) for v in result["upper"]],
        provider=result["provider"],
        breach_in_minutes=None if breach is None else (breach + 1) * STEP_SECONDS // 60,
        events=events,
    )
