"""Pre-flight lint: structured validation issues and fabric-wide checks."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from pydantic import ValidationError

from netops.errors import NetOpsError
from netops.intent.models import DeviceIntent

FABRIC_SOURCE = "<fabric>"


@dataclass(frozen=True, slots=True)
class IntentIssue:
    """A single problem found in the intent, pointing at the offending field."""

    source: str  # file path relative to the intent repository, or FABRIC_SOURCE
    location: str  # dotted field path, e.g. "bgp.neighbors.0.remote_asn"
    message: str
    hostname: str | None = None
    code: str = "invalid"

    def __str__(self) -> str:
        where = f"{self.source}:{self.location}" if self.location else self.source
        return f"{where}: {self.message}"


class IntentValidationError(NetOpsError):
    def __init__(self, issues: Sequence[IntentIssue]) -> None:
        super().__init__(f"Intent validation failed with {len(issues)} issue(s)")
        self.issues = tuple(issues)


def issues_from_validation_error(
    error: ValidationError, *, source: str, hostname: str | None = None
) -> list[IntentIssue]:
    return [
        IntentIssue(
            source=source,
            location=".".join(str(part) for part in item["loc"]),
            message=item["msg"],
            hostname=hostname,
            code=item["type"],
        )
        for item in error.errors(include_url=False)
    ]


def lint_fabric(intents: Iterable[DeviceIntent]) -> list[IntentIssue]:
    """Checks that need the whole fabric: Router ID and interface IP uniqueness."""
    router_ids: defaultdict[str, list[str]] = defaultdict(list)
    addresses: defaultdict[str, list[tuple[str, str]]] = defaultdict(list)

    for intent in intents:
        if intent.bgp is not None:
            router_ids[str(intent.bgp.router_id)].append(intent.hostname)
        for index, interface in enumerate(intent.interfaces):
            if interface.ipv4_address is not None:
                addresses[str(interface.ipv4_address.ip)].append(
                    (intent.hostname, f"interfaces.{index}.ipv4_address")
                )

    issues: list[IntentIssue] = []
    for router_id, hostnames in sorted(router_ids.items()):
        if len(hostnames) > 1:
            issues.extend(
                IntentIssue(
                    source=FABRIC_SOURCE,
                    location="bgp.router_id",
                    message=f"Router ID {router_id} is shared by {', '.join(sorted(hostnames))}",
                    hostname=hostname,
                    code="duplicate_router_id",
                )
                for hostname in hostnames
            )
    for address, owners in sorted(addresses.items()):
        if len(owners) > 1:
            devices = ", ".join(sorted({hostname for hostname, _ in owners}))
            issues.extend(
                IntentIssue(
                    source=FABRIC_SOURCE,
                    location=location,
                    message=f"IP address {address} is assigned more than once ({devices})",
                    hostname=hostname,
                    code="duplicate_ip_address",
                )
                for hostname, location in owners
            )
    return issues
