from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from netops.enums import DeviceStatus, JobStatus, LogLevel, TargetStatus
from netops.models import Job, JobLog

logger = logging.getLogger(__name__)

_PY_LEVELS = {
    LogLevel.INFO: logging.INFO,
    LogLevel.WARNING: logging.WARNING,
    LogLevel.ERROR: logging.ERROR,
}


class JobRecorder:
    def __init__(self, session: Session, job: Job) -> None:
        self._session = session
        self._job = job

    @property
    def job(self) -> Job:
        return self._job

    def info(self, step: str, message: str, *, hostname: str | None = None) -> None:
        self._log(LogLevel.INFO, step, message, hostname)

    def warning(self, step: str, message: str, *, hostname: str | None = None) -> None:
        self._log(LogLevel.WARNING, step, message, hostname)

    def error(self, step: str, message: str, *, hostname: str | None = None) -> None:
        self._log(LogLevel.ERROR, step, message, hostname)

    def progress(self, completed: int, total: int) -> None:
        self._job.progress = min(99, completed * 100 // total) if total else 0
        self._session.commit()

    def start(self) -> None:
        self._job.transition_to(JobStatus.RUNNING)
        self.info("job", f"{self._job.type} job started")

    def finish(self) -> None:
        self._skip_unprocessed_targets("Device was not processed")
        failed = [target.hostname for target in self._job.targets if target.status.is_failure]
        if failed:
            self.fail(
                f"{len(failed)} of {len(self._job.targets)} device(s) failed: {', '.join(failed)}"
            )
            return
        self._job.transition_to(JobStatus.SUCCESS)
        self.info("job", "Job finished successfully")

    def fail(self, error: str) -> None:
        self._skip_unprocessed_targets("Job failed before this device was processed")
        for target in self._job.targets:
            if target.device is not None and target.device.status is DeviceStatus.IN_PROGRESS:
                target.device.status = DeviceStatus.UNKNOWN
        self._job.transition_to(JobStatus.FAILED, error=error)
        self.error("job", error)

    def _skip_unprocessed_targets(self, reason: str) -> None:
        for target in self._job.targets:
            if target.status is TargetStatus.PENDING:
                target.mark(TargetStatus.SKIPPED, reason)

    # Коммитим после каждой строки лога, чтобы UI видел прогресс в реальном времени.
    def _log(self, level: LogLevel, step: str, message: str, hostname: str | None) -> None:
        self._session.add(
            JobLog(job_id=self._job.id, level=level, step=step, message=message, hostname=hostname)
        )
        self._session.commit()
        logger.log(
            _PY_LEVELS[level],
            "job=%s step=%s%s %s",
            self._job.id,
            step,
            f" host={hostname}" if hostname else "",
            message,
        )
