"""Emergency Factory Freeze (Kill Switch) state management."""

from __future__ import annotations

from typing import Any

from netops.constants import const
from netops.services.state import get_state_manager


def _reset_local_freeze() -> None:
    get_state_manager().reset_factory_freeze()


def is_factory_frozen(fabric_id: str | None = None) -> bool:
    return get_state_manager().is_factory_frozen(fabric_id=fabric_id)


def get_freeze_state(fabric_id: str | None = None) -> dict[str, Any]:
    return get_state_manager().get_factory_freeze(fabric_id=fabric_id)


def set_factory_freeze(
    frozen: bool,
    reason: str | None = None,
    user: str | None = None,
    fabric_id: str | None = None,
) -> dict[str, Any]:
    return get_state_manager().set_factory_freeze(
        frozen=frozen,
        reason=reason or "",
        user=user or str(const("audit.default_freeze_user")),
        fabric_id=fabric_id,
    )


def set_freeze_state(
    frozen: bool, reason: str = "", by: str | None = None, fabric_id: str | None = None
) -> dict[str, Any]:
    return set_factory_freeze(
        frozen=frozen,
        reason=reason,
        user=by or str(const("audit.default_actor")),
        fabric_id=fabric_id,
    )
