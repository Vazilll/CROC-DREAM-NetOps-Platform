from __future__ import annotations

from netops.enums import JobStatus


class NetOpsError(Exception):
    pass


class NotFoundError(NetOpsError):
    pass


class ConflictError(NetOpsError):
    pass


class ServiceUnavailableError(NetOpsError):
    pass


class InvalidJobTransitionError(NetOpsError):
    def __init__(self, current: JobStatus, requested: JobStatus) -> None:
        super().__init__(f"Job cannot move from {current} to {requested}")
        self.current = current
        self.requested = requested


class PipelineError(NetOpsError):
    pass
