#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "psutil>=5.9.0",
# ]
# ///
"""
Isolated, read-only MCP Server for Host and Server Monitoring.
Strict Least-Privilege Design:
- Read-only metrics: CPU, RAM, Swap, Disks, Uptime, Top Processes.
- Sensitive cmdline arguments/secrets masking.
- Strict systemd service whitelist checking (no arbitrary execution/arguments).
- Pure JSON-RPC 2.0 stdio MCP transport compatible with standard MCP clients.
"""

import datetime
import json
import os
import platform
import re
import subprocess
import sys
from typing import Any, Dict, List, Optional

try:
    import psutil
except ImportError:
    sys.stderr.write(
        "CRITICAL: 'psutil' module is missing. Install with 'pip install psutil' "
        "or run via 'uv run --with psutil tools/mcp_server_monitor/server.py'\n"
    )
    sys.exit(1)

# Default whitelist of system services permitted for status queries
DEFAULT_ALLOWED_SERVICES = {
    "docker",
    "containerd",
    "ssh",
    "sshd",
    "nginx",
    "redis",
    "postgresql",
    "croc-backend",
    "croc-frontend",
    "cron",
    "crond",
    "systemd-journald",
    "systemd-networkd",
    "systemd-resolved",
    "ufw",
    "iptables",
}

# Regex patterns to scrub sensitive arguments and credentials from process command lines
SECRET_MASK_PATTERNS = [
    re.compile(
        r"(?i)(--?(?:password|passwd|pass|token|secret|api[_-]?key|auth|bearer|client[_-]?secret|private[_-]?key))[=\s]+([^\s]+)"
    ),
    re.compile(
        r"(?i)\b([a-z0-9_]*(?:token|secret|password|passwd|apikey|api_key|auth|jwt)[a-z0-9_]*)=([^\s]+)"
    ),
    re.compile(r"(?i)(bearer\s+)[a-zA-Z0-9_\-\.]+"),
    re.compile(r"([a-zA-Z0-9+.-]+://[^:]+:)([^@]+)(@.+)"),
]


def get_allowed_services() -> set[str]:
    """Retrieve allowed services including any environment overrides."""
    env_override = os.environ.get("ALLOWED_SERVICES")
    if env_override:
        custom = {s.strip().lower() for s in env_override.split(",") if s.strip()}
        return DEFAULT_ALLOWED_SERVICES | custom
    return DEFAULT_ALLOWED_SERVICES


def mask_secrets(cmdline_raw: Any) -> str:
    """Mask credentials and sensitive parameters from process command lines."""
    if not cmdline_raw:
        return ""
    if isinstance(cmdline_raw, list):
        text = " ".join(str(item) for item in cmdline_raw)
    else:
        text = str(cmdline_raw)

    for pattern in SECRET_MASK_PATTERNS:
        text = pattern.sub(r"\1=***MASKED***", text)

    # Limit length to avoid blowing context windows on huge process trees
    if len(text) > 300:
        text = text[:297] + "..."
    return text


def tool_get_system_overview() -> Dict[str, Any]:
    """Read-only system overview: CPU, Memory, Swap, Uptime, OS info."""
    boot_time = psutil.boot_time()
    uptime_sec = int(datetime.datetime.now().timestamp() - boot_time)
    uptime_str = str(datetime.timedelta(seconds=uptime_sec))

    vm = psutil.virtual_memory()
    sm = psutil.swap_memory()

    # CPU load average (Linux/Unix)
    load_avg = None
    if hasattr(os, "getloadavg"):
        try:
            load_avg = [round(x, 2) for x in os.getloadavg()]
        except (OSError, AttributeError):
            load_avg = None

    return {
        "host": {
            "hostname": platform.node(),
            "os": f"{platform.system()} {platform.release()}",
            "architecture": platform.machine(),
            "boot_time": datetime.datetime.fromtimestamp(boot_time).isoformat(),
            "uptime_seconds": uptime_sec,
            "uptime_human": uptime_str,
        },
        "cpu": {
            "physical_cores": psutil.cpu_count(logical=False),
            "logical_cores": psutil.cpu_count(logical=True),
            "usage_percent": psutil.cpu_percent(interval=0.1),
            "load_average_1_5_15m": load_avg,
        },
        "memory": {
            "total_bytes": vm.total,
            "used_bytes": vm.used,
            "available_bytes": vm.available,
            "percent": vm.percent,
            "used_human": f"{vm.used / (1024**3):.2f} GiB",
            "total_human": f"{vm.total / (1024**3):.2f} GiB",
        },
        "swap": {
            "total_bytes": sm.total,
            "used_bytes": sm.used,
            "free_bytes": sm.free,
            "percent": sm.percent,
            "used_human": f"{sm.used / (1024**3):.2f} GiB",
            "total_human": f"{sm.total / (1024**3):.2f} GiB",
        },
    }


def tool_get_disk_usage(path: Optional[str] = None) -> Dict[str, Any]:
    """Read-only disk statistics for mounted partitions and target path."""
    partitions_data = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
            partitions_data.append(
                {
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "total_bytes": usage.total,
                    "used_bytes": usage.used,
                    "free_bytes": usage.free,
                    "percent": usage.percent,
                    "total_human": f"{usage.total / (1024**3):.2f} GiB",
                    "used_human": f"{usage.used / (1024**3):.2f} GiB",
                    "free_human": f"{usage.free / (1024**3):.2f} GiB",
                }
            )
        except (PermissionError, FileNotFoundError):
            continue

    target_info = None
    if path:
        real_path = os.path.realpath(path)
        if not os.path.exists(real_path):
            return {"error": f"Path '{path}' does not exist on host"}
        try:
            u = psutil.disk_usage(real_path)
            target_info = {
                "path": real_path,
                "total_bytes": u.total,
                "used_bytes": u.used,
                "free_bytes": u.free,
                "percent": u.percent,
                "total_human": f"{u.total / (1024**3):.2f} GiB",
                "used_human": f"{u.used / (1024**3):.2f} GiB",
                "free_human": f"{u.free / (1024**3):.2f} GiB",
            }
        except Exception as ex:
            target_info = {"path": real_path, "error": str(ex)}

    return {
        "partitions": partitions_data,
        "target_path_usage": target_info,
    }


def tool_get_top_processes(limit: int = 10, sort_by: str = "cpu") -> Dict[str, Any]:
    """List top running processes with cmdline secrets masked."""
    # Enforce safe bounds
    safe_limit = max(1, min(int(limit), 50))
    metric = sort_by.strip().lower() if sort_by in ("cpu", "memory") else "cpu"

    collected = []
    # Query with specified fields only
    attrs = ["pid", "name", "username", "status", "cpu_percent", "memory_percent", "num_threads", "cmdline"]
    for proc in psutil.process_iter(attrs):
        try:
            info = proc.info
            masked_cmd = mask_secrets(info.get("cmdline"))
            collected.append(
                {
                    "pid": info.get("pid"),
                    "name": info.get("name"),
                    "username": info.get("username"),
                    "status": info.get("status"),
                    "cpu_percent": round(info.get("cpu_percent") or 0.0, 1),
                    "memory_percent": round(info.get("memory_percent") or 0.0, 1),
                    "num_threads": info.get("num_threads") or 1,
                    "cmdline": masked_cmd,
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    if metric == "cpu":
        collected.sort(key=lambda p: p["cpu_percent"], reverse=True)
    else:
        collected.sort(key=lambda p: p["memory_percent"], reverse=True)

    return {
        "sort_by": metric,
        "count": min(len(collected), safe_limit),
        "processes": collected[:safe_limit],
    }


def tool_get_service_status(service_name: str) -> Dict[str, Any]:
    """Check status of a whitelisted systemd service."""
    if not service_name:
        return {"error": "Missing 'service_name' argument"}

    clean_name = service_name.strip().lower()
    if clean_name.endswith(".service"):
        clean_name = clean_name[:-8]

    # Validate against strict regex: alphanumeric, dash, underscore only
    if not re.match(r"^[a-z0-9_\-]+$", clean_name):
        return {"error": f"Invalid service name format: '{service_name}'"}

    allowed = get_allowed_services()
    if clean_name not in allowed:
        return {
            "error": f"Access denied: '{clean_name}' is not in the whitelist of monitored services.",
            "allowed_services": sorted(list(allowed)),
        }

    systemctl_path = "/usr/bin/systemctl"
    if not os.path.exists(systemctl_path):
        return {"error": "systemctl binary not found on host system"}

    try:
        # Strict subprocess execution with fixed argument list (shell=False)
        cmd = [
            systemctl_path,
            "show",
            f"{clean_name}.service",
            "--property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStartTimestamp",
        ]
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )

        props: Dict[str, str] = {}
        for line in res.stdout.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                props[k.strip()] = v.strip()

        is_active = props.get("ActiveState") == "active"
        return {
            "service": clean_name,
            "is_active": is_active,
            "active_state": props.get("ActiveState", "unknown"),
            "sub_state": props.get("SubState", "unknown"),
            "load_state": props.get("LoadState", "unknown"),
            "unit_file_state": props.get("UnitFileState", "unknown"),
            "main_pid": props.get("MainPID", "0"),
            "start_timestamp": props.get("ExecMainStartTimestamp", ""),
            "description": props.get("Description", ""),
        }
    except subprocess.TimeoutExpired:
        return {"error": f"Timeout querying status for service '{clean_name}'"}
    except Exception as ex:
        return {"error": f"Failed to check service: {str(ex)}"}


def tool_list_whitelisted_services() -> Dict[str, Any]:
    """List all systemd services that can be monitored."""
    allowed = sorted(list(get_allowed_services()))
    return {
        "count": len(allowed),
        "allowed_services": allowed,
        "note": "Services can be added via the ALLOWED_SERVICES environment variable (comma-separated).",
    }


# MCP Tool Definitions Schema
TOOLS_METADATA = [
    {
        "name": "get_system_overview",
        "description": "Read-only overview of host metrics (CPU cores & usage, RAM, Swap, load averages, uptime, hostname, OS).",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_disk_usage",
        "description": "Read-only disk usage statistics for mounted physical partitions or a specific target path.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Optional specific path or mount point to inspect (e.g. '/' or '/home').",
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_top_processes",
        "description": "List top running processes sorted by CPU or memory usage. Process command-line secrets and tokens are masked.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Number of processes to return (1-50, default: 10).",
                    "default": 10,
                },
                "sort_by": {
                    "type": "string",
                    "enum": ["cpu", "memory"],
                    "description": "Metric to sort by: 'cpu' or 'memory' (default: 'cpu').",
                    "default": "cpu",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_service_status",
        "description": "Read-only status of a systemd service from the permitted whitelist (ActiveState, SubState, PID, etc.).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "service_name": {
                    "type": "string",
                    "description": "Name of the service (e.g., 'docker', 'ssh', 'nginx', 'postgresql').",
                }
            },
            "required": ["service_name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_whitelisted_services",
        "description": "List all systemd services that are permitted for status checks.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
]


def execute_tool(name: str, args: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    """Dispatch tool execution and return (result_data, is_error)."""
    try:
        if name == "get_system_overview":
            return tool_get_system_overview(), False
        elif name == "get_disk_usage":
            path = args.get("path")
            return tool_get_disk_usage(path), False
        elif name == "get_top_processes":
            limit = args.get("limit", 10)
            sort_by = args.get("sort_by", "cpu")
            return tool_get_top_processes(limit=limit, sort_by=sort_by), False
        elif name == "get_service_status":
            service_name = args.get("service_name", "")
            return tool_get_service_status(service_name=service_name), False
        elif name == "list_whitelisted_services":
            return tool_list_whitelisted_services(), False
        else:
            return {"error": f"Tool '{name}' not found"}, True
    except Exception as ex:
        return {"error": f"Internal error executing tool '{name}': {str(ex)}"}, True


def run_stdio_server():
    """Run JSON-RPC 2.0 stdio loop conforming to MCP specification."""
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    sys.stderr.write("MCP Server Monitor: listening on stdin/stdout (stdio transport)...\n")
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as ex:
            sys.stderr.write(f"Invalid JSON: {ex}\n")
            continue

        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        # Handle notifications (no response needed)
        if method == "notifications/initialized":
            sys.stderr.write("Client initialized.\n")
            sys.stderr.flush()
            continue

        response: Dict[str, Any] = {"jsonrpc": "2.0", "id": req_id}

        if method == "initialize":
            response["result"] = {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                },
                "serverInfo": {
                    "name": "croc-server-monitor",
                    "version": "1.0.0",
                },
            }
        elif method == "ping":
            response["result"] = {}
        elif method == "tools/list":
            response["result"] = {
                "tools": TOOLS_METADATA,
            }
        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            data, is_err = execute_tool(tool_name, arguments)
            response["result"] = {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(data, indent=2, ensure_ascii=False),
                    }
                ],
                "isError": is_err,
            }
        else:
            response["error"] = {
                "code": -32601,
                "message": f"Method '{method}' not found",
            }

        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def run_diagnostics():
    """Self-test mode: execute all tools directly and print results to stdout."""
    print("=== Running Self-Diagnostics for Server Monitor MCP ===")
    print("\n1. System Overview:")
    print(json.dumps(tool_get_system_overview(), indent=2, ensure_ascii=False))

    print("\n2. Disk Usage:")
    print(json.dumps(tool_get_disk_usage("/"), indent=2, ensure_ascii=False))

    print("\n3. Top Processes (Top 3 by CPU):")
    print(json.dumps(tool_get_top_processes(limit=3, sort_by="cpu"), indent=2, ensure_ascii=False))

    print("\n4. List Whitelisted Services:")
    print(json.dumps(tool_list_whitelisted_services(), indent=2, ensure_ascii=False))

    print("\n5. Service Status (Whitelisted, e.g. 'docker' or 'systemd-journald'):")
    print(json.dumps(tool_get_service_status("systemd-journald"), indent=2, ensure_ascii=False))

    print("\n6. Service Status (Forbidden / Non-whitelisted, e.g. 'malicious-service'):")
    print(json.dumps(tool_get_service_status("malicious-service"), indent=2, ensure_ascii=False))

    print("\n=== Self-Diagnostics Completed Successfully ===")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("--test", "-t", "diagnose"):
        run_diagnostics()
    else:
        run_stdio_server()
