from __future__ import annotations

from datetime import UTC, datetime, timedelta

from netops.api.routes.insights import (
    CopilotAction,
    CopilotReply,
    CopilotRequest,
    extract_copilot_action,
    generate_fallback_action,
)
from netops.intent.netbox import load_netbox_inventory
from netops.services.forecast import (
    ForecastEvent,
    _statistical_forecast,
    build_forecast,
    calculate_relative_index,
    clear_chaos_events,
    get_chaos_events,
    record_chaos_event,
)
from netops.services.telemetry import metric_series
from netops.settings import Settings


def test_netbox_inventory_maps_and_skips_incomplete_devices() -> None:
    pages = {
        "http://nb/api/dcim/devices/?limit=500": {
            "next": "http://nb/page2",
            "results": [
                {
                    "name": "leaf-9.lab",
                    "primary_ip4": {"address": "172.20.20.99/24"},
                    "platform": {"slug": "arista_eos"},
                    "role": {"slug": "leaf"},
                },
                {
                    "name": "no-ip.lab",
                    "primary_ip4": None,
                    "platform": {"slug": "arista_eos"},
                    "role": {"slug": "leaf"},
                },
            ],
        },
        "http://nb/page2": {
            "next": None,
            "results": [
                {
                    "name": "weird.lab",
                    "primary_ip4": {"address": "172.20.20.98/24"},
                    "platform": {"slug": "unknown_os"},
                    "role": {"slug": "leaf"},
                }
            ],
        },
    }
    inventory = load_netbox_inventory("http://nb", "t", fetch=lambda url, _t: pages[url])
    assert [(d.hostname, str(d.management_ip)) for d in inventory.devices] == [
        ("leaf-9.lab", "172.20.20.99")
    ]


def test_telemetry_is_deterministic_and_forecast_has_horizon() -> None:
    a = metric_series("leaf-1.lab", "leaf", "cpu_pct")
    assert a == metric_series("leaf-1.lab", "leaf", "cpu_pct")
    result = _statistical_forecast(a, 48)
    assert len(result["median"]) == len(result["lower"]) == len(result["upper"]) == 48
    assert all(
        lo <= m <= hi
        for lo, m, hi in zip(result["lower"], result["median"], result["upper"], strict=True)
    )


def test_forecast_event_model_and_relative_index() -> None:
    now = datetime(2026, 10, 3, 12, 0, 0, tzinfo=UTC)

    # Current moment maps to 143 (last point of 144 history points)
    idx_now = calculate_relative_index(now, now)
    assert idx_now == 143

    # 5 minutes ago (1 step) maps to 142
    idx_5m = calculate_relative_index(now - timedelta(minutes=5), now)
    assert idx_5m == 142

    # 6 hours ago (72 steps) maps to 71
    idx_6h = calculate_relative_index(now - timedelta(hours=6), now)
    assert idx_6h == 71

    # Beyond 12 hours maps to None
    idx_13h = calculate_relative_index(now - timedelta(hours=13), now)
    assert idx_13h is None

    # Model validation
    ev = ForecastEvent(
        type="CHAOS",
        timestamp=now.isoformat(),
        title="Test Incident",
        description="Testing chaos logging",
        severity="critical",
        relative_index=idx_now,
    )
    assert ev.type == "CHAOS"
    assert ev.relative_index == 143


def test_chaos_event_logging_and_filtering() -> None:
    clear_chaos_events()
    record_chaos_event(
        scenario="acl_drift",
        target_hostnames=["leaf-1.croc.lab"],
        title="Chaos ACL",
        description="Drift created",
        severity="warning",
    )
    record_chaos_event(
        scenario="reset_lab",
        target_hostnames=["*"],
        title="Reset",
        description="Clean SoT",
        severity="info",
    )

    leaf1_events = get_chaos_events("leaf-1.croc.lab")
    assert len(leaf1_events) == 2  # Matches targeted and wildcard "*"

    leaf2_events = get_chaos_events("leaf-2.croc.lab")
    assert len(leaf2_events) == 1  # Matches wildcard only
    assert leaf2_events[0]["scenario"] == "reset_lab"
    clear_chaos_events()


def test_copilot_request_and_reply_schema() -> None:
    req = CopilotRequest(message="Проверка сети", screen="dashboard")
    assert req.screen == "dashboard"
    assert req.device_id is None

    action = CopilotAction(type="remediate", label="Устранить дрейф", device_id=1)
    reply = CopilotReply(answer="Ответ", provider="test", action=action)
    dumped = reply.model_dump()
    assert dumped["action"]["type"] == "remediate"
    assert dumped["action"]["device_id"] == 1


def test_extract_copilot_action_with_action_tag() -> None:
    text = "На leaf-1 обнаружен дрейф.\nACTION: remediate|Устранить дрейф|1"
    clean, action = extract_copilot_action(text)
    assert clean == "На leaf-1 обнаружен дрейф."
    assert action is not None
    assert action.type == "remediate"
    assert action.label == "Устранить дрейф"
    assert action.device_id == 1


def test_extract_copilot_action_without_tag() -> None:
    text = "Конфигурация фабрики в норме."
    clean, action = extract_copilot_action(text)
    assert clean == text
    assert action is None


def test_generate_fallback_action_remediates_drift() -> None:
    class DummyDevice:
        id = 1
        hostname = "leaf-1.croc.lab"
        role = "leaf"
        platform = "cisco_iosxe"
        status = "DRIFT_DETECTED"

    req = CopilotRequest(message="Что делать?", screen="dashboard")
    summary, action = generate_fallback_action(req, [DummyDevice()], [])
    assert "дрейф" in summary.lower()
    assert action is not None
    assert action.type == "remediate"
    assert action.device_id == 1


def test_build_forecast_includes_events() -> None:
    clear_chaos_events()
    record_chaos_event(
        scenario="port_down",
        target_hostnames=["leaf-2.croc.lab"],
        title="Port Down",
        description="Port shutdown",
        severity="critical",
    )
    forecast = build_forecast(Settings(), 2, "leaf-2.croc.lab", "leaf", "uplink_util_pct", 72)
    assert len(forecast.events) > 0
    assert any(e.type == "CHAOS" for e in forecast.events)
    clear_chaos_events()
