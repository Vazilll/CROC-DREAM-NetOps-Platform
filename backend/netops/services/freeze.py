"""Emergency Factory Freeze (Kill Switch) state management."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from netops.settings import get_settings

logger = logging.getLogger(__name__)

REDIS_FREEZE_KEY = "netops:factory_freeze"

_local_freeze_state: dict[str, Any] = {
    "frozen": False,
    "reason": "Штатная эксплуатация (заморозка выключена)",
    "timestamp": None,
    "user": None,
}


def _get_redis_client():
    try:
        import redis  # noqa: PLC0415
        settings = get_settings()
        return redis.Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=1.0)
    except Exception:
        return None


def is_factory_frozen() -> bool:
    return bool(get_freeze_state().get("frozen", False))


def get_freeze_state() -> dict[str, Any]:
    client = _get_redis_client()
    if client:
        try:
            raw = client.get(REDIS_FREEZE_KEY)
            if raw:
                return json.loads(raw)
        except Exception as exc:
            logger.debug("Redis unavailable for freeze state check: %s", exc)
    return dict(_local_freeze_state)


def set_factory_freeze(
    frozen: bool, reason: str | None = None, user: str | None = None
) -> dict[str, Any]:
    default_reason = (
        "Заморозка активирована оператором" if frozen else "Штатная эксплуатация"
    )
    state = {
        "frozen": frozen,
        "reason": reason or default_reason,
        "timestamp": datetime.now(UTC).isoformat(),
        "user": user or "operator",
    }
    _local_freeze_state.update(state)


    client = _get_redis_client()
    if client:
        try:
            client.set(REDIS_FREEZE_KEY, json.dumps(state))
        except Exception as exc:
            logger.warning("Failed to persist freeze state to Redis: %s", exc)

    if frozen:
        logger.warning("EMERGENCY FACTORY FREEZE ACTIVATED by %s: %s", user, reason)
    else:
        logger.info("Factory freeze deactivated by %s", user)
    return dict(state)

