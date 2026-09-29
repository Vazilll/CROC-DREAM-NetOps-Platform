"""Evaluation of pre/post deployment health checks (spec 2.6).

The comparison is regression-based: a deployment is considered harmful if
something that worked before the change is broken after it.
"""

from __future__ import annotations

from dataclasses import dataclass

from netops.network.base import HealthSnapshot


@dataclass(frozen=True, slots=True)
class HealthVerdict:
    problems: tuple[str, ...] = ()

    @property
    def healthy(self) -> bool:
        return not self.problems


def evaluate_health(
    before: HealthSnapshot, after: HealthSnapshot, *, max_ping_loss_percent: float = 20.0
) -> HealthVerdict:
    """Apply the degradation criteria of the spec.

    * a BGP session that was Established is no longer Established, or stopped
      accepting prefixes;
    * an interface that was up/up is no longer up/up;
    * ping loss to any probed neighbor exceeds ``max_ping_loss_percent``.
    """
    problems: list[str] = []

    for peer, was in sorted(before.bgp_sessions.items()):
        if not was.established:
            continue
        now = after.bgp_sessions.get(peer)
        if now is None:
            problems.append(f"BGP peer {peer} disappeared (was Established)")
        elif not now.established:
            problems.append(f"BGP peer {peer} went from Established to {now.state}")
        elif (was.prefixes_accepted or 0) > 0 and now.prefixes_accepted == 0:
            problems.append(f"BGP peer {peer} no longer accepts any prefixes")

    for name, was_state in sorted(before.interfaces.items()):
        if not was_state.is_up:
            continue
        now_state = after.interfaces.get(name)
        if now_state is None:
            problems.append(f"Interface {name} disappeared (was up/up)")
        elif not now_state.is_up:
            problems.append(f"Interface {name} went from up/up to {now_state}")

    for destination, loss in sorted(after.ping_loss_percent.items()):
        if loss > max_ping_loss_percent:
            problems.append(f"Ping to {destination}: {loss:g}% packet loss")

    return HealthVerdict(tuple(problems))
