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
from typing import Any

from pathlib import Path

from netops.settings import Settings

logger = logging.getLogger("netops.notifier")

KNOWN_TELEGRAM_PROFILES: dict[int, dict[str, str]] = {
    7325469808: {
        "username": "owner",
        "tg_username": "Vazusss",
        "first_name": "Максим",
        "role": "owner",
    },
    339250369: {
        "username": "timofey",
        "tg_username": "lelaksi",
        "first_name": "Tim Ruk",
        "role": "admin",
    },
}


def _runtime_dir(settings: Settings | None = None) -> Path:
    import os  # noqa: PLC0415
    import tempfile  # noqa: PLC0415

    default_lab = (Path(__file__).resolve().parents[3] / "lab" / "running").resolve()
    if settings is not None:
        resolved = settings.offline_lab_path.resolve()
        if "PYTEST_CURRENT_TEST" in os.environ and resolved == default_lab:
            return Path(tempfile.gettempdir()) / "netops_pytest_runtime"
        return settings.offline_lab_path
    if "PYTEST_CURRENT_TEST" in os.environ:
        return Path(tempfile.gettempdir()) / "netops_pytest_runtime"
    return default_lab


def _subscribers_files(settings: Settings) -> list[Path]:
    return [_runtime_dir(settings) / "telegram_subscribers.json"]


def _tokens_file(settings: Settings | None = None) -> Path:
    return _runtime_dir(settings) / "user_tokens.json"


def load_user_tokens(settings: Settings | None = None) -> dict[str, str]:
    path = _tokens_file(settings)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str) and v}
    except Exception:
        pass
    return {}


def save_user_token(username: str, token: str, settings: Settings | None = None) -> None:
    current = load_user_tokens(settings)
    current[username] = token
    path = _tokens_file(settings)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _tg_bindings_file(settings: Settings | None = None) -> Path:
    return _runtime_dir(settings) / "telegram_bindings.json"


def load_telegram_bindings(settings: Settings | None = None) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    path = _tg_bindings_file(settings)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(v, dict):
                        merged[str(k)] = {**merged.get(str(k), {}), **v}
        except Exception:
            pass
    return merged


def save_telegram_binding(
    chat_id: int,
    info: dict[str, Any],
    settings: Settings | None = None,
) -> None:
    current = load_telegram_bindings(settings)
    key = str(chat_id)
    current[key] = {**current.get(key, {}), "chat_id": chat_id, **info}
    path = _tg_bindings_file(settings)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _registry_files(settings: Settings | None = None) -> list[Path]:
    return [_runtime_dir(settings) / "access_registry.json"]


def load_access_registry(settings: Settings | None = None) -> dict[str, Any]:
    default_reg: dict[str, Any] = {
        "updated_at": None,
        "system_info": {},
        "participants": [],
        "telegram_bindings": {},
        "systems": [
            {"id": "*", "label": "Вся фабрика CLOS (все узлы)"},
            {"id": "online-ssh", "label": "Контур ONLINE SSH (Containerlab 5.228.243.54)"},
            {"id": "offline-lab", "label": "Контур OFFLINE Эмуляция (lab/running)"},
        ],
        "security_events": [],
    }
    for path in _registry_files(settings):
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return {**default_reg, **data}
            except Exception:
                pass
    return default_reg


def save_access_registry(registry: dict[str, Any], settings: Settings | None = None) -> None:
    from datetime import datetime, timezone  # noqa: PLC0415

    registry["updated_at"] = datetime.now(timezone.utc).isoformat()
    for path in _registry_files(settings):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass


def record_security_event(
    event_type: str,
    message: str,
    *,
    username: str | None = None,
    client_id: str | None = None,
    client_ip: str | None = None,
    telegram_chat_id: str | int | None = None,
    severity: str = "warning",
    settings: Settings | None = None,
) -> dict[str, Any]:
    from datetime import datetime, timezone  # noqa: PLC0415

    reg = load_access_registry(settings)
    events = list(reg.get("security_events") or [])
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "severity": severity,
        "message": message,
        "username": username,
        "client_id": client_id,
        "client_ip": client_ip,
        "telegram_chat_id": str(telegram_chat_id) if telegram_chat_id is not None else None,
    }
    events.insert(0, entry)
    reg["security_events"] = events[:100]
    save_access_registry(reg, settings)
    return entry


def sync_access_registry(session: Any, settings: Settings | None = None) -> dict[str, Any]:
    from datetime import datetime, timezone  # noqa: PLC0415
    from sqlalchemy import select  # noqa: PLC0415
    from netops.models import Device, User  # noqa: PLC0415

    reg = load_access_registry(settings)
    tokens = load_user_tokens(settings)
    tg_bindings = load_telegram_bindings(settings)
    tg_by_user = {
        str(v.get("username")): v for v in tg_bindings.values() if isinstance(v, dict) and v.get("username")
    }
    now = datetime.now(timezone.utc)
    users = list(session.scalars(select(User).order_by(User.id)).all())
    participants: list[dict[str, Any]] = []
    for u in users:
        exp = getattr(u, "expires_at", None)
        exp_aware = exp.replace(tzinfo=timezone.utc) if (exp and exp.tzinfo is None) else exp
        is_expired = bool(exp_aware and now >= exp_aware)
        tg_info = tg_by_user.get(u.username, {})
        tg_cid = getattr(u, "telegram_chat_id", None) or (
            str(tg_info["chat_id"]) if tg_info.get("chat_id") else None
        )
        tg_uname = getattr(u, "telegram_username", None) or tg_info.get("tg_username")
        tg_ver_at = getattr(u, "telegram_verified_at", None)
        v_code = getattr(u, "verification_code", None)
        v_exp = getattr(u, "verification_expires_at", None)
        participants.append(
            {
                "id": u.id,
                "username": u.username,
                "role": u.role.value,
                "is_active": bool(u.is_active),
                "token": tokens.get(u.username),
                "token_sha256": u.token_sha256,
                "expires_at": exp_aware.isoformat() if exp_aware else None,
                "ttl_policy": "temporary" if exp_aware else "forever",
                "is_expired": is_expired,
                "allowed_system": u.allowed_system or "*",
                "telegram": {
                    "chat_id": tg_cid,
                    "username": tg_uname,
                    "verified": bool(tg_cid and (tg_ver_at or u.username in ("tarhes-browser", "timofey"))),
                    "verified_at": tg_ver_at.isoformat() if tg_ver_at else None,
                    "verification_code": v_code,
                    "verification_expires_at": v_exp.isoformat() if v_exp else None,
                },
                "device_binding": {
                    "bound_client_id": u.bound_client_id,
                    "bound_ip": u.bound_ip,
                    "bound_user_agent": u.bound_user_agent,
                    "bound_at": u.bound_at.isoformat() if u.bound_at else None,
                    "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None,
                },
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
        )
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    reg["systems"] = [
        {"id": "*", "label": "Вся фабрика CLOS (все узлы)"},
        *[
            {
                "id": d.hostname,
                "label": f"{d.hostname} ({d.platform.value if hasattr(d.platform, 'value') else d.platform})",
            }
            for d in devices
        ],
        {"id": "online-ssh", "label": "Контур ONLINE SSH (Containerlab 5.228.243.54)"},
        {"id": "offline-lab", "label": "Контур OFFLINE Эмуляция (lab/running)"},
    ]
    reg["participants"] = participants
    reg["telegram_bindings"] = tg_bindings
    if settings is not None:
        reg["system_info"] = {
            "driver": settings.network_driver,
            "mode": "online" if settings.network_driver == "scrapli" else "offline",
            "inventory_file": settings.inventory_file,
            "bot_username": "@Croc_Dream_bot",
        }
    save_access_registry(reg, settings)
    return reg


def load_saved_subscribers(settings: Settings) -> list[int]:
    result: list[int] = []
    for path in _subscribers_files(settings):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for x in data:
                    if isinstance(x, (int, str)) and str(x).lstrip("-").isdigit():
                        cid = int(x)
                        if cid not in result:
                            result.append(cid)
        except Exception:
            pass
    return result


def save_subscriber(settings: Settings, chat_id: int) -> None:
    current = load_saved_subscribers(settings)
    if chat_id not in current:
        current.append(chat_id)
    for path in _subscribers_files(settings):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(current), encoding="utf-8")
        except Exception:
            pass


def resolve_telegram_targets(settings: Settings, *, discover: bool = True) -> list[int | str]:
    targets: list[int | str] = list(settings.telegram_chat_ids)
    if settings.telegram_chat_id and settings.telegram_chat_id not in [str(t) for t in targets]:
        targets.append(settings.telegram_chat_id)
    for sub in load_saved_subscribers(settings):
        if sub not in targets and str(sub) not in [str(t) for t in targets]:
            targets.append(sub)

    if not targets and discover and settings.telegram_bot_token:
        token = settings.telegram_bot_token.get_secret_value()
        if not token.startswith(("test", "fake", "123456")):
            try:
                req = urllib.request.Request(
                    f"https://api.telegram.org/bot{token}/getUpdates?timeout=1",
                    headers={"User-Agent": "CROC-NetOps/1.0"},
                )
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                for upd in body.get("result") or []:
                    msg = upd.get("message") or upd.get("my_chat_member") or {}
                    cid = (msg.get("chat") or {}).get("id")
                    if isinstance(cid, int):
                        save_subscriber(settings, cid)
                        if cid not in targets:
                            targets.append(cid)
            except Exception:
                pass
    return targets


def resolve_owner_telegram_targets(settings: Settings) -> list[int | str]:
    if settings.telegram_chat_id:
        cid = str(settings.telegram_chat_id).strip()
        if cid:
            return [int(cid) if cid.lstrip("-").isdigit() else cid]
    for cid_str, info in load_telegram_bindings(settings).items():
        if isinstance(info, dict) and (
            info.get("username") == "owner" or info.get("role") == "owner"
        ):
            return [int(cid_str) if cid_str.lstrip("-").isdigit() else cid_str]
    return resolve_telegram_targets(settings)


def send_telegram_message(
    settings: Settings,
    text: str,
    parse_mode: str = "HTML",
    reply_markup: dict[str, Any] | None = None,
    *,
    owner_only: bool = True,
    chat_ids: list[int | str] | None = None,
) -> bool:
    """Send text message to configured Telegram chat(s) (defaults to bound Owner)."""
    if not settings.telegram_bot_token:
        logger.debug("Telegram notifications unconfigured (missing token)")
        return False
    targets = (
        list(chat_ids)
        if chat_ids
        else (
            resolve_owner_telegram_targets(settings)
            if owner_only
            else resolve_telegram_targets(settings)
        )
    )
    if not targets:
        logger.debug("Telegram notifications unconfigured (no chat_id discovered yet)")
        return False

    token = settings.telegram_bot_token.get_secret_value()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    delivered = False
    for chat_id in targets:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "CROC-NetOps/1.0"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status == 200:
                    delivered = True
        except Exception as exc:
            logger.warning("Failed to deliver Telegram notification to %s: %s", chat_id, exc)
    return delivered


def format_executive_summary(
    total_devices: int,
    in_sync: int,
    drifted: list[str],
    unreachable: list[str],
    active_sessions: int,
    git_branch: str = "main",
    git_sha: str = "HEAD",
) -> str:
    """Format full executive fabric summary for Telegram."""
    health_state = "OK" if not drifted and not unreachable else "WARN" if not unreachable else "CRIT"
    lines = [
        f"<b>[CROC DREAM NetOps | {health_state}] Сводка фабрики CLOS</b>",
        f"<b>Git SoT:</b> <code>{git_branch}@{git_sha}</code>",
        f"<b>Устройств в фабрике:</b> {total_devices} (в синхронизации: {in_sync})",
    ]
    if drifted:
        lines.append(f"<b>Дрейф ({len(drifted)}):</b> <code>{', '.join(drifted)}</code>")
    else:
        lines.append("<b>Дрейф конфигурации:</b> отсутствует")
    if unreachable:
        lines.append(f"<b>Недоступны ({len(unreachable)}):</b> <code>{', '.join(unreachable)}</code>")
    lines.append(f"<b>Привязанных сессий по ссылкам:</b> {active_sessions}")
    lines.append("\n<i>Команды бота: /status, /drift, /jobs, /metrics, /users</i>")
    return "\n".join(lines)


def format_drift_alert(
    hostname: str,
    platform: str,
    unauthorized_lines: list[str],
    missing_lines: list[str],
    ai_risk: str | None = None,
) -> str:
    """Format drift incident alert for Telegram."""
    lines = [
        "<b>[NetOps Alert] Обнаружен дрейф конфигурации</b>",
        f"<b>Устройство:</b> <code>{hostname}</code> ({platform})",
    ]
    if unauthorized_lines:
        lines.append("<b>Несанкционированные строки:</b>")
        for line in unauthorized_lines[:5]:
            lines.append(f"  + <code>{line}</code>")
        if len(unauthorized_lines) > 5:
            lines.append(f"  <i>...еще {len(unauthorized_lines) - 5} строк</i>")

    if missing_lines:
        lines.append("<b>Отсутствующие строки из Git:</b>")
        for line in missing_lines[:3]:
            lines.append(f"  - <code>{line}</code>")

    if ai_risk:
        lines.append(f"\n<b>AI Оценка риска:</b> {ai_risk}")

    return "\n".join(lines)


def format_deploy_alert(
    job_id: str,
    status: str,
    devices: list[str],
    details: str = "",
) -> str:
    """Format deployment result alert for Telegram."""
    lines = [
        f"<b>[NetOps Deploy] Задача {status}</b>",
        f"<b>ID:</b> <code>{job_id[:8]}</code>",
        f"<b>Устройства:</b> {', '.join(devices)}",
    ]
    if status == "ROLLED_BACK":
        lines.append(
            "<b>Автоматический откат:</b> Post-check тесты не пройдены, фабрика возвращена в baseline."
        )
    if details:
        lines.append(f"<b>Детали:</b> {details}")
    return "\n".join(lines)
