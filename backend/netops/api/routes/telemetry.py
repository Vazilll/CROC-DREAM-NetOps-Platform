"""Telemetry API router for heterogeneous multi-fabric telemetry and port resolution."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from netops.api.deps import ContainerDep, DeviceServiceDep, Operator, SessionDep, Viewer
from netops.services.telemetry import (
    METRICS,
    STEP_SECONDS,
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
    user: Viewer,
    service: DeviceServiceDep,
    metric: Annotated[str, Query(description="Metric name")] = "cpu_pct",
    points: Annotated[int, Query(ge=1, le=288)] = 24,
    role: Annotated[str, Query(description="Device role")] = "leaf",
) -> TelemetrySeriesResponse:
    from netops.api.routes.devices import assert_device_allowed

    if metric not in METRICS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric '{metric}'. Supported: {list(METRICS.keys())}",
        )
    device = service.get_by_hostname(hostname)
    if device is not None:
        assert_device_allowed(device, user.allowed_system)
    data = metric_series(hostname, role, metric, points=points)
    spec = METRICS[metric]
    return TelemetrySeriesResponse(
        hostname=hostname,
        metric=metric,
        points=data,
        unit=spec.unit,
        threshold=spec.threshold,
    )


@router.get(
    "/stand-series",
    summary="Batch telemetry time-series (CPU, RAM, Uplink) for all devices in a stand/fabric",
)
def get_stand_telemetry_series(
    service: DeviceServiceDep,
    user: Viewer,
    fabric_id: Annotated[str | None, Query(description="Filter by stand/fabric")] = None,
    points: Annotated[int, Query(ge=4, le=120)] = 24,
) -> dict[str, Any]:
    from netops.api.routes.devices import _iter_allowed_tokens, assert_stand_allowed

    if fabric_id:
        assert_stand_allowed(fabric_id, fabric_id, user.allowed_system)
    devices = service.list_devices(
        limit=5000,
        fabric_id=fabric_id,
        allowed_tokens=_iter_allowed_tokens(user.allowed_system),
    )
    out: dict[str, dict[str, Any]] = {}
    for dev in devices:
        role_str = str(getattr(dev.role, "value", dev.role))
        plat_str = str(getattr(dev.platform, "value", dev.platform))
        out[dev.hostname] = {
            "hostname": dev.hostname,
            "role": role_str,
            "platform": plat_str,
            "fabric_id": dev.fabric_id or "default",
            "cpu_pct": metric_series(dev.hostname, role_str, "cpu_pct", points=points),
            "memory_pct": metric_series(dev.hostname, role_str, "memory_pct", points=points),
            "uplink_util_pct": metric_series(
                dev.hostname, role_str, "uplink_util_pct", points=points
            ),
        }
    return {"step_seconds": STEP_SECONDS, "devices": out}


@router.get(
    "/summary",
    response_model=TelemetrySummaryResponse,
    summary="Overview of telemetry collection status across fabrics",
)
def get_telemetry_summary(
    service: DeviceServiceDep,
    user: Viewer,
) -> TelemetrySummaryResponse:
    from netops.api.routes.devices import _iter_allowed_tokens

    devices = service.list_devices(
        limit=5000, allowed_tokens=_iter_allowed_tokens(user.allowed_system)
    )
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
    user: Viewer,
    include_fabric_label: Annotated[bool, Query()] = True,
    fabric_id: Annotated[str | None, Query(description="Filter by stand/fabric")] = None,
) -> dict[str, Any]:
    from netops.api.routes.devices import _iter_allowed_tokens, assert_stand_allowed

    if fabric_id:
        assert_stand_allowed(fabric_id, fabric_id, user.allowed_system)
    tokens = _iter_allowed_tokens(user.allowed_system)
    target_fabric = fabric_id
    if not target_fabric and len(tokens) == 1:
        target_fabric = tokens[0][1]
    toolchain = build_toolchain(container.settings)
    ttl = container.settings.metrics_interval_seconds * 3
    if target_fabric:
        dev_samples = collector.device_samples(
            session,
            toolchain,
            max_workers=16,
            include_fabric_label=include_fabric_label,
            fabric_id=target_fabric,
        )
        collector.publish(
            dev_samples, ttl_seconds=ttl, merge=True, merge_fabric=target_fabric
        )
        samples = collector.platform_samples(session) + dev_samples
    else:
        samples = collector.collect(
            session,
            toolchain=toolchain,
            include_fabric_label=include_fabric_label,
            max_workers=16,
        )
        collector.publish(samples, ttl_seconds=ttl)
    return {
        "status": "ok",
        "samples_collected": len(samples),
        "metric_names": sorted({s.name for s in samples}),
    }


class CollectorOverrideRequest(BaseModel):
    protocol: str


@router.get(
    "/collectors",
    summary="Last protocol plan: which devices stream via gNMI / SNMP / exporter or stay on SSH",
)
def get_collector_plan(service: DeviceServiceDep, user: Viewer) -> dict[str, Any]:
    from netops.api.routes.devices import _iter_allowed_tokens

    tokens = _iter_allowed_tokens(user.allowed_system)
    plan = targets.last_collector_plan()
    overrides = targets.get_protocol_overrides()
    if plan and plan.get("devices"):
        if tokens:
            allowed_hosts = {
                d.hostname
                for d in service.list_devices(limit=5000, allowed_tokens=tokens)
            }
            filtered_devs = {
                h: v for h, v in plan["devices"].items() if h in allowed_hosts
            }
            return {**plan, "devices": filtered_devs, "overrides": overrides}
        return {**plan, "overrides": overrides}
    # Build immediate baseline from DB devices if background refresh hasn't run yet
    devices_map: dict[str, Any] = {}
    for d in service.list_devices(limit=5000, allowed_tokens=tokens):
        plat = str(getattr(d.platform, "value", d.platform))
        ports = resolve_device_ports(str(d.management_ip), management_port=d.management_port, platform=plat)
        override = overrides.get(d.hostname)
        active_proto = override if (override and override != "auto") else "ssh_cli"
        devices_map[d.hostname] = {
            "protocol": active_proto,
            "selected_mode": override or "auto",
            "port": ports.get(active_proto if active_proto != "prometheus_exporter" else "exporter", d.management_port),
            "host": str(d.management_ip),
            "platform": plat,
            "fabric_id": d.fabric_id or "default",
            "verified_by": f"manual_override:{override}" if override else "ssh_cli_profile",
            "supported_protocols": {
                "gnmi": {"supported": False, "port": ports.get("gnmi", 6030), "verified_by": None},
                "snmp": {"supported": False, "port": ports.get("snmp", 161), "verified_by": None},
                "prometheus_exporter": {"supported": False, "port": ports.get("exporter", 9100), "verified_by": None},
                "ssh_cli": {"supported": True, "port": ports.get("ssh", d.management_port), "verified_by": "ssh_cli_profile"},
            },
        }
    return {"refreshed_at": None, "protocols": {}, "devices": devices_map, "overrides": overrides}


@router.put(
    "/collectors/{hostname}",
    summary="Select telemetry collection protocol for a device (auto, gnmi, snmp, prometheus_exporter, ssh_cli)",
)
def set_collector_protocol(
    hostname: str,
    body: CollectorOverrideRequest,
    session: SessionDep,
    container: ContainerDep,
    _: Operator,
) -> dict[str, Any]:
    allowed = {"auto", "gnmi", "snmp", "prometheus_exporter", "node_exporter", "ssh_cli"}
    proto = body.protocol.strip().lower()
    if proto not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported protocol '{body.protocol}'. Allowed: {sorted(allowed)}",
        )
    return targets.set_device_protocol_override(
        session, build_toolchain(container.settings), container.settings, hostname, proto
    )


@router.post(
    "/collectors/refresh",
    status_code=202,
    summary="Re-probe every device and rewrite gnmic / snmp-exporter / node_exporter targets",
)
def refresh_collector_plan(
    container: ContainerDep, background: BackgroundTasks, _: Operator
) -> dict[str, str]:
    # Фоновый опрос всех устройств фабрики: отвечаем сразу, результат смотреть в GET.
    def _run() -> None:
        with container.session_factory() as session:
            targets.refresh_collector_targets(
                session, build_toolchain(container.settings), container.settings
            )

    background.add_task(_run)
    return {"status": "scheduled"}


@router.get(
    "/sd/snmp",
    summary="Prometheus HTTP Service Discovery for SNMP targets stored in PostgreSQL",
)
def get_snmp_http_sd() -> list[dict[str, Any]]:
    return targets.get_snmp_sd_targets()


@router.get(
    "/sd/exporter",
    summary="Prometheus HTTP Service Discovery for Node Exporter targets stored in PostgreSQL",
)
def get_exporter_http_sd() -> list[dict[str, Any]]:
    return list(targets.get_exporter_sd_targets())


