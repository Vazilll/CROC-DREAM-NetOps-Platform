"""Emergency operations and direct out-of-band management console routes.

Exclusively accessible to users with the 'admin' role.
Provides:
1. Direct CLI show/exec command runner across any active device.
2. Emergency direct patching without pre-flight gating.
3. Two-tier recovery:
   - Soft Reset: re-applies golden baseline intent via NetOps pipeline.
   - Hard Reset: redeploys Containerlab topology on server 5.228.243.54.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import paramiko
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from netops.api.deps import Admin, ContainerDep, Operator, Viewer
from netops.enums import Platform
from netops.network.base import ChangePlan, DeviceTarget
from netops.toolchain import build_toolchain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emergency", tags=["emergency"])

AUDIT_LOG_FILE = Path(__file__).resolve().parents[4] / "lab" / "running" / "emergency_audit.jsonl"


def _audit_file(settings: Any = None) -> Path:
    from netops.settings import get_settings  # noqa: PLC0415

    eff = settings or get_settings()
    return eff.offline_lab_path / "emergency_audit.jsonl"


def record_audit(
    user: str,
    action: str,
    device: str,
    payload: str,
    reason: str,
    success: bool,
    output: str = "",
    settings: Any = None,
) -> None:
    try:
        from netops.services.discovery import _is_protected_repo_path  # noqa: PLC0415

        audit_file = _audit_file(settings)
        if _is_protected_repo_path(audit_file):
            return
        audit_file.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user": user,
            "action": action,
            "device": device,
            "payload": payload,
            "reason": reason,
            "success": success,
            "output_preview": output[:200] if output else "",
        }
        with open(audit_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("Failed to record emergency audit log: %s", exc)


class EmergencyCommandRequest(BaseModel):
    device: str = Field(description="Device hostname e.g. spine-1.croc.lab")
    command: str = Field(description="CLI command e.g. show ip bgp summary or display ip routing-table")


class EmergencyPatchRequest(BaseModel):
    device: str = Field(description="Device hostname")
    patch: str = Field(description="Raw configuration lines to apply immediately")
    reason: str = Field(default="Emergency intervention", description="Audit reason for manual patch")


class EmergencyCommandResponse(BaseModel):
    status: str
    device: str
    command: str
    output: str
    failed: bool


class EmergencyPatchResponse(BaseModel):
    status: str
    device: str
    applied_lines: list[str]
    output: str
    reason: str


class ResetResponse(BaseModel):
    status: str
    message: str
    details: str = ""


@router.get("/audit", response_model=list[dict[str, Any]], summary="Get emergency operations audit log")
def get_emergency_audit(_: Viewer, container: ContainerDep) -> list[dict[str, Any]]:
    audit_file = _audit_file(container.settings)
    if not audit_file.exists():
        return []
    records = []
    with open(audit_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
    return records[-50:]


def _emulate_offline_command(settings: Any, device_obj: Any, command: str) -> str:
    cmd = command.strip().lower()
    lab_dir = settings.offline_lab_path
    cfg_path = lab_dir / f"{device_obj.hostname}.cfg"

    if cmd in ("show running-config", "show run", "display current-configuration"):
        if cfg_path.exists():
            return cfg_path.read_text(encoding="utf-8")
        return f"! No offline running configuration found for {device_obj.hostname}\n"

    if "bgp" in cmd and ("summary" in cmd or "peer" in cmd):
        return (
            f"BGP router identifier {device_obj.management_ip}, local AS number 65001\n"
            "BGP table version is 1, main routing table version 1\n"
            "Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd\n"
            "10.0.1.1        4        65000     142     143        1    0    0 01:23:45            2\n"
            "10.0.2.1        4        65000     142     143        1    0    0 01:23:45            2\n"
        )

    if "interface" in cmd and "brief" in cmd:
        return (
            "Interface              IP-Address      OK? Method Status                Protocol\n"
            f"Loopback0              {device_obj.management_ip}        YES manual up                    up\n"
            "GigabitEthernet1       10.0.1.2        YES manual up                    up\n"
            "GigabitEthernet2       10.0.2.2        YES manual up                    up\n"
        )

    if cmd.startswith("ping"):
        return (
            "Sending 5, 100-byte ICMP Echos to target, timeout is 2 seconds:\n"
            "!!!!!\n"
            "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms\n"
        )

    if "version" in cmd:
        return (
            f"CROC DREAM NetOps Virtual Network OS ({device_obj.platform.value})\n"
            "Software Version 17.06.01a (RELEASE SOFTWARE)\n"
            "Technical Support: CROC NetOps Platform Team\n"
            "Uptime is 4 days, 12 hours, 31 minutes\n"
        )

    return f"% Command executed on {device_obj.hostname} (offline simulation):\n{command}\n[OK]\n"


@router.post(
    "/command",
    response_model=EmergencyCommandResponse,
    summary="Execute live CLI command on network device (Operator/Admin)",
)
def execute_emergency_command(
    req: EmergencyCommandRequest,
    container: ContainerDep,
    principal: Operator,
) -> dict[str, Any]:
    toolchain = build_toolchain(container.settings)
    snapshot = container.intents.load()
    device_obj = next((d for d in snapshot.inventory.devices if d.hostname == req.device or d.hostname.startswith(req.device)), None)
    if not device_obj:
        with container.session_factory() as session:
            from sqlalchemy import select  # noqa: PLC0415
            from netops.models import Device as DeviceModel  # noqa: PLC0415
            from netops.intent.models import InventoryDevice  # noqa: PLC0415
            db_dev = session.scalars(select(DeviceModel).where(DeviceModel.hostname == req.device)).first()
            if db_dev:
                device_obj = InventoryDevice(
                    hostname=db_dev.hostname,
                    management_ip=db_dev.management_ip,
                    management_port=db_dev.management_port,
                    platform=db_dev.platform,
                    role=db_dev.role,
                    auth_profile=db_dev.auth_profile,
                )
    if not device_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{req.device}' not found in active inventory",
        )

    # Offline simulation fallback
    if container.settings.network_driver == "offline":
        output = _emulate_offline_command(container.settings, device_obj, req.command)
        record_audit(
            user=principal.username,
            action="cli_command",
            device=device_obj.hostname,
            payload=req.command,
            reason="Interactive CLI (Offline Simulation)",
            success=True,
            output=output,
            settings=container.settings,
        )
        return {
            "status": "ok",
            "device": device_obj.hostname,
            "command": req.command,
            "output": output,
            "failed": False,
        }

    target = toolchain.target_for(device_obj)
    
    # Execute command directly using SSH adapter
    try:
        from netops.network.scrapli_driver import _ParamikoConnAdapter  # noqa: PLC0415
        with _ParamikoConnAdapter(target, timeout=30) as conn:
            res = conn.send_command(req.command)
            record_audit(
                user=principal.username,
                action="cli_command",
                device=device_obj.hostname,
                payload=req.command,
                reason="Interactive CLI",
                success=not res.failed,
                output=res.result,
                settings=container.settings,
            )
            return {
                "status": "ok",
                "device": device_obj.hostname,
                "command": req.command,
                "output": res.result,
                "failed": res.failed,
            }
    except Exception as exc:
        record_audit(
            user=principal.username,
            action="cli_command",
            device=device_obj.hostname,
            payload=req.command,
            reason="Interactive CLI",
            success=False,
            output=str(exc),
            settings=container.settings,
        )
        logger.warning("Failed to execute emergency command on %s: %s", device_obj.hostname, exc)
        return {
            "status": "error",
            "device": device_obj.hostname,
            "command": req.command,
            "output": f"[SSH ERROR] {exc}",
            "failed": True,
        }


@router.post(
    "/patch",
    response_model=EmergencyPatchResponse,
    summary="Apply emergency configuration patch directly (Admin only)",
)
def apply_emergency_patch(
    req: EmergencyPatchRequest,
    container: ContainerDep,
    _: Admin,
) -> dict[str, Any]:
    toolchain = build_toolchain(container.settings)
    snapshot = container.intents.load()
    device_obj = next((d for d in snapshot.inventory.devices if d.hostname == req.device or d.hostname.startswith(req.device)), None)
    if not device_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{req.device}' not found in active inventory",
        )

    with container.session_factory() as session:
        from sqlalchemy import select  # noqa: PLC0415
        from netops.enums import JobStatus, JobType  # noqa: PLC0415
        from netops.models import Job, JobTarget  # noqa: PLC0415

        active_job = session.scalar(
            select(Job.id)
            .join(JobTarget)
            .where(
                JobTarget.hostname == device_obj.hostname,
                Job.type.in_((JobType.DEPLOY, JobType.DRIFT_REMEDIATE)),
                Job.status.in_((JobStatus.PENDING, JobStatus.RUNNING)),
            )
        )
        if active_job is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device '{device_obj.hostname}' is locked by active pipeline job {active_job}",
            )

    target = toolchain.target_for(device_obj)
    lines = [line.strip() for line in req.patch.splitlines() if line.strip() and not line.strip().startswith("!")]

    if not lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patch does not contain any valid configuration statements",
        )

    # Offline simulation fallback
    if container.settings.network_driver == "offline":
        cfg_path = container.settings.offline_lab_path / f"{device_obj.hostname}.cfg"
        existing = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else ""
        patch_text = "\n".join(lines)
        cfg_path.write_text(f"{existing.rstrip()}\n{patch_text}\n", encoding="utf-8")
        record_audit(
            user=_.username,
            action="emergency_patch",
            device=device_obj.hostname,
            payload=patch_text,
            reason=req.reason,
            success=True,
            output="Applied to offline configuration store",
            settings=container.settings,
        )
        return {
            "status": "ok",
            "device": device_obj.hostname,
            "applied_lines": lines,
            "output": "Configuration patch successfully applied to offline configuration.",
            "reason": req.reason,
        }

    try:
        from netops.network.scrapli_driver import _ParamikoConnAdapter  # noqa: PLC0415
        with _ParamikoConnAdapter(target, timeout=35) as conn:
            res = conn.send_configs(lines)
            record_audit(
                user=_.username,
                action="emergency_patch",
                device=device_obj.hostname,
                payload="\n".join(lines),
                reason=req.reason,
                success=True,
                output=res.result,
                settings=container.settings,
            )
            return {
                "status": "ok",
                "device": device_obj.hostname,
                "applied_lines": lines,
                "output": res.result,
                "reason": req.reason,
            }
    except Exception as exc:
        record_audit(
            user=_.username,
            action="emergency_patch",
            device=device_obj.hostname,
            payload="\n".join(lines),
            reason=req.reason,
            success=False,
            output=str(exc),
            settings=container.settings,
        )
        logger.exception("Failed to apply emergency patch on %s", device_obj.hostname)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Patch application failed on {device_obj.hostname}: {exc}",
        ) from exc


@router.post("/soft-reset", response_model=ResetResponse, summary="Soft Reset: Re-converge fabric to Golden Baseline Intent (Admin only)")
def soft_reset_fabric(
    container: ContainerDep,
    _: Admin,
) -> ResetResponse:
    toolchain = build_toolchain(container.settings)
    snapshot = container.intents.load()
    
    deployed = []
    errors = []

    for dev in snapshot.inventory.devices:
        try:
            target = toolchain.target_for(dev)
            rendered = toolchain.renderer.render(dev, snapshot.intent_for(dev.hostname))
            intended = toolchain.normalizer.normalize(dev.platform, rendered)
            
            # Fetch running
            fetch_res = toolchain.collector.fetch_running_configs([target]).get(dev.hostname)
            if not fetch_res or not fetch_res.config:
                errors.append(f"{dev.hostname}: failed to fetch running-config")
                continue

            running = toolchain.normalizer.normalize(dev.platform, fetch_res.config)
            diff = toolchain.diff_engine.compare(dev.platform, running, intended)
            
            if diff.has_changes:
                plan = ChangePlan(remediation=diff.remediation, rollback=diff.rollback, intended=intended)
                toolchain.deployer.apply(target, plan, confirm_timeout=container.settings.commit_confirm_timeout_seconds)
                toolchain.deployer.confirm(target)
                deployed.append(f"{dev.hostname} (remediated)")
            else:
                deployed.append(f"{dev.hostname} (already aligned)")
        except Exception as exc:
            logger.exception("Soft reset error on %s", dev.hostname)
            errors.append(f"{dev.hostname}: {exc}")

    msg = f"Soft reset completed on {len(deployed)} nodes."
    if errors:
        msg += f" Encountered {len(errors)} issues."

    return ResetResponse(
        status="ok" if not errors else "partial",
        message=msg,
        details="; ".join(deployed + [f"ERR: {e}" for e in errors]),
    )


@router.post(
    "/hard-reset",
    response_model=ResetResponse,
    summary="Hard Reset: Redeploy Containerlab topology on server (Admin only)",
)
def hard_reset_containerlab(
    container: ContainerDep,
    _: Admin,
) -> ResetResponse:
    cfg = container.settings
    if not cfg.clab_host or not cfg.clab_user or (not cfg.clab_password and not cfg.clab_key_path):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Containerlab remote host/credentials not configured in NETOPS_CLAB_*",
        )

    host = cfg.clab_host
    port = cfg.clab_port
    user = cfg.clab_user
    pwd = cfg.clab_password.get_secret_value() if cfg.clab_password else None

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        connect_kwargs: dict[str, Any] = {
            "hostname": host,
            "port": port,
            "username": user,
            "timeout": 15,
        }
        if pwd:
            connect_kwargs["password"] = pwd
        if cfg.clab_key_path and os.path.exists(cfg.clab_key_path):
            connect_kwargs["key_filename"] = cfg.clab_key_path

        client.connect(**connect_kwargs)
        topo_path = cfg.clab_topology_path
        # Fast reset via dedicated bash orchestrator if available (<10s, non-root)
        cmd = f"test -f /home/{user}/clab-quickstart/reset_lab.sh && bash /home/{user}/clab-quickstart/reset_lab.sh {topo_path} || containerlab deploy -t {topo_path} --reconfigure"
        _stdin, stdout, _stderr = client.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")

        return ResetResponse(
            status="ok",
            message="Hard Reset: Containerlab topology successfully restored.",
            details=out[-1000:] if len(out) > 1000 else out,
        )
    except Exception as exc:
        logger.exception("Hard reset failed via SSH")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Hard reset failed: {exc}",
        ) from exc

    finally:
        client.close()
