"""Contracts between the backend pipeline and the network layer.

The pipeline only talks to devices through these protocols. The Scrapli/Nornir
driver (integrations) and the Jinja2 templates (lab) plug in here without
touching the job orchestration code.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from netops.enums import Platform
from netops.intent.models import DeviceIntent, InventoryDevice


@dataclass(frozen=True, slots=True)
class Credentials:
    username: str
    password: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class DeviceTarget:
    """Everything a driver needs to open a management session to a device."""

    hostname: str
    platform: Platform
    host: str
    port: int
    credentials: Credentials = field(repr=False)


@dataclass(frozen=True, slots=True)
class FetchResult:
    """Outcome of collecting the running-config of one device."""

    config: str | None = None
    error: str | None = None

    @classmethod
    def success(cls, config: str) -> FetchResult:
        return cls(config=config)

    @classmethod
    def failure(cls, error: str) -> FetchResult:
        return cls(error=error)


@dataclass(frozen=True, slots=True)
class ChangePlan:
    """What to push to a device and how to undo it."""

    remediation: str
    rollback: str
    intended: str


@dataclass(frozen=True, slots=True)
class ConfigDiff:
    remediation: str
    rollback: str
    unauthorized_lines: tuple[str, ...] = ()
    missing_lines: tuple[str, ...] = ()

    @property
    def has_changes(self) -> bool:
        return bool(self.remediation.strip())

    @property
    def in_sync(self) -> bool:
        return not (self.has_changes or self.unauthorized_lines or self.missing_lines)


@dataclass(frozen=True, slots=True)
class BgpSessionState:
    state: str
    prefixes_accepted: int | None = None

    @property
    def established(self) -> bool:
        return self.state.strip().lower() == "established"


@dataclass(frozen=True, slots=True)
class InterfaceState:
    status: str
    protocol: str

    @property
    def is_up(self) -> bool:
        return self.status.strip().lower() == "up" and self.protocol.strip().lower() == "up"

    def __str__(self) -> str:
        return f"{self.status}/{self.protocol}"


@dataclass(frozen=True, slots=True)
class HealthSnapshot:
    """Operational state used by pre/post deployment checks (spec 2.6)."""

    bgp_sessions: Mapping[str, BgpSessionState] = field(default_factory=dict)
    interfaces: Mapping[str, InterfaceState] = field(default_factory=dict)
    ping_loss_percent: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HealthExpectations:
    """What the intent declares for a device, used to judge the post-check.

    ``interfaces`` maps every declared interface to whether it is enabled.
    """

    bgp_peers: tuple[str, ...] = ()
    interfaces: Mapping[str, bool] = field(default_factory=dict)

    @classmethod
    def from_intent(cls, intent: DeviceIntent) -> HealthExpectations:
        peers = tuple(str(n.peer_ip) for n in intent.bgp.neighbors) if intent.bgp else ()
        return cls(
            bgp_peers=peers,
            interfaces={interface.name: interface.enabled for interface in intent.interfaces},
        )

    def to_json(self) -> dict[str, Any]:
        return {"bgp_peers": list(self.bgp_peers), "interfaces": dict(self.interfaces)}

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> HealthExpectations:
        return cls(
            bgp_peers=tuple(data.get("bgp_peers", ())),
            interfaces=dict(data.get("interfaces", {})),
        )


@runtime_checkable
class ConfigRenderer(Protocol):
    def render(self, device: InventoryDevice, intent: DeviceIntent) -> str:
        """Render the full intended configuration of a device."""


@runtime_checkable
class DiffEngine(Protocol):
    def compare(self, platform: Platform, running: str, intended: str) -> ConfigDiff:
        """Compute remediation/rollback patches between two normalized configs."""


@runtime_checkable
class ConfigCollector(Protocol):
    def fetch_running_configs(self, targets: Sequence[DeviceTarget]) -> Mapping[str, FetchResult]:
        """Collect running-configs, ideally in parallel; keyed by hostname.

        Per-device failures must be reported as ``FetchResult.failure`` rather
        than raised, so that one unreachable device does not abort the batch.
        """


@runtime_checkable
class ConfigDeployer(Protocol):
    """Transactional delivery of a change (spec 2.4, stage 3)."""

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        """Push ``plan.remediation`` inside a revertible transaction.

        Cisco IOS-XE: ``configure terminal`` + ``commit confirmed <timeout>``;
        Arista EOS: ``configure session`` + ``commit timer``.
        """

    def confirm(self, target: DeviceTarget) -> None:
        """Make the pending transaction permanent."""

    def rollback(self, target: DeviceTarget, plan: ChangePlan) -> None:
        """Abort the pending transaction, or push ``plan.rollback`` if it is gone."""


@runtime_checkable
class HealthProbe(Protocol):
    def snapshot(self, target: DeviceTarget, expected: HealthExpectations | None) -> HealthSnapshot:
        """Run ``show ip bgp summary``, ``show ip interface brief`` and pings.

        ``expected`` lists the declared BGP peers, which are also the adjacent
        nodes to ping (5 packets each); it is ``None`` when the intent is unknown.
        """
