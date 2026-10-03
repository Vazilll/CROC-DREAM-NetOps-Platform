from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from functools import lru_cache

from sqlalchemy.orm import Session, sessionmaker

from netops.db import build_engine, build_session_factory
from netops.pipeline import JobRunner, fail_stale_jobs
from netops.services import JobDispatcher, JobService
from netops.settings import Settings, get_settings
from netops.toolchain import build_toolchain
from netops.worker.celery_app import (
    FAIL_STALE_JOBS_TASK,
    RUN_JOB_TASK,
    SCHEDULED_DRIFT_SCAN_TASK,
    CeleryJobDispatcher,
    create_celery_app,
)

celery_app = create_celery_app(get_settings())


@dataclass(frozen=True)
class WorkerRuntime:
    settings: Settings
    session_factory: sessionmaker[Session]
    runner: JobRunner
    dispatcher: JobDispatcher


# Создаётся лениво в каждом процессе воркера, уже после fork.
@lru_cache(maxsize=1)
def get_runtime() -> WorkerRuntime:
    settings = get_settings()
    session_factory = build_session_factory(build_engine(settings.database_url))
    return WorkerRuntime(
        settings=settings,
        session_factory=session_factory,
        runner=JobRunner(session_factory, lambda: build_toolchain(settings)),
        dispatcher=CeleryJobDispatcher(celery_app),
    )


@celery_app.task(name=RUN_JOB_TASK)  # type: ignore[untyped-decorator]
def run_job(job_id: str) -> str | None:
    status = get_runtime().runner.run(uuid.UUID(job_id))
    return status.value if status is not None else None


@celery_app.task(name=SCHEDULED_DRIFT_SCAN_TASK)  # type: ignore[untyped-decorator]
def scheduled_drift_scan() -> str | None:
    runtime = get_runtime()
    with runtime.session_factory() as session:
        job = JobService(session, runtime.dispatcher).schedule_drift_scan()
        return str(job.id) if job is not None else None


@celery_app.task(name=FAIL_STALE_JOBS_TASK)  # type: ignore[untyped-decorator]
def fail_stale() -> list[str]:
    runtime = get_runtime()
    with runtime.session_factory() as session:
        failed = fail_stale_jobs(
            session, timeout=timedelta(seconds=runtime.settings.job_timeout_seconds)
        )
        return [str(job_id) for job_id in failed]
