"""Reading the intent Git repository.

Layout of the repository::

    inventory.yaml            # devices: [{hostname, management_ip, platform, ...}]
    devices/<hostname>.yaml   # DeviceIntent: interfaces, bgp, acls
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import yaml
from pydantic import BaseModel, ValidationError

from netops.intent.lint import (
    IntentIssue,
    IntentValidationError,
    issues_from_validation_error,
    lint_fabric,
)
from netops.intent.models import DeviceIntent, Inventory

INVENTORY_FILE = "inventory.yaml"
DEVICES_DIR = "devices"
_YAML_SUFFIXES = (".yaml", ".yml")

ModelT = TypeVar("ModelT", bound=BaseModel)


@dataclass(frozen=True)
class IntentSnapshot:
    """A validated, internally consistent view of the whole Source of Truth."""

    inventory: Inventory
    intents: Mapping[str, DeviceIntent] = field(default_factory=dict)

    def intent_for(self, hostname: str) -> DeviceIntent | None:
        return self.intents.get(hostname)


class IntentRepository:
    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def load(self) -> IntentSnapshot:
        """Load and lint everything; raise :class:`IntentValidationError` on any issue."""
        inventory, intents, issues = self._collect()
        if issues or inventory is None:
            raise IntentValidationError(issues)
        return IntentSnapshot(inventory=inventory, intents=intents)

    def lint(self) -> list[IntentIssue]:
        return self._collect()[2]

    def load_inventory(self) -> Inventory:
        issues: list[IntentIssue] = []
        inventory = self._parse_inventory(issues)
        if inventory is None:
            raise IntentValidationError(issues)
        return inventory

    def load_device_intent(self, hostname: str) -> DeviceIntent | None:
        """Parse a single device file without fabric-wide checks (for the device card)."""
        path = self._device_file(hostname)
        if path is None:
            return None
        issues: list[IntentIssue] = []
        intent = self._parse_file(path, DeviceIntent, issues)
        if intent is None:
            raise IntentValidationError(issues)
        return intent

    def _collect(self) -> tuple[Inventory | None, dict[str, DeviceIntent], list[IntentIssue]]:
        issues: list[IntentIssue] = []
        if not self._root.is_dir():
            issues.append(IntentIssue(".", "", f"Intent repository {self._root} does not exist"))
            return None, {}, issues

        inventory = self._parse_inventory(issues)
        intents: dict[str, DeviceIntent] = {}
        for path in self._device_files():
            intent = self._parse_file(path, DeviceIntent, issues)
            if intent is None:
                continue
            source = self._relative(path)
            if intent.hostname != path.stem:
                issues.append(
                    IntentIssue(
                        source,
                        "hostname",
                        f"Hostname {intent.hostname!r} does not match the file name",
                        intent.hostname,
                        "hostname_mismatch",
                    )
                )
            elif intent.hostname in intents:
                issues.append(
                    IntentIssue(
                        source,
                        "hostname",
                        "Device intent is declared in more than one file",
                        intent.hostname,
                        "duplicate_hostname",
                    )
                )
            else:
                intents[intent.hostname] = intent

        if inventory is not None:
            known = {device.hostname for device in inventory.devices}
            issues.extend(
                IntentIssue(
                    f"{DEVICES_DIR}/{hostname}.yaml",
                    "hostname",
                    "Device is not declared in the inventory",
                    hostname,
                    "unknown_device",
                )
                for hostname in sorted(intents.keys() - known)
            )
        issues.extend(lint_fabric(intents.values()))
        return inventory, intents, issues

    def _parse_inventory(self, issues: list[IntentIssue]) -> Inventory | None:
        path = self._root / INVENTORY_FILE
        if not path.is_file():
            issues.append(IntentIssue(INVENTORY_FILE, "", "Inventory file is missing"))
            return None
        return self._parse_file(path, Inventory, issues)

    def _parse_file(
        self, path: Path, model: type[ModelT], issues: list[IntentIssue]
    ) -> ModelT | None:
        source = self._relative(path)
        try:
            data: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
            issues.append(IntentIssue(source, "", f"Cannot read YAML: {exc}", code="yaml_error"))
            return None
        if data is None:
            issues.append(IntentIssue(source, "", "File is empty", code="empty_file"))
            return None
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            hostname = data.get("hostname") if isinstance(data, dict) else None
            issues.extend(
                issues_from_validation_error(
                    exc, source=source, hostname=hostname if isinstance(hostname, str) else None
                )
            )
            return None

    def _device_files(self) -> list[Path]:
        directory = self._root / DEVICES_DIR
        if not directory.is_dir():
            return []
        return sorted(p for p in directory.iterdir() if p.is_file() and p.suffix in _YAML_SUFFIXES)

    def _device_file(self, hostname: str) -> Path | None:
        directory = (self._root / DEVICES_DIR).resolve()
        for suffix in _YAML_SUFFIXES:
            path = (directory / f"{hostname}{suffix}").resolve()
            if path.parent == directory and path.is_file():
                return path
        return None

    def _relative(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self._root.resolve()).as_posix()
        except ValueError:
            return path.as_posix()
