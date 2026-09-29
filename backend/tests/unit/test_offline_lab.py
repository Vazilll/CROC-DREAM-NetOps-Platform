from __future__ import annotations

from pathlib import Path

import pytest

from netops.enums import Platform
from netops.network import (
    ChangePlan,
    Credentials,
    DeviceTarget,
    HealthExpectations,
    HealthSnapshot,
    OfflineLab,
    evaluate_health,
)

PLAN = ChangePlan(
    remediation="hostname new\n", rollback="hostname old\n", intended="hostname new\n"
)


def _target(hostname: str) -> DeviceTarget:
    return DeviceTarget(hostname, Platform.ARISTA_EOS, "127.0.0.1", 2201, Credentials("u", "p"))


@pytest.fixture
def lab(tmp_path: Path) -> OfflineLab:
    (tmp_path / "up.cfg").write_text("hostname old\n")
    return OfflineLab(tmp_path)


def test_fetch(lab: OfflineLab) -> None:
    results = lab.fetch_running_configs([_target("up"), _target("down")])
    assert results["up"].config == "hostname old\n"
    assert results["down"].config is None
    assert "unreachable" in (results["down"].error or "")


def test_apply_then_confirm_writes_the_intended_config(lab: OfflineLab, tmp_path: Path) -> None:
    lab.apply(_target("up"), PLAN, confirm_timeout=180)
    assert (tmp_path / "up.cfg").read_text() == "hostname old\n"
    lab.confirm(_target("up"))
    assert (tmp_path / "up.cfg").read_text() == "hostname new\n"


def test_apply_then_rollback_keeps_the_running_config(lab: OfflineLab, tmp_path: Path) -> None:
    lab.apply(_target("up"), PLAN, confirm_timeout=180)
    lab.rollback(_target("up"), PLAN)
    assert (tmp_path / "up.cfg").read_text() == "hostname old\n"
    with pytest.raises(RuntimeError, match="No pending transaction"):
        lab.confirm(_target("up"))


def test_unreachable_device(lab: OfflineLab) -> None:
    with pytest.raises(ConnectionError):
        lab.apply(_target("down"), PLAN, confirm_timeout=180)
    with pytest.raises(ConnectionError):
        lab.snapshot(_target("down"), None)


def test_health_snapshot_without_expectations_is_empty(lab: OfflineLab) -> None:
    snapshot = lab.snapshot(_target("up"), None)
    assert not snapshot.bgp_sessions
    assert not snapshot.interfaces


def test_health_snapshot_satisfies_expectations(lab: OfflineLab) -> None:
    expected = HealthExpectations(
        bgp_peers=("10.0.1.1",), interfaces={"Ethernet1": True, "Ethernet9": False}
    )
    snapshot = lab.snapshot(_target("up"), expected)
    assert snapshot.bgp_sessions["10.0.1.1"].established
    assert snapshot.interfaces["Ethernet1"].is_up
    assert not snapshot.interfaces["Ethernet9"].is_up
    assert snapshot.ping_loss_percent == {"10.0.1.1": 0.0}
    assert evaluate_health(HealthSnapshot(), snapshot, expected=expected).healthy


def test_credentials_are_not_printed() -> None:
    target = DeviceTarget(
        "up", Platform.ARISTA_EOS, "10.0.0.1", 22, Credentials("admin", "hunter2")
    )
    assert "hunter2" not in repr(target)
    assert "hunter2" not in repr(target.credentials)
