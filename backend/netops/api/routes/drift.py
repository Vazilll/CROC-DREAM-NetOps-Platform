from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Body, Query, status

from netops.api.deps import JobServiceDep, Operator, SessionDep, Viewer
from netops.enums import DriftStatus
from netops.schemas.drift import DriftRemediateRequest, DriftReportItem, DriftScanRequest
from netops.schemas.jobs import JobAccepted
from netops.services import latest_drift_records

router = APIRouter(prefix="/drift", tags=["drift"])


@router.post(
    "/scan",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run an out-of-schedule drift scan",
)
def start_scan(
    service: JobServiceDep,
    user: Operator,
    request: Annotated[DriftScanRequest | None, Body()] = None,
) -> JobAccepted:
    device_ids = request.device_ids if request is not None else None
    job = service.create_drift_scan(device_ids, requested_by=user.username)
    return JobAccepted(job_id=job.id, status=job.status)


@router.get(
    "/report",
    response_model=list[DriftReportItem],
    summary="Latest drift check of every device",
)
def drift_report(
    session: SessionDep,
    _: Viewer,
    since: datetime | None = None,
    until: datetime | None = None,
    status_filter: Annotated[DriftStatus | None, Query(alias="status")] = None,
) -> list[DriftReportItem]:
    records = latest_drift_records(
        session, since=_as_utc(since), until=_as_utc(until), status=status_filter
    )
    return [
        DriftReportItem(
            device_id=record.device_id,
            hostname=record.device.hostname,
            status=record.status,
            checked_at=record.checked_at,
            job_id=record.job_id,
            unauthorized_lines=record.unauthorized_lines,
            missing_lines=record.missing_lines,
            remediation_patch=record.remediation_config,
            error=record.error,
        )
        for record in records
    ]


def _as_utc(value: datetime | None) -> datetime | None:
    """Timestamps without an offset are interpreted as UTC."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


@router.post(
    "/remediate",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Bring a drifted device back to its golden config",
)
def remediate(
    request: DriftRemediateRequest, service: JobServiceDep, user: Operator
) -> JobAccepted:
    job = service.create_drift_remediation(request.device_id, requested_by=user.username)
    return JobAccepted(job_id=job.id, status=job.status)
