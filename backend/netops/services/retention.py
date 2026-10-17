from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.enums import JobStatus
from netops.models import ConfigSnapshot, DriftRecord, Job, JobLog, JobTarget


def purge_expired_records(
    session: Session,
    *,
    job_log_retention: timedelta = timedelta(days=14),
    now: datetime | None = None,
) -> dict[str, int]:
    """Purge expired JobLog, DriftRecord, finished Job, and old ConfigSnapshot rows."""
    ref_now = now or utcnow()
    cutoff = ref_now - job_log_retention

    job_log_res = session.execute(delete(JobLog).where(JobLog.created_at < cutoff))
    session.execute(delete(DriftRecord).where(DriftRecord.checked_at < cutoff))
    old_jobs_subq = (
        select(Job.id)
        .where(
            Job.status.in_((JobStatus.SUCCESS, JobStatus.FAILED)),
            Job.finished_at.is_not(None),
            Job.finished_at < cutoff,
        )
        .scalar_subquery()
    )
    session.execute(delete(JobLog).where(JobLog.job_id.in_(old_jobs_subq)))
    session.execute(delete(JobTarget).where(JobTarget.job_id.in_(old_jobs_subq)))
    session.execute(delete(Job).where(Job.id.in_(old_jobs_subq)))

    run_snap_ids = select(JobTarget.running_snapshot_id).where(
        JobTarget.running_snapshot_id.is_not(None)
    )
    int_snap_ids = select(JobTarget.intended_snapshot_id).where(
        JobTarget.intended_snapshot_id.is_not(None)
    )
    session.execute(
        delete(ConfigSnapshot).where(
            ConfigSnapshot.created_at < cutoff,
            ConfigSnapshot.id.not_in(run_snap_ids),
            ConfigSnapshot.id.not_in(int_snap_ids),
        )
    )
    session.commit()
    return {"job_logs_purged": int(job_log_res.rowcount or 0)}

