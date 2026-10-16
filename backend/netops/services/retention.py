from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.models import JobLog


# Метрики в PostgreSQL больше не хранятся (их история — в VictoriaMetrics с собственным
# -retentionPeriod), поэтому здесь чистятся только логи задач.
def purge_expired_records(
    session: Session,
    *,
    job_log_retention: timedelta = timedelta(days=14),
    now: datetime | None = None,
) -> dict[str, int]:
    """Purge JobLog rows older than the configured TTL window."""
    job_log_cutoff = (now or utcnow()) - job_log_retention
    job_log_res = session.execute(delete(JobLog).where(JobLog.created_at < job_log_cutoff))
    session.commit()
    return {"job_logs_purged": int(job_log_res.rowcount or 0)}
