from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import TYPE_CHECKING, Final

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from netops.db import Base, enum_type, utcnow
from netops.enums import JobStatus, JobType, LogLevel, TargetStatus
from netops.errors import InvalidJobTransitionError

if TYPE_CHECKING:
    from netops.models.device import Device
    from netops.models.snapshot import ConfigSnapshot

ALLOWED_TRANSITIONS: Final[Mapping[JobStatus, frozenset[JobStatus]]] = {
    JobStatus.PENDING: frozenset({JobStatus.RUNNING, JobStatus.FAILED}),
    JobStatus.RUNNING: frozenset({JobStatus.SUCCESS, JobStatus.FAILED}),
    JobStatus.SUCCESS: frozenset(),
    JobStatus.FAILED: frozenset(),
}


class Job(Base):
    """A background operation (dry-run, deploy, drift scan or remediation)."""

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    type: Mapped[JobType] = mapped_column(enum_type(JobType), index=True)
    status: Mapped[JobStatus] = mapped_column(
        enum_type(JobStatus), default=JobStatus.PENDING, index=True
    )
    progress: Mapped[int] = mapped_column(default=0)
    intent_source: Mapped[str | None] = mapped_column(String(64))
    parent_job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), index=True
    )
    created_by: Mapped[str] = mapped_column(String(64))
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]

    parent: Mapped[Job | None] = relationship(remote_side=lambda: [Job.id])
    targets: Mapped[list[JobTarget]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobTarget.id"
    )
    logs: Mapped[list[JobLog]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobLog.id"
    )

    def transition_to(self, status: JobStatus, *, error: str | None = None) -> None:
        """Move the job through its state machine, stamping lifecycle timestamps."""
        if status not in ALLOWED_TRANSITIONS[self.status]:
            raise InvalidJobTransitionError(self.status, status)
        now = utcnow()
        self.status = status
        if status is JobStatus.RUNNING:
            self.started_at = now
        if status.is_terminal:
            self.finished_at = now
        if status is JobStatus.SUCCESS:
            self.progress = 100
        if status is JobStatus.FAILED:
            self.error = error

    def __repr__(self) -> str:
        return f"<Job id={self.id} type={self.type} status={self.status}>"


class JobTarget(Base):
    """Per-device state and results of a job.

    ``hostname`` is denormalized so that the job history survives device deletion.
    """

    __tablename__ = "job_targets"
    __table_args__ = (UniqueConstraint("job_id", "hostname"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), index=True
    )
    hostname: Mapped[str] = mapped_column(String(253))
    status: Mapped[TargetStatus] = mapped_column(
        enum_type(TargetStatus), default=TargetStatus.PENDING
    )
    error: Mapped[str | None] = mapped_column(Text)
    running_snapshot_id: Mapped[int | None] = mapped_column(
        ForeignKey("config_snapshots.id", ondelete="SET NULL")
    )
    intended_snapshot_id: Mapped[int | None] = mapped_column(
        ForeignKey("config_snapshots.id", ondelete="SET NULL")
    )
    remediation_config: Mapped[str | None] = mapped_column(Text)
    rollback_config: Mapped[str | None] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="targets")
    device: Mapped[Device | None] = relationship()
    running_snapshot: Mapped[ConfigSnapshot | None] = relationship(
        foreign_keys=[running_snapshot_id]
    )
    intended_snapshot: Mapped[ConfigSnapshot | None] = relationship(
        foreign_keys=[intended_snapshot_id]
    )

    @property
    def has_changes(self) -> bool:
        return bool(self.remediation_config and self.remediation_config.strip())

    def mark(self, status: TargetStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error


class JobLog(Base):
    """A single step log line of a job, shown to the operator in real time."""

    __tablename__ = "job_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    level: Mapped[LogLevel] = mapped_column(enum_type(LogLevel), default=LogLevel.INFO)
    step: Mapped[str] = mapped_column(String(64))
    hostname: Mapped[str | None] = mapped_column(String(253))
    message: Mapped[str] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="logs")
