from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Sequence
from typing import Protocol

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, selectinload

from netops.enums import DeviceStatus, IntentSource, JobStatus, JobType
from netops.errors import ConflictError, NotFoundError, ServiceUnavailableError
from netops.models import Device, Job, JobLog, JobTarget
from netops.pipeline.recorder import JobRecorder

logger = logging.getLogger(__name__)

SCHEDULER_USER = "scheduler"
_ACTIVE_STATUSES = (JobStatus.PENDING, JobStatus.RUNNING)
_CHANGING_TYPES = tuple(job_type for job_type in JobType if job_type.changes_devices)


class JobDispatcher(Protocol):
    def dispatch(self, job_id: uuid.UUID) -> None: ...


class JobService:
    def __init__(self, session: Session, dispatcher: JobDispatcher) -> None:
        self._session = session
        self._dispatcher = dispatcher

    def get(self, job_id: uuid.UUID) -> Job:
        job = self._session.scalar(
            select(Job)
            .where(Job.id == job_id)
            .options(selectinload(Job.targets), selectinload(Job.logs))
        )
        if job is None:
            raise NotFoundError(f"Job {job_id} not found")
        return job

    def logs(self, job_id: uuid.UUID, *, after_id: int = 0, limit: int = 500) -> Sequence[JobLog]:
        if self._session.get(Job, job_id) is None:
            raise NotFoundError(f"Job {job_id} not found")
        return self._session.scalars(
            select(JobLog)
            .where(JobLog.job_id == job_id, JobLog.id > after_id)
            .order_by(JobLog.id)
            .limit(limit)
        ).all()

    def get_with_diff(self, job_id: uuid.UUID) -> Job:
        job = self._session.scalar(
            select(Job)
            .where(Job.id == job_id)
            .options(
                selectinload(Job.targets).selectinload(JobTarget.running_snapshot),
                selectinload(Job.targets).selectinload(JobTarget.intended_snapshot),
            )
        )
        if job is None:
            raise NotFoundError(f"Job {job_id} not found")
        if not job.status.is_terminal:
            raise ConflictError(f"Job {job_id} is {job.status}; the diff is not ready yet")
        return job

    def list_jobs(
        self,
        *,
        job_type: JobType | None = None,
        status: JobStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Sequence[Job]:
        query = select(Job).order_by(Job.created_at.desc()).limit(limit).offset(offset)
        if job_type is not None:
            query = query.where(Job.type == job_type)
        if status is not None:
            query = query.where(Job.status == status)
        return self._session.scalars(query).all()

    def has_active(self, job_type: JobType) -> bool:
        return bool(
            self._session.scalar(
                select(exists().where(Job.type == job_type, Job.status.in_(_ACTIVE_STATUSES)))
            )
        )

    def create_dry_run(
        self, device_ids: Sequence[int], intent_source: IntentSource, *, requested_by: str
    ) -> Job:
        devices = self._devices(device_ids)
        job = Job(type=JobType.DRY_RUN, intent_source=intent_source.value, created_by=requested_by)
        job.targets = _targets_for(devices)
        return self._submit(job)

    def create_deploy(self, dry_run_id: uuid.UUID, *, confirmed_by: str, requested_by: str) -> Job:
        parent = self.get(dry_run_id)
        if parent.type is not JobType.DRY_RUN:
            raise ConflictError(f"Job {dry_run_id} is a {parent.type} job, not a dry-run")
        if parent.status is not JobStatus.SUCCESS:
            raise ConflictError(
                f"Dry-run {dry_run_id} is {parent.status}; only successful dry-runs can be deployed"
            )
        previous = self._session.scalar(
            select(Job).where(
                Job.parent_job_id == parent.id,
                Job.type == JobType.DEPLOY,
                Job.status != JobStatus.FAILED,
            )
        )
        if previous is not None:
            raise ConflictError(f"Dry-run {dry_run_id} is already deployed by job {previous.id}")

        changed = [target for target in parent.targets if target.has_changes]
        if not changed:
            raise ConflictError(f"Dry-run {dry_run_id} has no changes to deploy")
        orphaned = [target.hostname for target in changed if target.device_id is None]
        if orphaned:
            raise ConflictError(f"Devices were deleted after the dry-run: {', '.join(orphaned)}")
        self._ensure_idle(target.device_id for target in changed if target.device_id is not None)

        job = Job(
            type=JobType.DEPLOY,
            parent_job_id=parent.id,
            intent_source=parent.intent_source,
            created_by=requested_by,
            confirmed_by=confirmed_by,
        )
        job.targets = [
            JobTarget(
                device_id=target.device_id,
                hostname=target.hostname,
                running_snapshot_id=target.running_snapshot_id,
                intended_snapshot_id=target.intended_snapshot_id,
                remediation_config=target.remediation_config,
                rollback_config=target.rollback_config,
                health_expectations=target.health_expectations,
            )
            for target in changed
        ]
        return self._submit(job)

    def create_drift_scan(self, device_ids: Sequence[int] | None, *, requested_by: str) -> Job:
        if device_ids:
            devices = self._devices(device_ids)
        else:
            devices = list(self._session.scalars(select(Device).order_by(Device.hostname)))
        if not devices:
            raise ConflictError("There are no devices to scan")
        job = Job(
            type=JobType.DRIFT_SCAN,
            intent_source=IntentSource.GIT_MAIN.value,
            created_by=requested_by,
        )
        job.targets = _targets_for(devices)
        return self._submit(job)

    def create_drift_remediation(self, device_id: int, *, requested_by: str) -> Job:
        [device] = self._devices([device_id])
        if device.status is not DeviceStatus.DRIFT_DETECTED:
            raise ConflictError(
                f"Device {device.hostname} is {device.status}; "
                "only drifted devices can be remediated"
            )
        self._ensure_idle([device.id])
        job = Job(
            type=JobType.DRIFT_REMEDIATE,
            intent_source=IntentSource.GIT_MAIN.value,
            created_by=requested_by,
            confirmed_by=requested_by,
        )
        job.targets = _targets_for([device])
        return self._submit(job)

    # Плановый скан из Celery Beat пропускаем, пока идёт предыдущий.
    def schedule_drift_scan(self) -> Job | None:
        if self.has_active(JobType.DRIFT_SCAN):
            logger.info("Skipping scheduled drift scan: a scan is already in progress")
            return None
        try:
            return self.create_drift_scan(None, requested_by=SCHEDULER_USER)
        except ConflictError as exc:
            logger.info("Skipping scheduled drift scan: %s", exc)
            return None

    def _devices(self, device_ids: Iterable[int]) -> list[Device]:
        ids = list(dict.fromkeys(device_ids))
        found = {
            device.id: device
            for device in self._session.scalars(select(Device).where(Device.id.in_(ids)))
        }
        missing = [device_id for device_id in ids if device_id not in found]
        if missing:
            raise NotFoundError(f"Unknown device id(s): {', '.join(map(str, missing))}")
        return [found[device_id] for device_id in ids]

    def _ensure_idle(self, device_ids: Iterable[int]) -> None:
        ids = list(device_ids)
        busy = self._session.execute(
            select(JobTarget.hostname, Job.id)
            .join(Job)
            .where(
                JobTarget.device_id.in_(ids),
                Job.type.in_(_CHANGING_TYPES),
                Job.status.in_(_ACTIVE_STATUSES),
            )
        ).all()
        if busy:
            details = ", ".join(f"{hostname} (job {job_id})" for hostname, job_id in busy)
            raise ConflictError(f"A change is already in progress for: {details}")

    def _submit(self, job: Job) -> Job:
        self._session.add(job)
        self._session.commit()
        try:
            self._dispatcher.dispatch(job.id)
        except Exception as exc:
            logger.exception("Cannot enqueue job %s", job.id)
            JobRecorder(self._session, job).fail(f"Could not enqueue the job: {exc}")
            raise ServiceUnavailableError(
                "The task queue is unavailable; the job was marked as FAILED"
            ) from exc
        return job


def _targets_for(devices: Iterable[Device]) -> list[JobTarget]:
    return [JobTarget(device_id=device.id, hostname=device.hostname) for device in devices]
