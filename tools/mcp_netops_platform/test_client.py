#!/usr/bin/env python3
"""Automated test client for NetOps Platform MCP server."""

import json
import subprocess
import sys


def test_mcp_server() -> None:
    proc = subprocess.Popen(
        [sys.executable, "tools/mcp_netops_platform/server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    def send_and_recv(msg: dict) -> dict:
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        return json.loads(line)

    try:
        # 1. initialize
        init_res = send_and_recv({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        })
        assert init_res.get("result", {}).get("serverInfo", {}).get("name") == "netops-platform-mcp"
        print("✓ Step 1: Initialize passed")

        # 2. ping
        ping_res = send_and_recv({"jsonrpc": "2.0", "id": 2, "method": "ping"})
        assert ping_res.get("id") == 2
        print("✓ Step 2: Ping passed")

        # 3. tools/list
        tools_res = send_and_recv({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
        tools = tools_res.get("result", {}).get("tools", [])
        tool_names = {t["name"] for t in tools}
        expected = {"get_platform_health", "list_devices", "get_drift_report", "trigger_dry_run", "get_job_status", "explain_config_risk"}
        assert expected.issubset(tool_names), f"Missing tools: {expected - tool_names}"
        print(f"✓ Step 3: Tools list passed ({len(tools)} tools exposed)")

        # 4. tools/call get_platform_health (graceful handling even if platform is offline)
        call_res = send_and_recv({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "get_platform_health", "arguments": {}},
        })
        assert call_res.get("id") == 4
        content = call_res["result"]["content"][0]["text"]
        data = json.loads(content)
        assert "status" in data
        print(f"✓ Step 4: Tool call get_platform_health passed (status={data['status']})")

        print("\nAll 4 tests passed successfully!")
    finally:
        proc.terminate()


if __name__ == "__main__":
    test_mcp_server()
