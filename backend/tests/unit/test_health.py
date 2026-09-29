from __future__ import annotations

import pytest

from netops.network import BgpSessionState, HealthSnapshot, InterfaceState, evaluate_health

UP = InterfaceState("up", "up")
DOWN = InterfaceState("down", "down")
ESTABLISHED = BgpSessionState("Established", prefixes_accepted=3)


def _snapshot(
    bgp: dict[str, BgpSessionState] | None = None,
    interfaces: dict[str, InterfaceState] | None = None,
    ping: dict[str, float] | None = None,
) -> HealthSnapshot:
    return HealthSnapshot(
        bgp_sessions=bgp or {}, interfaces=interfaces or {}, ping_loss_percent=ping or {}
    )


def test_unchanged_healthy_fabric() -> None:
    before = _snapshot({"10.0.1.0": ESTABLISHED}, {"Gi2": UP}, {"10.0.1.0": 0.0})
    verdict = evaluate_health(before, before)
    assert verdict.healthy
    assert verdict.problems == ()


@pytest.mark.parametrize("state", ["Active", "Idle", "Connect", "OpenSent"])
def test_established_session_that_drops_is_a_degradation(state: str) -> None:
    verdict = evaluate_health(
        _snapshot({"10.0.1.0": ESTABLISHED}), _snapshot({"10.0.1.0": BgpSessionState(state)})
    )
    assert verdict.problems == (f"BGP peer 10.0.1.0 went from Established to {state}",)


def test_disappeared_session() -> None:
    verdict = evaluate_health(_snapshot({"10.0.1.0": ESTABLISHED}), _snapshot())
    assert verdict.problems == ("BGP peer 10.0.1.0 disappeared (was Established)",)


def test_session_that_stops_accepting_prefixes() -> None:
    verdict = evaluate_health(
        _snapshot({"10.0.1.0": ESTABLISHED}),
        _snapshot({"10.0.1.0": BgpSessionState("Established", prefixes_accepted=0)}),
    )
    assert verdict.problems == ("BGP peer 10.0.1.0 no longer accepts any prefixes",)


def test_sessions_that_were_down_before_are_ignored() -> None:
    before = _snapshot({"10.0.1.0": BgpSessionState("Idle")})
    after = _snapshot({"10.0.1.0": BgpSessionState("Active")})
    assert evaluate_health(before, after).healthy


def test_new_session_coming_up_is_fine() -> None:
    assert evaluate_health(_snapshot(), _snapshot({"10.0.1.0": ESTABLISHED})).healthy


def test_interface_that_goes_down() -> None:
    verdict = evaluate_health(
        _snapshot(interfaces={"Gi2": UP}), _snapshot(interfaces={"Gi2": DOWN})
    )
    assert verdict.problems == ("Interface Gi2 went from up/up to down/down",)


def test_interface_line_protocol_down_is_a_degradation() -> None:
    verdict = evaluate_health(
        _snapshot(interfaces={"Gi2": UP}),
        _snapshot(interfaces={"Gi2": InterfaceState("up", "down")}),
    )
    assert not verdict.healthy


def test_interface_that_was_already_down_is_ignored() -> None:
    assert evaluate_health(
        _snapshot(interfaces={"Gi4": InterfaceState("administratively down", "down")}),
        _snapshot(interfaces={"Gi4": DOWN}),
    ).healthy


def test_disappeared_interface() -> None:
    verdict = evaluate_health(_snapshot(interfaces={"Gi2": UP}), _snapshot())
    assert verdict.problems == ("Interface Gi2 disappeared (was up/up)",)


@pytest.mark.parametrize(
    ("loss", "healthy"), [(0.0, True), (20.0, True), (20.1, False), (100.0, False)]
)
def test_ping_loss_threshold(loss: float, healthy: bool) -> None:
    verdict = evaluate_health(_snapshot(), _snapshot(ping={"10.0.1.0": loss}))
    assert verdict.healthy is healthy


def test_custom_ping_threshold() -> None:
    after = _snapshot(ping={"10.0.1.0": 10.0})
    assert not evaluate_health(_snapshot(), after, max_ping_loss_percent=5).healthy


def test_problems_are_reported_in_a_stable_order() -> None:
    before = _snapshot({"b": ESTABLISHED, "a": ESTABLISHED}, {"Gi3": UP, "Gi2": UP})
    verdict = evaluate_health(before, _snapshot(ping={"x": 50.0}))
    assert verdict.problems == (
        "BGP peer a disappeared (was Established)",
        "BGP peer b disappeared (was Established)",
        "Interface Gi2 disappeared (was up/up)",
        "Interface Gi3 disappeared (was up/up)",
        "Ping to x: 50% packet loss",
    )
