from fastapi import APIRouter

from netops.api.routes import (
    auth,
    devices,
    drift,
    emergency,
    insights,
    jobs,
    system,
    telemetry,
    users,
)

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(auth.router)
api_v1.include_router(system.api_router)
api_v1.include_router(devices.router)
api_v1.include_router(jobs.router)
api_v1.include_router(drift.router)
api_v1.include_router(users.router)
api_v1.include_router(insights.router)
api_v1.include_router(emergency.router)
api_v1.include_router(telemetry.router)

__all__ = ["api_v1"]
