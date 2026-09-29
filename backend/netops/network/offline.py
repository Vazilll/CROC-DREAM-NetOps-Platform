"""File-backed emulation of the lab, for development and demos without Containerlab."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from netops.network.base import ChangePlan, DeviceTarget, FetchResult, HealthSnapshot


class OfflineLab:
    """Implements every network protocol on top of ``<root>/<hostname>.cfg`` files.

    * a missing file means the device is unreachable;
    * ``apply`` stages the intended config, ``confirm`` writes it to the file and
      ``rollback`` discards it — the same semantics as ``commit confirmed``;
    * health snapshots are empty, so post-checks always pass.
    """

    SUFFIX = ".cfg"

    def __init__(self, root: Path) -> None:
        self._root = root
        self._staged: dict[str, str] = {}

    def fetch_running_configs(self, targets: Sequence[DeviceTarget]) -> dict[str, FetchResult]:
        results: dict[str, FetchResult] = {}
        for target in targets:
            path = self._path(target)
            if path.is_file():
                results[target.hostname] = FetchResult.success(path.read_text(encoding="utf-8"))
            else:
                results[target.hostname] = FetchResult.failure(
                    f"{target.host}:{target.port} is unreachable (no {path.name} in offline lab)"
                )
        return results

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        self._ensure_reachable(target)
        self._staged[target.hostname] = plan.intended

    def confirm(self, target: DeviceTarget) -> None:
        try:
            config = self._staged.pop(target.hostname)
        except KeyError:
            raise RuntimeError(f"No pending transaction on {target.hostname}") from None
        self._path(target).write_text(config, encoding="utf-8")

    def rollback(self, target: DeviceTarget, plan: ChangePlan) -> None:
        self._staged.pop(target.hostname, None)

    def snapshot(self, target: DeviceTarget) -> HealthSnapshot:
        self._ensure_reachable(target)
        return HealthSnapshot()

    def _ensure_reachable(self, target: DeviceTarget) -> None:
        if not self._path(target).is_file():
            raise ConnectionError(f"{target.host}:{target.port} is unreachable")

    def _path(self, target: DeviceTarget) -> Path:
        return self._root / f"{target.hostname}{self.SUFFIX}"
