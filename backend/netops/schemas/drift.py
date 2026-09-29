from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from netops.enums import DriftStatus


class DriftScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_ids: list[int] | None = Field(
        default=None, min_length=1, description="Devices to scan; all devices when omitted"
    )


class DriftRemediateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: int


class DriftReportItem(BaseModel):
    device_id: int
    hostname: str
    status: DriftStatus
    checked_at: datetime
    job_id: uuid.UUID | None
    unauthorized_lines: list[str]
    missing_lines: list[str]
    remediation_patch: str | None
    error: str | None
