from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from netops.enums import IntentSource, JobStatus, JobType, LogLevel, TargetStatus


class DryRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_ids: list[int] = Field(min_length=1, max_length=500, examples=[[1, 2]])
    intent_source: IntentSource = IntentSource.GIT_MAIN


class DeployRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: uuid.UUID = Field(description="Успешный dry-run, который нужно применить")
    confirmed_by: str = Field(min_length=1, max_length=64, examples=["operator_name"])


class JobAccepted(BaseModel):
    job_id: uuid.UUID
    status: JobStatus


class JobTargetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    device_id: int | None
    hostname: str
    status: TargetStatus
    error: str | None
    has_changes: bool


class JobLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int = Field(
        description="Растёт монотонно; передайте как after_id, чтобы получить только новые строки"
    )
    created_at: datetime
    level: LogLevel
    step: str
    hostname: str | None
    message: str


class JobSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: JobType
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    intent_source: str | None
    parent_job_id: uuid.UUID | None
    created_by: str
    confirmed_by: str | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobRead(JobSummary):
    targets: list[JobTargetRead]
    logs: list[JobLogRead]


class DeviceDiffRead(BaseModel):
    device_id: int | None
    hostname: str
    status: TargetStatus
    error: str | None
    running_config: str | None
    intended_config: str | None
    remediation_patch: str | None
    rollback_patch: str | None


class JobDiffRead(BaseModel):
    job_id: uuid.UUID
    job_type: JobType
    devices: list[DeviceDiffRead]
