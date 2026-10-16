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
from netops.services.telemetry import clear_live_metrics, metric_series, record_live_metric
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


def test_no_measurements_means_no_data_and_measured_series_forecasts() -> None:
    clear_live_metrics("leaf-measured.lab")
    assert metric_series("leaf-nodata.lab", "leaf", "cpu_pct") == []
    for v in (10.0, 12.0, 14.0, 16.0, 18.0):
        record_live_metric("leaf-measured.lab", "cpu_pct", v)
    a = metric_series("leaf-measured.lab", "leaf", "cpu_pct")
    assert a == [10.0, 12.0, 14.0, 16.0, 18.0]
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

    hallucinated = "Откат невозможен.\nACTION: rollback|Откатить|1"
    clean_h, action_h = extract_copilot_action(hallucinated)
    assert clean_h == hallucinated
    assert action_h is None


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


def test_huawei_display_cpu_is_parsed() -> None:
    from netops.services.telemetry import parse_huawei_cpu

    out = "cpu0         3%       0%       0%       0%   0% 2026-10-06 22:19:50\ncpu1         1%       0%       0%       0%   0% 2026-10-06 22:19:50\n"
    assert parse_huawei_cpu(out) == 2.0


def test_offline_and_online_mode_separation() -> None:
    from netops.services.ai_guard import AiTelemetryGuard
    from netops.services.forecast import clear_forecast_cache
    from netops.services.telemetry import synthetic_metric_series

    clear_live_metrics("node-test.lab")
    clear_forecast_cache()

    # 1. Offline mode: synthetic metrics are generated and marked simulated=True
    s_offline = Settings(_env_file=None, network_driver="offline", forecast_url="")  # type: ignore[call-arg]
    synth = synthetic_metric_series("node-test.lab", "spine", "cpu_pct", points=12)
    assert len(synth) == 12
    fc_offline = build_forecast(s_offline, 1, "node-test.lab", "spine", "cpu_pct", 12)
    assert fc_offline.simulated is True

    # 2. Online (scrapli) mode with no measurements: no fake metrics, AI Guard waits for SSH poll
    clear_forecast_cache()
    s_online = Settings(_env_file=None, network_driver="scrapli", forecast_url="")  # type: ignore[call-arg]
    fc_online = build_forecast(s_online, 1, "node-test.lab", "spine", "cpu_pct", 12)
    assert fc_online.history == []
    assert fc_online.median == []

    class DummyOnlineDev:
        id = 1
        hostname = "node-test.lab"
        role = "spine"

    verdict = AiTelemetryGuard(s_online).verify_execution(DummyOnlineDev(), metric="cpu_pct")
    assert verdict.healthy is True
    assert verdict.observed_value == 0.0
    assert verdict.expected_range == (0.0, 0.0)
    assert "Нет данных телеметрии" in verdict.message


def test_six_vendor_cli_metrics_and_single_point_forecast() -> None:
    from netops.services.forecast import clear_forecast_cache
    from netops.services.telemetry import collect_metrics_from_cli

    class FakeSession:
        def send_command(self, cmd: str) -> str:
            if "cpu" in cmd or "processes" in cmd:
                return "CPU utilization for five seconds: 11%/2%; one minute: 14%; five minutes: 9%"
            if "routing-engine" in cmd:
                return "    Idle                      82 percent"
            if "top -bn1" in cmd:
                return "%Cpu(s): 12.0 us,  3.0 sy,  0.0 ni, 85.0 id"
            if "counters rates" in cmd:  # YADRO KornfeOS: таблица утилизации в процентах
                return "Ethernet1/1  up  up  3.0%  2.0%"
            return "30 seconds input rate 0 bits/sec"

    s_online = Settings(_env_file=None, network_driver="scrapli", forecast_url="")  # type: ignore[call-arg]
    for vendor, host in (
        ("eltex_mes", "eltex-leaf.lab"),
        ("yadro_kornfe", "yadro-leaf.lab"),
        ("juniper_junos", "juniper-spine.lab"),
    ):
        clear_live_metrics(host)
        clear_forecast_cache()
        res = collect_metrics_from_cli(host, vendor, FakeSession().send_command)
        assert "cpu_pct" in res and res["cpu_pct"] > 0
        assert "uplink_util_pct" in res and res["uplink_util_pct"] >= 0.0
        fc = build_forecast(s_online, 1, host, "leaf", "cpu_pct", 12)
        assert len(fc.history) == 1
        assert len(fc.median) == 12
        clear_live_metrics(host)

