from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.enums import DeviceStatus, JobStatus, JobType
from netops.intent import IntentValidationError, InventoryDevice
from netops.models import Device, Job, MetricSample
from netops.network.base import HealthExpectations
from netops.telemetry import metrics
from netops.telemetry.metrics import Sample
from netops.toolchain import Toolchain

logger = logging.getLogger(__name__)


# Один проход сбора: счётчики из базы и опрос стенда. Все замеры пишутся с одним
# collected_at, поэтому /metrics отдаёт срез последнего сбора.
def collect(session: Session, toolchain: Toolchain | None = None) -> list[Sample]:
    samples = platform_samples(session)
    if toolchain is not None:
        samples.extend(device_samples(session, toolchain))
    return samples


def store(session: Session, samples: Sequence[Sample], *, retention: timedelta) -> datetime:
    collected_at = utcnow()
    session.add_all(
        MetricSample(
            name=sample.name,
            labels=dict(sample.labels),
            value=sample.value,
            collected_at=collected_at,
        )
        for sample in samples
    )
    session.execute(
        delete(MetricSample).where(MetricSample.collected_at < collected_at - retention)
    )
    session.commit()
    return collected_at


def latest(session: Session) -> tuple[list[Sample], datetime | None]:
    collected_at = session.scalar(select(func.max(MetricSample.collected_at)))
    if collected_at is None:
        return [], None
    rows = session.scalars(
        select(MetricSample)
        .where(MetricSample.collected_at == collected_at)
        .order_by(MetricSample.id)
    ).all()
    return [Sample(row.name, row.value, dict(row.labels)) for row in rows], collected_at


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


# Опрос стенда: что заявлено в intent, то и проверяем. Устройство, которое не ответило,
# отмечаем недоступным и идём дальше — сбор метрик не должен падать из-за одной ноды.
def device_samples(session: Session, toolchain: Toolchain) -> list[Sample]:
    try:
        snapshot = toolchain.intents.load()
    except IntentValidationError as exc:
        logger.warning("Телеметрия пропущена: intent не проходит проверку (%s)", exc)
        return []

    samples: list[Sample] = []
    for device in session.scalars(select(Device).order_by(Device.hostname)).all():
        intent = snapshot.intent_for(device.hostname)
        if intent is None:
            continue
        labels = {"hostname": device.hostname}
        try:
            target = toolchain.target_for(InventoryDevice.model_validate(device))
            health = toolchain.health_probe.snapshot(target, HealthExpectations.from_intent(intent))
        except Exception as exc:
            logger.info("Телеметрия с %s не снята: %s", device.hostname, exc)
            samples.append(Sample(metrics.DEVICE_REACHABLE, 0.0, labels))
            continue

        samples.append(Sample(metrics.DEVICE_REACHABLE, 1.0, labels))
        for peer, session_state in health.bgp_sessions.items():
            peer_labels = labels | {"peer": peer, "state": session_state.state}
            samples.append(
                Sample(metrics.BGP_SESSION_UP, float(session_state.established), peer_labels)
            )
            if session_state.prefixes_accepted is not None:
                samples.append(
                    Sample(
                        metrics.BGP_PREFIXES_ACCEPTED,
                        float(session_state.prefixes_accepted),
                        labels | {"peer": peer},
                    )
                )
        samples.extend(
            Sample(
                metrics.INTERFACE_UP,
                float(state.is_up),
                labels | {"interface": name, "state": str(state)},
            )
            for name, state in health.interfaces.items()
        )
        samples.extend(
            Sample(metrics.PING_LOSS, loss, labels | {"peer": peer})
            for peer, loss in health.ping_loss_percent.items()
        )
    return samples
