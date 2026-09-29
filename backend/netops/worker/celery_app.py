"""Celery application: broker settings and the Celery Beat schedule."""

from __future__ import annotations

import uuid

from celery import Celery

from netops.settings import Settings

RUN_JOB_TASK = "netops.jobs.run"
SCHEDULED_DRIFT_SCAN_TASK = "netops.drift.scheduled_scan"
FAIL_STALE_JOBS_TASK = "netops.jobs.fail_stale"

STALE_JOBS_CHECK_INTERVAL_SECONDS = 300


def create_celery_app(settings: Settings) -> Celery:
    app = Celery("netops", broker=settings.redis_url, include=["netops.worker.tasks"])
    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        # Job state lives in PostgreSQL; Celery results are not needed.
        task_ignore_result=True,
        # Network jobs are long: acknowledge after completion, one message at a time.
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        broker_connection_retry_on_startup=True,
        beat_schedule={
            "drift-scan": {
                "task": SCHEDULED_DRIFT_SCAN_TASK,
                "schedule": float(settings.drift_scan_interval_seconds),
            },
            "fail-stale-jobs": {
                "task": FAIL_STALE_JOBS_TASK,
                "schedule": float(STALE_JOBS_CHECK_INTERVAL_SECONDS),
            },
        },
    )
    return app


class CeleryJobDispatcher:
    """Enqueues jobs by task name, so the API never imports worker code."""

    def __init__(self, app: Celery) -> None:
        self._app = app

    def dispatch(self, job_id: uuid.UUID) -> None:
        # Reusing the job id as the task id makes worker logs easy to correlate.
        self._app.send_task(RUN_JOB_TASK, args=[str(job_id)], task_id=str(job_id))
