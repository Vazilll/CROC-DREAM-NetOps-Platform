"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from netops.models.device import Device
from netops.models.drift import DriftRecord
from netops.models.job import ALLOWED_TRANSITIONS, Job, JobLog, JobTarget
from netops.models.snapshot import ConfigSnapshot, sha256_hex
from netops.models.user import User

__all__ = [
    "ALLOWED_TRANSITIONS",
    "ConfigSnapshot",
    "Device",
    "DriftRecord",
    "Job",
    "JobLog",
    "JobTarget",
    "User",
    "sha256_hex",
]
