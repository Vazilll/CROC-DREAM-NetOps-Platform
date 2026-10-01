from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass

from netops.network.base import HealthExpectations, HealthSnapshot


@dataclass(frozen=True, slots=True)
class HealthVerdict:
    problems: tuple[str, ...] = ()

    @property
    def healthy(self) -> bool:
        return not self.problems


# Если intent известен: заявленные BGP-соседи должны быть Established и принимать
# префиксы, включённые интерфейсы — up/up; соседи, убранные из intent, могут пропасть.
# Интерфейсы вне intent (или всё, если intent неизвестен) проверяются на регрессию.
# Потери ping выше порога — всегда авария.
def evaluate_health(
    before: HealthSnapshot,
    after: HealthSnapshot,
    *,
    expected: HealthExpectations | None = None,
    max_ping_loss_percent: float = 20.0,
) -> HealthVerdict:
    if expected is not None:
        bgp = _declared_bgp(expected, after)
        declared_interfaces = expected.interfaces
    else:
        bgp = _bgp_regressions(before, after)
        declared_interfaces = {}
    problems = [
        *bgp,
        *_interfaces(before, after, declared_interfaces),
        *_ping(after, max_ping_loss_percent),
    ]
    return HealthVerdict(tuple(problems))


def _declared_bgp(expected: HealthExpectations, after: HealthSnapshot) -> Iterator[str]:
    for peer in sorted(expected.bgp_peers):
        session = after.bgp_sessions.get(peer)
        if session is None:
            yield f"BGP peer {peer} is not reported by the device"
        elif not session.established:
            yield f"BGP peer {peer} is {session.state}, expected Established"
        elif session.prefixes_accepted == 0:
            yield f"BGP peer {peer} accepts no prefixes"


def _bgp_regressions(before: HealthSnapshot, after: HealthSnapshot) -> Iterator[str]:
    for peer, was in sorted(before.bgp_sessions.items()):
        if not was.established:
            continue
        now = after.bgp_sessions.get(peer)
        if now is None:
            yield f"BGP peer {peer} disappeared (was Established)"
        elif not now.established:
            yield f"BGP peer {peer} went from Established to {now.state}"
        elif (was.prefixes_accepted or 0) > 0 and now.prefixes_accepted == 0:
            yield f"BGP peer {peer} no longer accepts any prefixes"


def _interfaces(
    before: HealthSnapshot, after: HealthSnapshot, declared: Mapping[str, bool]
) -> Iterator[str]:
    for name, enabled in sorted(declared.items()):
        if not enabled:
            continue
        state = after.interfaces.get(name)
        if state is None:
            yield f"Interface {name} is not reported by the device"
        elif not state.is_up:
            yield f"Interface {name} is {state}, expected up/up"

    for name, was in sorted(before.interfaces.items()):
        if name in declared or not was.is_up:
            continue
        now = after.interfaces.get(name)
        if now is None:
            yield f"Interface {name} disappeared (was up/up)"
        elif not now.is_up:
            yield f"Interface {name} went from up/up to {now}"


def _ping(after: HealthSnapshot, max_loss: float) -> Iterator[str]:
    for destination, loss in sorted(after.ping_loss_percent.items()):
        if loss > max_loss:
            yield f"Ping to {destination}: {loss:g}% packet loss"
