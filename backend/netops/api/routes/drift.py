from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Body, Query, status

from netops.api.deps import JobServiceDep, Operator, SessionDep, Viewer
from netops.enums import DriftStatus
from netops.schemas.drift import DriftRemediateRequest, DriftReportItem, DriftScanRequest
from netops.schemas.jobs import JobAccepted
from netops.services.drift import classify_drift_lines, latest_drift_records

router = APIRouter(prefix="/drift", tags=["drift"])


@router.post(
    "/scan",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Внеочередной скан дрейфа",
)
def start_scan(
    service: JobServiceDep,
    user: Operator,
    request: Annotated[DriftScanRequest | None, Body()] = None,
) -> JobAccepted:
    device_ids = request.device_ids if request is not None else None
    fabric_id = request.fabric_id if request is not None else None
    site = request.site if request is not None else None
    job = service.create_drift_scan(
        device_ids, fabric_id=fabric_id, site=site, requested_by=user.username
    )
    return JobAccepted(job_id=job.id, status=job.status)


@router.get(
    "/report",
    response_model=list[DriftReportItem],
    summary="Последняя проверка дрейфа по каждому устройству",
)
def drift_report(
    session: SessionDep,
    _: Viewer,
    since: datetime | None = None,
    until: datetime | None = None,
    status_filter: Annotated[DriftStatus | None, Query(alias="status")] = None,
    fabric_id: Annotated[str | None, Query(description="Фильтр по стенду/фабрике")] = None,
    site: Annotated[str | None, Query(description="Фильтр по площадке/стенду")] = None,
) -> list[DriftReportItem]:
    records = latest_drift_records(
        session,
        since=_as_utc(since),
        until=_as_utc(until),
        status=status_filter,
        fabric_id=fabric_id,
        site=site,
    )
    items = []
    for record in records:
        all_lines = (record.unauthorized_lines or []) + (record.missing_lines or [])
        safe, risky, risk_level = classify_drift_lines(all_lines)
        items.append(
            DriftReportItem(
                device_id=record.device_id,
                hostname=record.device.hostname,
                fabric_id=getattr(record.device, "fabric_id", "croc-dc1-pod1"),
                site=getattr(record.device, "site", None),
                status=record.status,
                checked_at=record.checked_at,
                job_id=record.job_id,
                unauthorized_lines=record.unauthorized_lines,
                missing_lines=record.missing_lines,
                remediation_patch=record.remediation_config,
                error=record.error,
                safe_lines=safe,
                risky_lines=risky,
                risk_level=risk_level,
            )
        )
    return items


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


@router.post(
    "/remediate",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Устранить дрейф: вернуть устройство к эталону",
)
def remediate(
    request: DriftRemediateRequest, service: JobServiceDep, user: Operator
) -> JobAccepted:
    job = service.create_drift_remediation(request.device_id, requested_by=user.username)
    return JobAccepted(job_id=job.id, status=job.status)
