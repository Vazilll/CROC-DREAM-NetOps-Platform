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
    management_mode: Literal["MONITORING_ONLY", "MANAGED"] = "MONITORING_ONLY"
    proxy_jump: str | None = None
    hardware_specs: str | None = None


class DeviceUpdate(PartialUpdate):
    hostname: Hostname | None = None
    management_ip: IPv4Address | None = None
    management_port: int | None = Field(default=None, ge=1, le=65535)
    platform: Platform | None = None
    role: DeviceRole | None = None
    auth_profile: Identifier | None = None
    management_mode: Literal["MONITORING_ONLY", "MANAGED"] | None = None
    proxy_jump: str | None = None
    hardware_specs: str | None = None


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
    management_mode: str = "MONITORING_ONLY"
    proxy_jump: str | None = None
    hardware_specs: str | None = None
    oper_status: Literal["UP", "DOWN", "DEGRADED"] = "UP"
    sparkline: list[float] = Field(default_factory=list)
    state_timeline: list[str] = Field(default_factory=list)
    last_checked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DeviceDetail(DeviceRead):
    intent: DeviceIntent | None = None
    intent_issues: list[IntentIssueRead] = Field(default_factory=list)


class DeviceProbeRequest(BaseModel):
    management_ip: str
    management_port: int = 22
    username: str = "root"
    password: str | None = None
    proxy_jump: str | None = None  # e.g. "crocdream@5.228.243.54:221"


class DeviceProbeResult(BaseModel):
    reachable: bool
    detected_platform: Platform
    detected_role: DeviceRole
    hostname: str
    os_version: str | None = None
    cpu_cores: int | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    interfaces: list[str] = Field(default_factory=list)
    lldp_neighbors: list[dict] = Field(default_factory=list)
    message: str


class DeviceEmergencyAction(BaseModel):
    action: Literal["rollback_last_commit", "reset_bgp_sessions", "restart_services", "reboot"]
    force: bool = False
    reason: str = "Emergency manual intervention"


class InventorySyncResult(BaseModel):
    created: list[str] = Field(default_factory=list)
    updated: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
