from fastapi import APIRouter

from netops.api.routes import devices, drift, jobs, system

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(system.api_router)
api_v1.include_router(devices.router)
api_v1.include_router(jobs.router)
api_v1.include_router(drift.router)

__all__ = ["api_v1"]
