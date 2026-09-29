"""Drift reporting."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from netops.enums import DriftStatus
from netops.models import Device, DriftRecord


def latest_drift_records(
    session: Session,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    status: DriftStatus | None = None,
) -> Sequence[DriftRecord]:
    """The most recent check of every device within the time window.

    The status filter applies to that latest check, so a device whose drift
    has been remediated does not show up as drifted.
    """
    ranked = select(
        DriftRecord.id,
        func.row_number()
        .over(
            partition_by=DriftRecord.device_id,
            order_by=(DriftRecord.checked_at.desc(), DriftRecord.id.desc()),
        )
        .label("position"),
    )
    if since is not None:
        ranked = ranked.where(DriftRecord.checked_at >= since)
    if until is not None:
        ranked = ranked.where(DriftRecord.checked_at <= until)
    latest = ranked.subquery()

    query = (
        select(DriftRecord)
        .join(latest, (latest.c.id == DriftRecord.id) & (latest.c.position == 1))
        .join(DriftRecord.device)
        .options(joinedload(DriftRecord.device))
        .order_by(Device.hostname)
    )
    if status is not None:
        query = query.where(DriftRecord.status == status)
    return session.scalars(query).all()
