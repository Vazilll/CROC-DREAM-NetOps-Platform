#!/usr/bin/env python3
"""NetOps Platform MCP Server (Model Context Protocol stdio transport).

Allows AI agents to interact with the CROC DREAM NetOps Platform API safely:
- Query network devices and inventory
- Inspect configuration drift and diffs
- Trigger Dry-Run validation pipelines
- Monitor job execution logs and status
- Explain configuration risks
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mcp_netops_platform")

API_BASE_URL = os.environ.get("NETOPS_API_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")
API_TOKEN = os.environ.get("NETOPS_API_TOKEN", "dev-operator-token")


def _api_call(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    url = f"{API_BASE_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_msg)
            return {"error": f"HTTP {exc.code}: {parsed.get('detail', err_msg)}"}
        except Exception:
            return {"error": f"HTTP {exc.code}: {err_msg}"}
    except Exception as exc:
        return {"error": f"Connection error to NetOps Platform ({url}): {exc}"}


# --- Tool Implementations ---


def list_devices(role: str | None = None, platform: str | None = None) -> dict[str, Any]:
    """List network devices with optional filtering by role or platform."""
    params = {}
    if role:
        params["role"] = role
    if platform:
        params["platform"] = platform
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    res = _api_call("GET", f"/devices{query}")
    if isinstance(res, dict) and "error" in res:
        return res
    items = res if isinstance(res, list) else res.get("items", [])
    clean_devices = [
        {
            "id": d.get("id"),
            "hostname": d.get("hostname"),
            "management_ip": d.get("management_ip"),
            "platform": d.get("platform"),
            "role": d.get("role"),
            "in_maintenance": d.get("in_maintenance", False),
            "status": d.get("status"),
        }
        for d in items
    ]
    return {"total": len(clean_devices), "devices": clean_devices}


def get_drift_report(hostname: str | None = None) -> dict[str, Any]:
    """Get active configuration drift summary or specific device drift report."""
    if hostname:
        res = _api_call("GET", f"/drift/{urllib.parse.quote(hostname)}")
        return res if isinstance(res, dict) else {"report": res}
    res = _api_call("GET", "/drift")
    return res if isinstance(res, dict) else {"items": res}


def trigger_dry_run(device_ids: list[int] | None = None) -> dict[str, Any]:
    """Trigger a Dry-Run intent deployment pipeline to validate planned changes without applying them."""
    payload: dict[str, Any] = {"type": "DRY_RUN"}
    if device_ids:
        payload["device_ids"] = device_ids
    return _api_call("POST", "/jobs", payload)


def get_job_status(job_id: int) -> dict[str, Any]:
    """Check the status, targets, and execution steps of a deployment/audit job."""
    res = _api_call("GET", f"/jobs/{job_id}")
    if isinstance(res, dict) and "error" in res:
        return res
    return {
        "id": res.get("id"),
        "type": res.get("type"),
        "status": res.get("status"),
        "created_at": res.get("created_at"),
        "finished_at": res.get("finished_at"),
        "created_by": res.get("created_by"),
        "targets": res.get("targets", []),
        "steps": res.get("steps", []),
    }


def explain_config_risk(job_id: int) -> dict[str, Any]:
    """Evaluate and explain configuration risks for a given job using AI Guard and rule engine."""
    return _api_call("POST", f"/jobs/{job_id}/explain")


def get_platform_health() -> dict[str, Any]:
    """Get NetOps platform health status, DB connectivity, and factory freeze switch state."""
    ready = _api_call("GET", "/readyz")
    freeze = _api_call("GET", "/system/freeze")
    return {
        "status": "online" if not ready.get("error") else "degraded",
        "readyz": ready,
        "factory_freeze": freeze,
    }


# --- MCP Protocol Definition ---

TOOLS = [
    {
        "name": "get_platform_health",
        "description": "Check CROC NetOps Platform health, API readiness, and Emergency Freeze switch.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_devices",
        "description": "List network fabric devices (Arista, Cisco, Huawei) with roles, IPs, and maintenance state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "role": {"type": "string", "enum": ["spine", "leaf", "border", "core"], "description": "Filter by role"},
                "platform": {"type": "string", "enum": ["arista_eos", "cisco_iosxe", "huawei_vrp"], "description": "Filter by platform"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_drift_report",
        "description": "Retrieve configuration drift reports (unauthorized config changes vs Git SoT).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hostname": {"type": "string", "description": "Optional specific device hostname (e.g. leaf1.lab)"}
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "trigger_dry_run",
        "description": "Trigger a safe Dry-Run deployment job to validate planned changes without touching production.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Optional list of device IDs. If omitted, runs for all devices.",
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_job_status",
        "description": "Get status, targets, progress and step logs for a job ID.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "integer", "description": "The job ID to check"}},
            "required": ["job_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "explain_config_risk",
        "description": "Get AI Guard and semantic risk explanation for proposed network configuration changes.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "integer", "description": "The job ID to analyze"}},
            "required": ["job_id"],
            "additionalProperties": False,
        },
    },
]


def handle_rpc(line: str) -> str | None:
    try:
        req = json.loads(line)
    except Exception as exc:
        return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": f"Parse error: {exc}"}})

    req_id = req.get("id")
    method = req.get("method")

    if method == "initialize":
        return json.dumps({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "netops-platform-mcp", "version": "0.1.0"},
            },
        })

    if method == "notifications/initialized":
        return None

    if method == "ping":
        return json.dumps({"jsonrpc": "2.0", "id": req_id, "result": {}})

    if method == "tools/list":
        return json.dumps({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})

    if method == "tools/call":
        params = req.get("params", {})
        name = params.get("name")
        args = params.get("arguments", {})

        handlers = {
            "get_platform_health": lambda: get_platform_health(),
            "list_devices": lambda: list_devices(args.get("role"), args.get("platform")),
            "get_drift_report": lambda: get_drift_report(args.get("hostname")),
            "trigger_dry_run": lambda: trigger_dry_run(args.get("device_ids")),
            "get_job_status": lambda: get_job_status(int(args["job_id"])),
            "explain_config_risk": lambda: explain_config_risk(int(args["job_id"])),
        }

        handler = handlers.get(name)
        if not handler:
            return json.dumps({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Tool '{name}' not found"},
            })

        try:
            result = handler()
            return json.dumps({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2, ensure_ascii=False)}]},
            })
        except Exception as exc:
            return json.dumps({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "isError": True,
                    "content": [{"type": "text", "text": f"Error executing {name}: {exc}"}],
                },
            })

    return json.dumps({
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method '{method}' not found"},
    })


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        resp = handle_rpc(line)
        if resp is not None:
            sys.stdout.write(resp + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
