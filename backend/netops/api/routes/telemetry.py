"""Telemetry API router for heterogeneous 1,000-device telemetry and port resolution."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from netops.api.deps import ContainerDep, DeviceServiceDep, Operator, SessionDep, Viewer
from netops.services.telemetry import (
    METRICS,
    metric_series,
    resolve_device_ports,
)
from netops.telemetry import collector, targets
from netops.toolchain import build_toolchain

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


class PortResolutionResponse(BaseModel):
    hostname: str | None = None
    platform: str
    management_ip: str | None = None
    management_port: int
    resolved_ports: dict[str, int]
    is_clab_forwarded: bool


class TelemetrySeriesResponse(BaseModel):
    hostname: str
    metric: str
    points: list[float]
    unit: str
    threshold: float


class TelemetrySummaryResponse(BaseModel):
    active_metrics_count: int
    supported_metrics: list[str]
    devices_monitored: int


@router.get(
    "/ports",
    response_model=PortResolutionResponse,
    summary="Resolve direct and Containerlab forwarded NAT ports for switches and servers",
)
def get_resolved_ports(
    platform: Annotated[str, Query(description="Target platform profile")],
    management_ip: Annotated[str | None, Query(description="Management IP address")] = None,
    management_port: Annotated[
        int, Query(ge=1, le=65535, description="SSH / management port")
    ] = 22,
    hostname: Annotated[str | None, Query(description="Optional device hostname")] = None,
    gnmi_port: Annotated[int | None, Query(ge=1, le=65535)] = None,
    snmp_port: Annotated[int | None, Query(ge=1, le=65535)] = None,
    exporter_port: Annotated[int | None, Query(ge=1, le=65535)] = None,
) -> PortResolutionResponse:
    ports = resolve_device_ports(
        management_ip,
        management_port=management_port,
        platform=platform,
        gnmi_port=gnmi_port,
        snmp_port=snmp_port,
        exporter_port=exporter_port,
    )
    return PortResolutionResponse(
        hostname=hostname,
        platform=platform,
        management_ip=management_ip,
        management_port=management_port,
        resolved_ports=ports,
        is_clab_forwarded=2000 <= management_port <= 2999,
    )


@router.get(
    "/series/{hostname}",
    response_model=TelemetrySeriesResponse,
    summary="Get recent telemetry time-series readings for device and metric",
)
def get_device_telemetry_series(
    hostname: str,
    _: Viewer,
    metric: Annotated[str, Query(description="Metric name")] = "cpu_pct",
    points: Annotated[int, Query(ge=1, le=288)] = 24,
    role: Annotated[str, Query(description="Device role")] = "leaf",
) -> TelemetrySeriesResponse:
    if metric not in METRICS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric '{metric}'. Supported: {list(METRICS.keys())}",
        )
    data = metric_series(hostname, role, metric, points=points, allow_synthetic_offline=True)
    spec = METRICS[metric]
    return TelemetrySeriesResponse(
        hostname=hostname,
        metric=metric,
        points=data,
        unit=spec.unit,
        threshold=spec.threshold,
    )


@router.get(
    "/summary",
    response_model=TelemetrySummaryResponse,
    summary="Overview of telemetry collection status across 1,000-device fabrics",
)
def get_telemetry_summary(
    service: DeviceServiceDep,
    _: Viewer,
) -> TelemetrySummaryResponse:
    devices = service.list_devices(limit=1000)
    return TelemetrySummaryResponse(
        active_metrics_count=len(METRICS),
        supported_metrics=sorted(METRICS.keys()),
        devices_monitored=len(devices),
    )


@router.post(
    "/collect",
    summary="Trigger immediate telemetry collection pass across switches and servers",
)
def trigger_telemetry_collection(
    session: SessionDep,
    container: ContainerDep,
    _: Viewer,
    include_fabric_label: Annotated[bool, Query()] = True,
) -> dict[str, Any]:
    samples = collector.collect(
        session,
        toolchain=build_toolchain(container.settings),
        include_fabric_label=include_fabric_label,
    )
    collector.publish(samples, ttl_seconds=container.settings.metrics_interval_seconds * 3)
    return {
        "status": "ok",
        "samples_collected": len(samples),
        "metric_names": sorted({s.name for s in samples}),
    }


@router.get(
    "/collectors",
    summary="Last protocol plan: which devices stream via gNMI / SNMP / exporter or stay on SSH",
)
def get_collector_plan(_: Viewer) -> dict[str, Any]:
    return targets.last_collector_plan() or {"refreshed_at": None, "protocols": {}, "devices": {}}


@router.post(
    "/collectors/refresh",
    status_code=202,
    summary="Re-probe every device and rewrite gnmic / snmp-exporter / node_exporter targets",
)
def refresh_collector_plan(
    container: ContainerDep, background: BackgroundTasks, _: Operator
) -> dict[str, str]:
    # Проба 1 000 устройств занимает минуты — отвечаем сразу, результат смотреть в GET.
    def _run() -> None:
        with container.session_factory() as session:
            targets.refresh_collector_targets(
                session, build_toolchain(container.settings), container.settings
            )

    background.add_task(_run)
    return {"status": "scheduled"}
