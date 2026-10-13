"""Unit tests for TimesFM 3.0 AI Telemetry Guard runtime error detection."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from netops.models import Device
from netops.services.ai_guard import AiGuardVerdict, AiTelemetryGuard
from netops.settings import Settings


@pytest.fixture
def mock_settings() -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        forecast_url="",  # Use deterministic statistical fallback for predictable unit test results
    )


@pytest.fixture
def dummy_device() -> Device:
    dev = MagicMock(spec=Device)
    dev.id = 1
    dev.hostname = "leaf-1.croc.lab"
    dev.role = "leaf"
    dev.platform = "cisco_iosxe"
    return dev


def test_ai_guard_nominal_telemetry(mock_settings: Settings, dummy_device: Device) -> None:
    guard = AiTelemetryGuard(mock_settings)
    guard.inject_anomaly(dummy_device.hostname, "clear")

    verdict = guard.verify_execution(dummy_device)
    assert verdict.healthy is True
    assert verdict.problem is None
    assert "Телеметрия в норме" in verdict.message
    assert verdict.observed_value >= verdict.expected_range[0] * 0.4


def test_ai_guard_detects_blackhole_drop(mock_settings: Settings, dummy_device: Device) -> None:
    guard = AiTelemetryGuard(mock_settings)
    guard.inject_anomaly(dummy_device.hostname, "blackhole")

    verdict = guard.verify_execution(dummy_device)
    assert verdict.healthy is False
    assert verdict.problem is not None
    assert "Критическое падение трафика" in verdict.problem
    assert "Blackhole" in verdict.problem

    # Clean up injection
    guard.inject_anomaly(dummy_device.hostname, "clear")


def test_ai_guard_detects_load_surge_storm(mock_settings: Settings, dummy_device: Device) -> None:
    guard = AiTelemetryGuard(mock_settings)
    guard.inject_anomaly(dummy_device.hostname, "storm")

    verdict = guard.verify_execution(dummy_device)
    assert verdict.healthy is False
    assert verdict.problem is not None
    assert "Аномальный всплеск нагрузки" in verdict.problem

    # Clean up injection
    guard.inject_anomaly(dummy_device.hostname, "clear")


def test_ai_guard_preflight(mock_settings: Settings, dummy_device: Device) -> None:
    guard = AiTelemetryGuard(mock_settings)
    ok, reason = guard.check_preflight(dummy_device)
    assert isinstance(ok, bool)
    assert isinstance(reason, str)
