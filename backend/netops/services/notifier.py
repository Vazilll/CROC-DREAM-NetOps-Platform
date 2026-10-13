"""Telegram and Webhook Notification Dispatcher for NetOps Platform.

Provides incident alerting (Drift Detected, Deploy Rollback, Chaos Events)
and AI-generated executive network summaries via Telegram Bot API.
Standard library only (urllib.request).
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from netops.settings import Settings

logger = logging.getLogger("netops.notifier")


# Токен и чаты те же, что у бота: NETOPS_TELEGRAM_BOT_TOKEN и NETOPS_TELEGRAM_CHAT_IDS.
def send_telegram_message(
    settings: Settings,
    text: str,
    parse_mode: str = "HTML",
) -> bool:
    if not settings.telegram_bot_token or not settings.telegram_chat_ids:
        logger.debug("Telegram notifications unconfigured (missing token or chat ids)")
        return False
    return all(_send(settings, chat_id, text, parse_mode) for chat_id in settings.telegram_chat_ids)


def _send(settings: Settings, chat_id: int, text: str, parse_mode: str) -> bool:
    token = settings.telegram_bot_token.get_secret_value() if settings.telegram_bot_token else ""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "CROC-NetOps/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return bool(resp.status == 200)
    except Exception as exc:
        logger.warning("Failed to deliver Telegram notification: %s", exc)
        return False


def format_drift_alert(
    hostname: str,
    platform: str,
    unauthorized_lines: list[str],
    missing_lines: list[str],
    ai_risk: str | None = None,
) -> str:
    """Format drift incident alert for Telegram."""
    lines = [
        "🚨 <b>[NetOps Alert] Обнаружен дрейф конфигурации</b>",
        f"<b>Устройство:</b> <code>{hostname}</code> ({platform})",
    ]
    if unauthorized_lines:
        lines.append("<b>Несанкционированные строки:</b>")
        for line in unauthorized_lines[:5]:
            lines.append(f"  🔴 <code>{line}</code>")
        if len(unauthorized_lines) > 5:
            lines.append(f"  <i>...еще {len(unauthorized_lines) - 5} строк</i>")

    if missing_lines:
        lines.append("<b>Отсутствующие строки из Git:</b>")
        for line in missing_lines[:3]:
            lines.append(f"  🟡 <code>{line}</code>")

    if ai_risk:
        lines.append(f"\n🧠 <b>AI Оценка риска:</b> {ai_risk}")

    lines.append("\n👉 <i>Рекомендация: Откройте веб-консоль для запуска авто-ремедиации.</i>")
    return "\n".join(lines)


def format_deploy_alert(
    job_id: str,
    status: str,
    devices: list[str],
    details: str = "",
) -> str:
    """Format deployment result alert for Telegram."""
    icon = "✅" if status == "SUCCESS" else "⚠️" if status == "ROLLED_BACK" else "❌"
    lines = [
        f"{icon} <b>[NetOps Deploy] Задача {status}</b>",
        f"<b>ID:</b> <code>{job_id[:8]}</code>",
        f"<b>Устройства:</b> {', '.join(devices)}",
    ]
    if status == "ROLLED_BACK":
        lines.append(
            "⚡ <b>Автоматический откат:</b> post-check не пройден, "
            "конфигурация возвращена к прежней."
        )
    if details:
        lines.append(f"<b>Детали:</b> {details}")
    return "\n".join(lines)
