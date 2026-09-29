from __future__ import annotations

from datetime import datetime
from ipaddress import IPv4Address

from pydantic import BaseModel, ConfigDict, Field, model_validator

from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.intent.models import DeviceIntent, Hostname, Identifier
from netops.schemas.intent import IntentIssueRead


class DeviceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hostname: Hostname = Field(examples=["leaf-1.croc.lab"])
    management_ip: IPv4Address = Field(examples=["172.20.20.11"])
    management_port: int = Field(default=22, ge=1, le=65535)
    platform: Platform
    role: DeviceRole
    auth_profile: Identifier = Field(examples=["lab"])


class DeviceUpdate(BaseModel):
    """Partial update; omitted fields keep their values."""

    model_config = ConfigDict(extra="forbid")

    hostname: Hostname | None = None
    management_ip: IPv4Address | None = None
    management_port: int | None = Field(default=None, ge=1, le=65535)
    platform: Platform | None = None
    role: DeviceRole | None = None
    auth_profile: Identifier | None = None

    @model_validator(mode="after")
    def _reject_nulls(self) -> DeviceUpdate:
        nulls = sorted(name for name in self.model_fields_set if getattr(self, name) is None)
        if nulls:
            raise ValueError(f"Fields cannot be null: {', '.join(nulls)}")
        return self


class DeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hostname: str
    management_ip: str
    management_port: int
    platform: Platform
    role: DeviceRole
    auth_profile: str
    status: DeviceStatus
    last_checked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DeviceDetail(DeviceRead):
    """Device card: inventory data plus the network parameters from Git."""

    intent: DeviceIntent | None = None
    intent_issues: list[IntentIssueRead] = Field(default_factory=list)


class InventorySyncResult(BaseModel):
    created: list[str] = Field(default_factory=list)
    updated: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
