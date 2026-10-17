#!/usr/bin/env python3
"""Model Context Protocol (MCP) server for CROC DREAM NetOps Platform.

Implements standard JSON-RPC 2.0 over stdio for LLM agents (Claude Desktop, Cursor,
Antigravity, and autonomous network operators). Zero external dependencies (Python stdlib only).

Usage:
    python -m netops.mcp_server --api-url http://127.0.0.1:8001 --token <personal-token>
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [MCP] %(levelname)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("netops.mcp")

SERVER_NAME = "croc-dream-netops"
SERVER_VERSION = "1.0.0"
PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "netops_list_devices",
        "description": "List all network devices in the fabric with operational status (IN_SYNC, DRIFT_DETECTED, UNREACHABLE), platform, and management IP.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "description": "Optional status filter: IN_SYNC, DRIFT_DETECTED, UNREACHABLE, UNKNOWN",
                }
            },
        },
    },
    {
        "name": "netops_get_device_detail",
        "description": "Get detailed device specs, interfaces, BGP routing configuration, and running state by device ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_id": {"type": "integer", "description": "Numeric ID of the device"}
            },
            "required": ["device_id"],
        },
    },
    {
        "name": "netops_scan_drift",
        "description": "Trigger an immediate drift check across the fabric to detect unauthorized configuration changes.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Optional list of device IDs to scan; if omitted, scans all devices",
                }
            },
        },
    },
    {
        "name": "netops_run_dry_run",
        "description": "Simulate configuration changes from Git intent, computing HierConfig remediation and rollback patches without applying them.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Device IDs to include in dry-run simulation",
                }
            },
            "required": ["device_ids"],
        },
    },
    {
        "name": "netops_deploy_changes",
        "description": "Deploy approved changes with commit-confirmed (180s) and automatic rollback if health-checks fail.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dry_run_job_id": {
                    "type": "string",
                    "description": "UUID of the successful dry-run job to deploy",
                },
                "confirmed_by": {
                    "type": "string",
                    "description": "Username of the operator confirming the change",
                },
            },
            "required": ["dry_run_job_id"],
        },
    },
    {
        "name": "netops_execute_cli_command",
        "description": "Execute diagnostic CLI command on a network device (e.g. 'show ip bgp summary', 'show ip interface brief', 'ping <ip>').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device": {
                    "type": "string",
                    "description": "Device hostname (e.g. 'leaf-1.croc.lab' or 'leaf-1')",
                },
                "command": {
                    "type": "string",
                    "description": "CLI command to run",
                },
            },
            "required": ["device", "command"],
        },
    },
    {
        "name": "netops_get_telemetry_forecast",
        "description": "Fetch real-time CPU/RAM/BGP telemetry and predictive statistical forecast for an intent device.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hostname": {
                    "type": "string",
                    "description": "Target hostname (e.g. 'leaf-1.croc.lab')",
                }
            },
            "required": ["hostname"],
        },
    },
    {
        "name": "netops_lint_intent",
        "description": "Run GitOps pre-flight linting on the YAML intent repository to check subnets, BGP ASN, and schema correctness.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


class NetOpsClient:
    """Client for NetOps Platform REST API."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any] | list[Any] | str:
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "User-Agent": "CROC-NetOps-MCP/1.0",
        }
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8")
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    return raw
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="ignore")
            logger.error("API error %s on %s %s: %s", err.code, method, path, err_body)
            raise RuntimeError(f"HTTP {err.code}: {err_body}") from err
        except Exception as exc:
            logger.error("Failed to connect to NetOps API %s: %s", url, exc)
            raise RuntimeError(f"Connection error to NetOps Platform ({url}): {exc}") from exc


def execute_tool(client: NetOpsClient, name: str, args: dict[str, Any]) -> str:
    """Route tool call to corresponding NetOps API endpoint."""
    if name == "netops_list_devices":
        status_filter = args.get("status")
        path = f"/api/v1/devices?status={urllib.parse.quote(status_filter)}" if status_filter else "/api/v1/devices"
        res = client._request("GET", path)
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_get_device_detail":
        dev_id = args.get("device_id")
        res = client._request("GET", f"/api/v1/devices/{dev_id}")
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_scan_drift":
        dev_ids = args.get("device_ids")
        payload = {"device_ids": dev_ids} if dev_ids else {}
        res = client._request("POST", "/api/v1/drift/scan", payload)
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_run_dry_run":
        dev_ids = args.get("device_ids", [])
        payload = {"device_ids": dev_ids, "intent_source": "git_main"}
        res = client._request("POST", "/api/v1/jobs/dry-run", payload)
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_deploy_changes":
        job_id = args.get("dry_run_job_id")
        confirmed_by = args.get("confirmed_by", "mcp-agent")
        payload = {"job_id": job_id, "confirmed_by": confirmed_by}
        res = client._request("POST", "/api/v1/jobs/deploy", payload)
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_execute_cli_command":
        device = args.get("device", "")
        cmd = args.get("command", "")
        payload = {"device": device, "command": cmd}
        res = client._request("POST", "/api/v1/emergency/command", payload)
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_get_telemetry_forecast":
        hostname = args.get("hostname", "")
        res = client._request("GET", f"/api/v1/insights/forecast/{urllib.parse.quote(hostname)}")
        return json.dumps(res, indent=2, ensure_ascii=False)

    if name == "netops_lint_intent":
        res = client._request("GET", "/api/v1/intent/lint")
        return json.dumps(res, indent=2, ensure_ascii=False)

    raise ValueError(f"Unknown tool: {name}")


def handle_rpc_message(client: NetOpsClient, msg: dict[str, Any]) -> dict[str, Any] | None:
    """Process a single JSON-RPC 2.0 request."""
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {"listChanged": False},
                },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                },
            },
        }

    if method == "notifications/initialized":
        logger.info("MCP client initialized.")
        return None

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": TOOLS,
            },
        }

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        try:
            output_text = execute_tool(client, tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": output_text}],
                    "isError": False,
                },
            }
        except Exception as exc:
            logger.exception("Error executing tool %s", tool_name)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"Error: {exc}"}],
                    "isError": True,
                },
            }

    if req_id is not None:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
        }
    return None


def run_server() -> None:
    parser = argparse.ArgumentParser(description="CROC DREAM NetOps MCP Server")
    parser.add_argument(
        "--api-url",
        default=os.getenv("NETOPS_API_URL", "http://127.0.0.1:8001"),
        help="NetOps API base URL (default: http://127.0.0.1:8001)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("NETOPS_API_TOKEN", ""),
        help="NetOps API auth Bearer token",
    )
    args = parser.parse_args()

    client = NetOpsClient(args.api_url, args.token)
    logger.info("Starting NetOps MCP Server connected to %s", args.api_url)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            logger.warning("Invalid JSON received: %s", line)
            continue

        resp = handle_rpc_message(client, msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    run_server()
