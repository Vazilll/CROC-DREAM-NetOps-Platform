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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import paramiko
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from netops.api.deps import Admin, ContainerDep, Viewer
from netops.enums import Platform
from netops.network.base import ChangePlan, DeviceTarget
from netops.toolchain import build_toolchain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emergency", tags=["emergency"])

AUDIT_LOG_FILE = Path("lab/running/emergency_audit.jsonl")


def record_audit(
    user: str,
    action: str,
    device: str,
    payload: str,
    reason: str,
    success: bool,
    output: str = "",
) -> None:
    try:
        AUDIT_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
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
        with open(AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
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


class ResetResponse(BaseModel):
    status: str
    message: str
    details: str = ""


@router.get("/audit", summary="Get emergency operations audit log")
def get_emergency_audit(_: Viewer) -> list[dict[str, Any]]:
    if not AUDIT_LOG_FILE.exists():
        return []
    records = []
    with open(AUDIT_LOG_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    records.append(json.loads(line))
                except Exception:
                    pass
    return records[-50:]


@router.post("/command", summary="Execute live CLI command on network device (Admin only)")
def execute_emergency_command(
    req: EmergencyCommandRequest,
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

    target = toolchain.target_for(device_obj)
    
    # Execute command directly using SSH adapter
    try:
        from netops.network.scrapli_driver import _ParamikoConnAdapter  # noqa: PLC0415
        with _ParamikoConnAdapter(target, timeout=30) as conn:
            res = conn.send_command(req.command)
            record_audit(
                user=_.username,
                action="cli_command",
                device=device_obj.hostname,
                payload=req.command,
                reason="Interactive CLI",
                success=not res.failed,
                output=res.result,
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
            user=_.username,
            action="cli_command",
            device=device_obj.hostname,
            payload=req.command,
            reason="Interactive CLI",
            success=False,
            output=str(exc),
        )
        logger.exception("Failed to execute emergency command on %s", device_obj.hostname)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Execution failed on {device_obj.hostname}: {exc}",
        ) from exc


@router.post("/patch", summary="Apply emergency configuration patch directly (Admin only)")
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

    target = toolchain.target_for(device_obj)
    lines = [line.strip() for line in req.patch.splitlines() if line.strip() and not line.strip().startswith("!")]

    if not lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patch does not contain any valid configuration statements",
        )

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


@router.post("/hard-reset", response_model=ResetResponse, summary="Hard Reset: Redeploy Containerlab topology on server (Admin only)")
def hard_reset_containerlab(
    container: ContainerDep,
    _: Admin,
) -> ResetResponse:
    host = "5.228.243.54"
    port = 221
    user = "crocdream"
    pwd = "D111111d"

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, port=port, username=user, password=pwd, timeout=15)
        # Re-deploy containerlab topology with reconfigure
        cmd = "echo D111111d | sudo -S containerlab deploy -t /home/crocdream/clab-quickstart/main.clab.yml --reconfigure --max-workers 2"
        stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        
        return ResetResponse(
            status="ok",
            message="Hard Reset: Containerlab topology successfully redeployed.",
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
