from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.enums import DeviceRole, DeviceStatus, JobStatus, JobType, Platform
from netops.intent import IntentValidationError, InventoryDevice
from netops.models import Device, Job
from netops.network.base import HealthExpectations
from netops.services.state import get_state_manager
from netops.services.telemetry import (
    record_live_metric,
    resolve_device_ports,
)
from netops.telemetry import metrics
from netops.telemetry.metrics import Sample
from netops.toolchain import Toolchain

logger = logging.getLogger(__name__)

LATEST_SNAPSHOT_KEY = "netops:telemetry:latest"


# Один проход сбора: счётчики из базы и опрос стенда. Все замеры пишутся с одним
# collected_at, поэтому /metrics отдаёт срез последнего сбора.
def collect(
    session: Session,
    toolchain: Toolchain | None = None,
    *,
    include_fabric_label: bool = False,
    max_workers: int = 16,
) -> list[Sample]:
    try:
        from netops.services.retention import pre_collect_cleanup

        pre_collect_cleanup(session)
    except Exception:
        pass
    dev_samples = (
        device_samples(
            session,
            toolchain,
            max_workers=max_workers,
            include_fabric_label=include_fabric_label,
        )
        if toolchain is not None
        else []
    )
    samples = platform_samples(session)
    samples.extend(dev_samples)
    return samples


# Публикует срез последнего сбора в Redis (StateManager) и пушит ряды напрямую в VictoriaMetrics TSDB.
# TTL нужен, чтобы /metrics не отдавал «вечно живые» значения, если сборщик остановился.
def publish(samples: Sequence[Sample], *, ttl_seconds: int | None = None) -> datetime:
    import os
    import urllib.request

    collected_at = utcnow()
    get_state_manager().set_json(
        LATEST_SNAPSHOT_KEY,
        {
            "collected_at": collected_at.isoformat(),
            "samples": [[s.name, s.value, dict(s.labels)] for s in samples],
        },
        ex=ttl_seconds,
    )
    vm_url = os.environ.get("NETOPS_VICTORIAMETRICS_URL", "").strip().rstrip("/")
    if vm_url and "PYTEST_CURRENT_TEST" not in os.environ and samples:
        try:
            body = metrics.render(samples, collected_at).encode("utf-8")
            req = urllib.request.Request(
                f"{vm_url}/api/v1/import/prometheus",
                data=body,
                headers={"Content-Type": "text/plain"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.0):
                pass
        except Exception as exc:
            logger.debug("VictoriaMetrics direct push skipped: %s", exc)
    return collected_at


def latest() -> tuple[list[Sample], datetime | None]:
    data = get_state_manager().get_json(LATEST_SNAPSHOT_KEY)
    if not data:
        return [], None
    samples = [Sample(name, float(value), dict(labels)) for name, value, labels in data["samples"]]
    return samples, datetime.fromisoformat(data["collected_at"])


def platform_samples(session: Session) -> list[Sample]:
    samples: list[Sample] = []
    devices = session.scalars(select(Device).order_by(Device.hostname)).all()
    counts = dict.fromkeys(DeviceStatus, 0)
    for device in devices:
        counts[device.status] += 1
        for status in DeviceStatus:
            samples.append(
                Sample(
                    metrics.DEVICE_STATUS,
                    float(device.status is status),
                    {
                        "hostname": device.hostname,
                        "platform": device.platform.value,
                        "role": device.role.value,
                        "status": status.value,
                    },
                )
            )
    samples.extend(
        Sample(metrics.DEVICES_TOTAL, float(count), {"status": status.value})
        for status, count in counts.items()
    )
    samples.append(Sample(metrics.DRIFT_DEVICES, float(counts[DeviceStatus.DRIFT_DETECTED])))
    samples.append(Sample(metrics.DRIFT_DEVICES_TOTAL, float(counts[DeviceStatus.DRIFT_DETECTED])))

    job_counts = session.execute(
        select(Job.type, Job.status, func.count()).group_by(Job.type, Job.status)
    ).all()
    seen = {(job_type, status) for job_type, status, _ in job_counts}
    samples.extend(
        Sample(metrics.JOBS_TOTAL, float(count), {"type": job_type.value, "status": status.value})
        for job_type, status, count in job_counts
    )
    samples.extend(
        Sample(metrics.JOBS_TOTAL, 0.0, {"type": job_type.value, "status": status.value})
        for job_type in JobType
        for status in JobStatus
        if (job_type, status) not in seen
    )

    finished = session.execute(
        select(Job.type, func.max(Job.finished_at))
        .where(Job.finished_at.is_not(None))
        .group_by(Job.type)
    ).all()
    samples.extend(
        Sample(metrics.JOB_LAST_FINISHED, finished_at.timestamp(), {"type": job_type.value})
        for job_type, finished_at in finished
        if finished_at is not None
    )
    return samples


_SERVER_METRICS: tuple[tuple[str, str], ...] = (
    ("cpu_pct", metrics.SERVER_CPU_UTIL),
    ("memory_pct", metrics.SERVER_MEMORY_UTIL),
    ("disk_util_pct", metrics.SERVER_DISK_UTIL),
    ("network_rate_mbps", metrics.SERVER_NETWORK_RATE),
    ("load_1m", metrics.SERVER_LOAD_1M),
)


# Отдаём только то, что сервер реально вернул: пропуск лучше выдуманного значения.
def _emit_server_samples(
    health: Any,
    labels: dict[str, str],
    hostname: str,
) -> list[Sample]:
    res: list[Sample] = []
    for attr, metric_name in _SERVER_METRICS:
        raw = getattr(health, attr, None)
        if raw is None:
            continue
        val = float(raw)
        record_live_metric(hostname, attr, val)
        res.append(Sample(metric_name, val, labels))
    return res


def _emit_switch_samples(
    health: Any,
    labels: dict[str, str],
    hostname: str,
) -> list[Sample]:
    res: list[Sample] = []
    if health.cpu_pct is not None:
        val = float(health.cpu_pct)
        res.append(Sample(metrics.CPU_USAGE, val, labels))
        res.append(Sample(metrics.DEVICE_CPU_UTIL, val, labels))
        record_live_metric(hostname, "cpu_pct", val)
    if health.memory_pct is not None:
        val = float(health.memory_pct)
        res.append(Sample(metrics.MEMORY_USAGE, val, labels))
        res.append(Sample(metrics.DEVICE_MEMORY_UTIL, val, labels))
        record_live_metric(hostname, "memory_pct", val)
    if health.uplink_util_pct is not None:
        val = float(health.uplink_util_pct)
        res.append(Sample(metrics.UPLINK_UTIL, val, labels))
        res.append(Sample(metrics.DEVICE_UPLINK_UTIL, val, labels))
        record_live_metric(hostname, "uplink_util_pct", val)

    for peer, session_state in health.bgp_sessions.items():
        peer_labels = labels | {"peer": peer, "state": session_state.state}
        res.append(Sample(metrics.BGP_SESSION_UP, float(session_state.established), peer_labels))
        if session_state.prefixes_accepted is not None:
            res.append(
                Sample(
                    metrics.BGP_PREFIXES_ACCEPTED,
                    float(session_state.prefixes_accepted),
                    labels | {"peer": peer},
                )
            )
    res.extend(
        Sample(
            metrics.INTERFACE_UP,
            float(state.is_up),
            labels | {"interface": name, "state": str(state)},
        )
        for name, state in health.interfaces.items()
    )
    res.extend(
        Sample(metrics.PING_LOSS, loss, labels | {"peer": peer})
        for peer, loss in health.ping_loss_percent.items()
    )
    return res


def _is_server_device(device: Device) -> bool:
    return (
        device.platform == Platform.LINUX_SERVER
        or getattr(device, "role", None) == DeviceRole.SERVER
        or "server" in str(device.platform).lower()
        or "server" in str(device.role).lower()
    )


def _build_probe_tasks(
    devices: list[Device],
    snapshot: Any,
    toolchain: Toolchain,
    include_fabric_label: bool,
) -> list[
    tuple[Device, dict[str, str], HealthExpectations, Any, Exception | None, dict[str, int]]
]:
    probe_tasks = []
    for device in devices:
        intent = snapshot.intent_for(device.hostname) if snapshot is not None else None
        expectations = (
            HealthExpectations.from_intent(intent)
            if intent is not None
            else HealthExpectations(interfaces={}, bgp_peers=frozenset())
        )
        labels = {"hostname": device.hostname}
        if include_fabric_label:
            labels["fabric_id"] = getattr(device, "fabric_id", "default") or "default"
        resolved_ports = resolve_device_ports(
            str(device.management_ip),
            management_port=device.management_port,
            platform=device.platform,
        )
        try:
            target = toolchain.target_for(InventoryDevice.model_validate(device))
            probe_tasks.append((device, labels, expectations, target, None, resolved_ports))
        except Exception as exc:
            probe_tasks.append((device, labels, expectations, None, exc, resolved_ports))
    return probe_tasks


# Опрос стенда: что заявлено в intent, то и проверяем. Устройство, которое не ответило,
# отмечаем недоступным и идём дальше — сбор метрик не должен падать из-за одной ноды.
def device_samples(
    session: Session,
    toolchain: Toolchain,
    *,
    max_workers: int = 16,
    include_fabric_label: bool = False,
) -> list[Sample]:
    from concurrent.futures import ThreadPoolExecutor

    snapshot = None
    try:
        snapshot = toolchain.intents.load()
    except IntentValidationError as exc:
        logger.warning(
            "Intent содержит предупреждения (%s) — продолжаем сбор базовой телеметрии", exc
        )

    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    if not devices:
        return []

    probe_tasks = _build_probe_tasks(devices, snapshot, toolchain, include_fabric_label)

    def _run_probe(
        item: tuple[
            Device, dict[str, str], HealthExpectations, Any, Exception | None, dict[str, int]
        ],
    ):
        dev, lbls, exp, tgt, prep_err, ports = item
        if prep_err is not None or tgt is None:
            return dev, lbls, None, prep_err, ports
        if (
            toolchain.health_probe.__class__.__name__ == "ScrapliNetworkDriver"
            and _is_server_device(dev)
        ):
            from netops.network.base import HealthSnapshot
            from netops.telemetry import targets

            if targets.is_externally_collected(dev.hostname):
                return (
                    dev,
                    lbls,
                    HealthSnapshot(bgp_sessions={}, interfaces={}, ping_loss_percent={}),
                    None,
                    ports,
                )
        try:
            return dev, lbls, toolchain.health_probe.snapshot(tgt, exp), None, ports
        except Exception as exc:
            return dev, lbls, None, exc, ports

    workers = max(1, min(max_workers, len(probe_tasks)))
    if workers == 1:
        results = [_run_probe(item) for item in probe_tasks]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(_run_probe, probe_tasks))

    samples: list[Sample] = []
    status_changed = False
    for device, labels, health, err, _ports in results:
        if err is not None or health is None:
            from netops.services.telemetry import clear_live_metrics

            logger.info("Телеметрия с %s не снята: %s", device.hostname, err)
            if device.status not in (DeviceStatus.UNREACHABLE, DeviceStatus.UNKNOWN):
                device.status = DeviceStatus.UNREACHABLE
                status_changed = True
            clear_live_metrics(device.hostname)
            samples.append(Sample(metrics.DEVICE_REACHABLE, 0.0, labels))
            continue

        if device.status == DeviceStatus.UNREACHABLE:
            device.status = DeviceStatus.IN_SYNC
            status_changed = True
        samples.append(Sample(metrics.DEVICE_REACHABLE, 1.0, labels))
        if _is_server_device(device):
            samples.extend(_emit_server_samples(health, labels, device.hostname))
        else:
            samples.extend(_emit_switch_samples(health, labels, device.hostname))

    if status_changed:
        session.commit()
    return samples
