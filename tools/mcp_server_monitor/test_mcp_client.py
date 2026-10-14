#!/usr/bin/env python3
"""
Test client for the MCP Server Monitor.
Simulates a real MCP client communicating via stdio JSON-RPC 2.0 messages.
"""

import json
import os
import subprocess
import sys


def run_tests():
    server_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
    proc = subprocess.Popen(
        [sys.executable, server_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    def send_req(req_obj):
        line = json.dumps(req_obj) + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()
        resp_line = proc.stdout.readline()
        if not resp_line:
            err = proc.stderr.read()
            raise RuntimeError(f"Server exited unexpectedly. Stderr: {err}")
        return json.loads(resp_line)

    def send_notification(req_obj):
        line = json.dumps(req_obj) + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()

    passed = 0
    total = 0

    print("--- Starting MCP stdio handshake & tools tests ---")

    # 1. Initialize
    total += 1
    init_res = send_req({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0"},
        },
    })
    assert init_res.get("id") == 1
    assert "result" in init_res
    assert init_res["result"]["serverInfo"]["name"] == "croc-server-monitor"
    assert "tools" in init_res["result"]["capabilities"]
    print("✓ Test 1: initialize passed")
    passed += 1

    # 2. Notification initialized
    send_notification({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
    })
    print("✓ Test 2: notifications/initialized sent")

    # 3. Ping
    total += 1
    ping_res = send_req({"jsonrpc": "2.0", "id": 2, "method": "ping"})
    assert ping_res.get("id") == 2
    assert ping_res.get("result") == {}
    print("✓ Test 3: ping passed")
    passed += 1

    # 4. Tools list
    total += 1
    list_res = send_req({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})
    assert list_res.get("id") == 3
    tools = list_res["result"]["tools"]
    tool_names = [t["name"] for t in tools]
    expected_tools = [
        "get_system_overview",
        "get_disk_usage",
        "get_top_processes",
        "get_service_status",
        "list_whitelisted_services",
    ]
    for exp in expected_tools:
        assert exp in tool_names, f"Missing tool: {exp}"
    print(f"✓ Test 4: tools/list passed (found {len(tools)} tools: {', '.join(tool_names)})")
    passed += 1

    # 5. Call get_system_overview
    total += 1
    ov_res = send_req({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "get_system_overview", "arguments": {}},
    })
    assert ov_res.get("id") == 4
    content = json.loads(ov_res["result"]["content"][0]["text"])
    assert "cpu" in content and "memory" in content and "host" in content
    print("✓ Test 5: tools/call get_system_overview passed")
    passed += 1

    # 6. Call get_disk_usage
    total += 1
    disk_res = send_req({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {"name": "get_disk_usage", "arguments": {"path": "/"}},
    })
    assert disk_res.get("id") == 5
    disk_content = json.loads(disk_res["result"]["content"][0]["text"])
    assert "partitions" in disk_content
    print("✓ Test 6: tools/call get_disk_usage passed")
    passed += 1

    # 7. Call get_top_processes
    total += 1
    proc_res = send_req({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {"name": "get_top_processes", "arguments": {"limit": 5, "sort_by": "cpu"}},
    })
    assert proc_res.get("id") == 6
    proc_content = json.loads(proc_res["result"]["content"][0]["text"])
    assert "processes" in proc_content
    assert len(proc_content["processes"]) <= 5
    print("✓ Test 7: tools/call get_top_processes passed")
    passed += 1

    # 8. Call get_service_status (whitelisted)
    total += 1
    svc_res = send_req({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {"name": "get_service_status", "arguments": {"service_name": "systemd-journald"}},
    })
    assert svc_res.get("id") == 7
    svc_content = json.loads(svc_res["result"]["content"][0]["text"])
    assert svc_content.get("service") == "systemd-journald"
    assert "is_active" in svc_content
    print("✓ Test 8: tools/call get_service_status (whitelisted) passed")
    passed += 1

    # 9. Call get_service_status (forbidden service)
    total += 1
    deny_res = send_req({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "tools/call",
        "params": {"name": "get_service_status", "arguments": {"service_name": "unauthorized-daemon"}},
    })
    assert deny_res.get("id") == 8
    deny_content = json.loads(deny_res["result"]["content"][0]["text"])
    assert "error" in deny_content and "Access denied" in deny_content["error"]
    print("✓ Test 9: tools/call get_service_status (security rejection) passed")
    passed += 1

    # Cleanup
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()

    print(f"\nAll tests passed: {passed}/{total} ✓")


if __name__ == "__main__":
    run_tests()
