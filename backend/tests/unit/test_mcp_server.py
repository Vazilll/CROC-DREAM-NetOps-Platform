from __future__ import annotations

import json
from unittest.mock import MagicMock

from netops.mcp_server import TOOLS, NetOpsClient, handle_rpc_message


def test_mcp_initialize() -> None:
    client = MagicMock(spec=NetOpsClient)
    msg = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
    resp = handle_rpc_message(client, msg)
    assert resp is not None
    assert resp["id"] == 1
    assert resp["result"]["serverInfo"]["name"] == "croc-dream-netops"
    assert "tools" in resp["result"]["capabilities"]


def test_mcp_tools_list() -> None:
    client = MagicMock(spec=NetOpsClient)
    msg = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
    resp = handle_rpc_message(client, msg)
    assert resp is not None
    assert resp["id"] == 2
    tools = resp["result"]["tools"]
    tool_names = [t["name"] for t in tools]
    assert "netops_list_devices" in tool_names
    assert "netops_scan_drift" in tool_names
    assert "netops_run_dry_run" in tool_names
    assert "netops_deploy_changes" in tool_names
    assert "netops_execute_cli_command" in tool_names
    assert "netops_get_telemetry_forecast" in tool_names
    assert len(tools) == len(TOOLS)


def test_mcp_tools_call_devices() -> None:
    client = MagicMock(spec=NetOpsClient)
    client._request.return_value = [{"hostname": "leaf-1", "status": "IN_SYNC"}]
    msg = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "netops_list_devices", "arguments": {}},
    }
    resp = handle_rpc_message(client, msg)
    assert resp is not None
    assert resp["id"] == 3
    assert not resp["result"]["isError"]
    content = json.loads(resp["result"]["content"][0]["text"])
    assert content[0]["hostname"] == "leaf-1"


def test_mcp_unknown_tool() -> None:
    client = MagicMock(spec=NetOpsClient)
    msg = {
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "unknown_tool", "arguments": {}},
    }
    resp = handle_rpc_message(client, msg)
    assert resp is not None
    assert resp["id"] == 4
    assert resp["result"]["isError"] is True
    assert "Unknown tool" in resp["result"]["content"][0]["text"]
