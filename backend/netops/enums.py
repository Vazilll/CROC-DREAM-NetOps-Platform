"""Enumerations shared by the database, the API and the network pipeline."""

from __future__ import annotations

from enum import StrEnum


class Platform(StrEnum):
    """Network operating system of a device."""

    CISCO_IOSXE = "cisco_iosxe"
    ARISTA_EOS = "arista_eos"
    HUAWEI_VRP = "huawei_vrp"


class DeviceRole(StrEnum):
    """Functional role of a device in the CLOS fabric."""

    SPINE = "spine"
    LEAF = "leaf"
    BORDER = "border"


class DeviceStatus(StrEnum):
    """Compliance status of a device.

    ``UNKNOWN`` is not part of the original spec: it marks devices that have
    never been checked, or whose state could not be determined after a failed
    rollback, so that the UI never shows a misleading ``IN_SYNC``.
    """

    UNKNOWN = "UNKNOWN"
    IN_SYNC = "IN_SYNC"
    DRIFT_DETECTED = "DRIFT_DETECTED"
    UNREACHABLE = "UNREACHABLE"
    IN_PROGRESS = "IN_PROGRESS"


class DriftStatus(StrEnum):
    """Outcome of a drift check of a single device."""

    IN_SYNC = "IN_SYNC"
    DRIFT_DETECTED = "DRIFT_DETECTED"
    UNREACHABLE = "UNREACHABLE"


class JobType(StrEnum):
    DRY_RUN = "DRY_RUN"
    DEPLOY = "DEPLOY"
    DRIFT_SCAN = "DRIFT_SCAN"
    DRIFT_REMEDIATE = "DRIFT_REMEDIATE"

    @property
    def changes_devices(self) -> bool:
        """Whether jobs of this type push configuration to devices."""
        return self in {JobType.DEPLOY, JobType.DRIFT_REMEDIATE}


class JobStatus(StrEnum):
    """Lifecycle of a job: ``PENDING → RUNNING → SUCCESS / FAILED``."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"

    @property
    def is_terminal(self) -> bool:
        return self in {JobStatus.SUCCESS, JobStatus.FAILED}


class TargetStatus(StrEnum):
    """Outcome of a job for a single device."""

    PENDING = "PENDING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    ROLLED_BACK = "ROLLED_BACK"

    @property
    def is_failure(self) -> bool:
        return self in {TargetStatus.FAILED, TargetStatus.ROLLED_BACK}


class SnapshotKind(StrEnum):
    RUNNING = "RUNNING"
    INTENDED = "INTENDED"


class LogLevel(StrEnum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class IntentSource(StrEnum):
    """Where the intended state is read from. Only the main Git branch for the MVP."""

    GIT_MAIN = "git_main"


class UserRole(StrEnum):
    """RBAC roles, from the least to the most privileged."""

    VIEWER = "viewer"
    OPERATOR = "operator"
    ADMIN = "admin"

    @property
    def rank(self) -> int:
        return _ROLE_RANK[self]

    def grants(self, required: UserRole) -> bool:
        """Whether this role includes the privileges of ``required``."""
        return self.rank >= required.rank


_ROLE_RANK = {UserRole.VIEWER: 0, UserRole.OPERATOR: 1, UserRole.ADMIN: 2}
