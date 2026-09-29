"""Shared scenario helpers for integration tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def edit_intent(intent_repo: Path, hostname: str, **changes: Any) -> dict[str, Any]:
    """Apply top-level changes to a device intent file and return the new data."""
    path = intent_repo / "devices" / f"{hostname}.yaml"
    data: dict[str, Any] = yaml.safe_load(path.read_text())
    data.update(changes)
    path.write_text(yaml.safe_dump(data, sort_keys=False))
    return data


def change_uplink_description(intent_repo: Path, hostname: str, description: str) -> None:
    path = intent_repo / "devices" / f"{hostname}.yaml"
    data = yaml.safe_load(path.read_text())
    data["interfaces"][1]["description"] = description
    path.write_text(yaml.safe_dump(data, sort_keys=False))


def append_to_running_config(lab_path: Path, hostname: str, text: str) -> None:
    path = lab_path / f"{hostname}.cfg"
    path.write_text(path.read_text() + text)
