from __future__ import annotations

import uuid

from celery import Celery

from netops.settings import Settings

RUN_JOB_TASK = "netops.jobs.run"
SCHEDULED_DRIFT_SCAN_TASK = "netops.drift.scheduled_scan"
FAIL_STALE_JOBS_TASK = "netops.jobs.fail_stale"
COLLECT_METRICS_TASK = "netops.metrics.collect"
REFRESH_COLLECTOR_TARGETS_TASK = "netops.telemetry.refresh_collector_targets"
PURGE_EXPIRED_RECORDS_TASK = "netops.retention.purge"
GENERATE_REGULAR_REPORT_TASK = "netops.reports.generate_regular"

STALE_JOBS_CHECK_INTERVAL_SECONDS = 300
RETENTION_PURGE_INTERVAL_SECONDS = 86400
REGULAR_REPORT_INTERVAL_SECONDS = 3600


def create_celery_app(settings: Settings) -> Celery:
    app = Celery("netops", broker=settings.redis_url, include=["netops.worker.tasks"])
    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        # Состояние задач хранится в PostgreSQL, результаты Celery не нужны.
        task_ignore_result=True,
        # Сетевые задачи долгие: подтверждаем сообщение после выполнения и берём по одному.
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        broker_connection_retry_on_startup=True,
        task_soft_time_limit=float(settings.job_timeout_seconds),
        task_time_limit=float(settings.job_timeout_seconds + 60),
        beat_schedule={
            "drift-scan": {
                "task": SCHEDULED_DRIFT_SCAN_TASK,
                "schedule": float(settings.drift_scan_interval_seconds),
            },
            "fail-stale-jobs": {
                "task": FAIL_STALE_JOBS_TASK,
                "schedule": float(STALE_JOBS_CHECK_INTERVAL_SECONDS),
            },
            "collect-metrics": {
                "task": COLLECT_METRICS_TASK,
                "schedule": float(settings.metrics_interval_seconds),
            },
            "refresh-collector-targets": {
                "task": REFRESH_COLLECTOR_TARGETS_TASK,
                "schedule": float(settings.collector_targets_interval_seconds),
            },
            "purge-expired-records": {
                "task": PURGE_EXPIRED_RECORDS_TASK,
                "schedule": float(RETENTION_PURGE_INTERVAL_SECONDS),
            },
            "generate-regular-report": {
                "task": GENERATE_REGULAR_REPORT_TASK,
                "schedule": float(REGULAR_REPORT_INTERVAL_SECONDS),
            },
        },
    )
    return app


class CeleryJobDispatcher:
    def __init__(self, app: Celery) -> None:
        self._app = app

    def dispatch(self, job_id: uuid.UUID) -> None:
        self._app.send_task(RUN_JOB_TASK, args=[str(job_id)], task_id=str(job_id))
