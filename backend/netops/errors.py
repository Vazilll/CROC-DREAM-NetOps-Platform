"""Domain errors. The API layer maps them onto HTTP status codes."""

from __future__ import annotations

from netops.enums import JobStatus


class NetOpsError(Exception):
    """Base class for all expected (non-bug) errors of the platform."""


class NotFoundError(NetOpsError):
    """A requested entity does not exist."""


class ConflictError(NetOpsError):
    """The request contradicts the current state of the system."""


class ServiceUnavailableError(NetOpsError):
    """A dependency (message broker, database, ...) is unavailable."""


class InvalidJobTransitionError(NetOpsError):
    def __init__(self, current: JobStatus, requested: JobStatus) -> None:
        super().__init__(f"Job cannot move from {current} to {requested}")
        self.current = current
        self.requested = requested


class PipelineError(NetOpsError):
    """A pipeline stage failed in an expected way; the job is marked FAILED."""
