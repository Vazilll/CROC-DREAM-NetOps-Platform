from __future__ import annotations

from unittest.mock import patch

from netops.services.notifier import format_deploy_alert, format_drift_alert, send_telegram_message
from netops.settings import Settings


def test_telegram_unconfigured_returns_false() -> None:
    settings = Settings(telegram_bot_token=None, telegram_chat_id=None)
    assert send_telegram_message(settings, "Test") is False


def test_format_drift_alert() -> None:
    text = format_drift_alert(
        hostname="leaf-1",
        platform="cisco_iosxe",
        unauthorized_lines=["15 permit ip any any"],
        missing_lines=[],
        ai_risk="HIGH: Unauthorized permit rule",
    )
    assert "leaf-1" in text
    assert "15 permit ip any any" in text
    assert "AI Оценка риска" in text


def test_format_deploy_alert() -> None:
    text = format_deploy_alert(
        job_id="12345678-abcd",
        status="ROLLED_BACK",
        devices=["leaf-1", "spine-1"],
        details="Post-check BGP failed",
    )
    assert "ROLLED_BACK" in text
    assert "leaf-1" in text
    assert "Автоматический откат" in text
