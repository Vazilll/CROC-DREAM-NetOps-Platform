"""Emergency Factory Freeze (Kill Switch) state management."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from netops.settings import get_settings

logger = logging.getLogger(__name__)

REDIS_FREEZE_KEY = "netops:factory_freeze"
REDIS_FABRIC_FREEZE_PREFIX = "netops:factory_freeze:fabric:"

_local_freeze_state: dict[str, Any] = {
    "frozen": False,
    "reason": "Штатная эксплуатация (заморозка выключена)",
    "timestamp": None,
    "user": None,
    "updated_by": None,
}
_local_fabric_freeze: dict[str, dict[str, Any]] = {}


def _reset_local_freeze() -> None:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    get_state_manager().reset_factory_freeze()
    _local_freeze_state.update({
        "frozen": False,
        "reason": "Штатная эксплуатация (заморозка выключена)",
        "timestamp": None,
        "user": None,
        "updated_by": None,
    })
    _local_fabric_freeze.clear()


def _get_redis_client():
    from netops.services.state import get_state_manager  # noqa: PLC0415

    return get_state_manager()._get_redis()


def is_factory_frozen(fabric_id: str | None = None) -> bool:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    return get_state_manager().is_factory_frozen(fabric_id=fabric_id)


def get_freeze_state(fabric_id: str | None = None) -> dict[str, Any]:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    state = get_state_manager().get_factory_freeze(fabric_id=fabric_id)
    if fabric_id:
        _local_fabric_freeze[fabric_id] = state
    else:
        _local_freeze_state.update({k: v for k, v in state.items() if k != "fabrics"})
        if "fabrics" in state:
            _local_fabric_freeze.update(state["fabrics"])
    return state


def set_factory_freeze(
    frozen: bool,
    reason: str | None = None,
    user: str | None = None,
    fabric_id: str | None = None,
) -> dict[str, Any]:
    from netops.services.state import get_state_manager  # noqa: PLC0415

    actor = user or "operator"
    res = get_state_manager().set_factory_freeze(
        frozen=frozen,
        reason=reason or "",
        user=actor,
        fabric_id=fabric_id,
    )
    if fabric_id:
        _local_fabric_freeze[fabric_id] = res
    else:
        _local_freeze_state.update(res)
    return res


def set_freeze_state(
    frozen: bool, reason: str = "", by: str = "admin", fabric_id: str | None = None
) -> dict[str, Any]:
    return set_factory_freeze(frozen=frozen, reason=reason, user=by, fabric_id=fabric_id)



