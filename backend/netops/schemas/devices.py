from __future__ import annotations

from datetime import datetime
from ipaddress import IPv4Address
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from netops.enums import DeviceRole, DeviceStatus, Platform
from netops.intent.models import DeviceIntent, Hostname, Identifier
from netops.schemas.common import PartialUpdate
from netops.schemas.intent import IntentIssueRead


class DeviceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hostname: Hostname = Field(examples=["leaf-1.croc.lab"])
    management_ip: IPv4Address = Field(examples=["172.20.20.11"])
    management_port: int = Field(default=22, ge=1, le=65535)
    platform: Platform
    role: DeviceRole
    auth_profile: Identifier = Field(examples=["lab"])


class DeviceUpdate(PartialUpdate):
    hostname: Hostname | None = None
    management_ip: IPv4Address | None = None
    management_port: int | None = Field(default=None, ge=1, le=65535)
    platform: Platform | None = None
    role: DeviceRole | None = None
    auth_profile: Identifier | None = None


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
    oper_status: Literal["UP", "DOWN", "DEGRADED"] = "UP"
    sparkline: list[float] = Field(default_factory=list)
    state_timeline: list[str] = Field(default_factory=list)
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
