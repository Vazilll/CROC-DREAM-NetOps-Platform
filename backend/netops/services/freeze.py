"""Emergency Factory Freeze (Kill Switch) state management."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

_freeze_state: dict[str, Any] = {
    "frozen": False,
    "reason": "Штатная эксплуатация (заморозка выключена)",
    "timestamp": None,
    "user": None,
}


def is_factory_frozen() -> bool:
    return bool(_freeze_state.get("frozen", False))


def get_freeze_state() -> dict[str, Any]:
    return dict(_freeze_state)


def set_factory_freeze(
    frozen: bool, reason: str | None = None, user: str | None = None
) -> dict[str, Any]:
    _freeze_state["frozen"] = frozen
    _freeze_state["reason"] = (
        reason or ("Заморозка активирована оператором" if frozen else "Штатная эксплуатация")
    )
    _freeze_state["timestamp"] = datetime.now(UTC).isoformat()
    _freeze_state["user"] = user or "operator"
    if frozen:
        logger.warning("EMERGENCY FACTORY FREEZE ACTIVATED by %s: %s", user, reason)
    else:
        logger.info("Factory freeze deactivated by %s", user)
    return dict(_freeze_state)
