from __future__ import annotations

import pytest

from netops.intent import DeviceIntent
from netops.network import (
    BgpSessionState,
    HealthExpectations,
    HealthSnapshot,
    InterfaceState,
    evaluate_health,
)

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


class TestDeclaredState:
    """Rules applied when the intent is known (spec 2.6)."""

    EXPECTED = HealthExpectations(
        bgp_peers=("10.0.1.0", "10.0.1.2"),
        interfaces={"Gi2": True, "Gi3": True, "Gi4": False},
    )

    def _after(self, **overrides: object) -> HealthSnapshot:
        base: dict[str, object] = {
            "bgp": {"10.0.1.0": ESTABLISHED, "10.0.1.2": ESTABLISHED},
            "interfaces": {"Gi2": UP, "Gi3": UP, "Gi4": InterfaceState("admin down", "down")},
        }
        base.update(overrides)
        return _snapshot(**base)  # type: ignore[arg-type]

    def test_everything_declared_is_healthy(self) -> None:
        assert evaluate_health(_snapshot(), self._after(), expected=self.EXPECTED).healthy

    def test_declared_peer_must_be_established(self) -> None:
        after = self._after(bgp={"10.0.1.0": ESTABLISHED, "10.0.1.2": BgpSessionState("Connect")})
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("BGP peer 10.0.1.2 is Connect, expected Established",)

    def test_declared_peer_must_be_reported(self) -> None:
        after = self._after(bgp={"10.0.1.0": ESTABLISHED})
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("BGP peer 10.0.1.2 is not reported by the device",)

    def test_declared_peer_must_accept_prefixes(self) -> None:
        after = self._after(
            bgp={"10.0.1.0": ESTABLISHED, "10.0.1.2": BgpSessionState("Established", 0)}
        )
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("BGP peer 10.0.1.2 accepts no prefixes",)

    def test_unknown_prefix_count_is_not_a_failure(self) -> None:
        after = self._after(
            bgp={"10.0.1.0": ESTABLISHED, "10.0.1.2": BgpSessionState("Established")}
        )
        assert evaluate_health(_snapshot(), after, expected=self.EXPECTED).healthy

    def test_removed_peer_may_disappear(self) -> None:
        before = _snapshot(
            {"10.0.1.0": ESTABLISHED, "10.0.1.2": ESTABLISHED, "10.0.1.4": ESTABLISHED}
        )
        assert evaluate_health(before, self._after(), expected=self.EXPECTED).healthy

    def test_enabled_interface_must_be_up(self) -> None:
        after = self._after(interfaces={"Gi2": UP, "Gi3": DOWN})
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("Interface Gi3 is down/down, expected up/up",)

    def test_enabled_interface_must_be_reported(self) -> None:
        after = self._after(interfaces={"Gi2": UP})
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("Interface Gi3 is not reported by the device",)

    def test_disabled_interface_may_go_down(self) -> None:
        before = _snapshot(interfaces={"Gi4": UP})
        assert evaluate_health(before, self._after(), expected=self.EXPECTED).healthy

    def test_undeclared_interfaces_are_checked_for_regressions(self) -> None:
        before = _snapshot(interfaces={"Management0": UP})
        after = self._after(interfaces={"Gi2": UP, "Gi3": UP, "Management0": DOWN})
        verdict = evaluate_health(before, after, expected=self.EXPECTED)
        assert verdict.problems == ("Interface Management0 went from up/up to down/down",)

    def test_ping_loss_still_counts(self) -> None:
        after = self._after(ping={"10.0.1.0": 40.0})
        verdict = evaluate_health(_snapshot(), after, expected=self.EXPECTED)
        assert verdict.problems == ("Ping to 10.0.1.0: 40% packet loss",)


def test_expectations_from_intent_round_trip() -> None:
    intent = DeviceIntent.model_validate(
        {
            "hostname": "leaf-1",
            "interfaces": [{"name": "Gi2"}, {"name": "Gi4", "enabled": False}],
            "bgp": {
                "asn": 65101,
                "router_id": "10.255.1.1",
                "neighbors": [{"peer_ip": "10.0.1.0", "remote_asn": 65000}],
            },
        }
    )
    expected = HealthExpectations.from_intent(intent)
    assert expected == HealthExpectations(("10.0.1.0",), {"Gi2": True, "Gi4": False})
    assert HealthExpectations.from_json(expected.to_json()) == expected
    no_bgp = DeviceIntent.model_validate({"hostname": "leaf-1"})
    assert HealthExpectations.from_intent(no_bgp) == HealthExpectations()
