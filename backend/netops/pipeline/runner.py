"""Entry point of the worker: executes one job through its pipeline."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Mapping
from datetime import timedelta
from types import MappingProxyType

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from netops.db import utcnow
from netops.enums import JobStatus, JobType
from netops.errors import PipelineError
from netops.models import Job
from netops.pipeline.pipelines import (
    DeployPipeline,
    DriftRemediationPipeline,
    DriftScanPipeline,
    DryRunPipeline,
    Pipeline,
)
from netops.pipeline.recorder import JobRecorder
from netops.toolchain import Toolchain

logger = logging.getLogger(__name__)

PIPELINES: Mapping[JobType, type[Pipeline]] = MappingProxyType(
    {
        JobType.DRY_RUN: DryRunPipeline,
        JobType.DEPLOY: DeployPipeline,
        JobType.DRIFT_SCAN: DriftScanPipeline,
        JobType.DRIFT_REMEDIATE: DriftRemediationPipeline,
    }
)


class JobRunner:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        toolchain_factory: Callable[[], Toolchain],
    ) -> None:
        self._session_factory = session_factory
        self._toolchain_factory = toolchain_factory

    def run(self, job_id: uuid.UUID) -> JobStatus | None:
        """Run a PENDING job to completion and return its final status.

        Jobs in any other state are left untouched, which makes redelivered
        Celery messages harmless.
        """
        with self._session_factory() as session:
            # The row lock serializes concurrent deliveries of the same message.
            job = session.get(Job, job_id, with_for_update=True)
            if job is None:
                logger.warning("Job %s does not exist", job_id)
                return None
            if job.status is not JobStatus.PENDING:
                logger.info("Job %s is already %s; skipping", job_id, job.status)
                return job.status

            recorder = JobRecorder(session, job)
            recorder.start()
            try:
                pipeline = PIPELINES[job.type](session, self._toolchain_factory(), recorder)
                pipeline.run(job)
            except PipelineError as exc:
                session.rollback()
                recorder.fail(str(exc))
            except Exception as exc:
                logger.exception("Job %s crashed", job_id)
                session.rollback()
                recorder.fail(f"Internal error: {type(exc).__name__}: {exc}")
            else:
                recorder.finish()
            return job.status


def fail_stale_jobs(session: Session, *, timeout: timedelta) -> list[uuid.UUID]:
    """Fail jobs whose worker died or whose message was lost by the broker."""
    cutoff = utcnow() - timeout
    stale = session.scalars(
        select(Job).where(
            or_(
                (Job.status == JobStatus.RUNNING) & (Job.started_at < cutoff),
                (Job.status == JobStatus.PENDING) & (Job.created_at < cutoff),
            )
        )
    ).all()
    for job in stale:
        JobRecorder(session, job).fail(
            f"Job did not finish within {int(timeout.total_seconds())}s and was abandoned"
        )
    return [job.id for job in stale]
