from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum
from ipaddress import IPv4Address, IPv4Interface, IPv4Network
from itertools import combinations
from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    PlainValidator,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from netops.enums import DeviceRole, DeviceStatus, Platform

_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"

Hostname = Annotated[str, StringConstraints(max_length=253, pattern=rf"^{_LABEL}(?:\.{_LABEL})*$")]
Asn = Annotated[int, Field(ge=1, le=4_294_967_295, description="Номер AS (2 или 4 байта)")]
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[\w.\-]+$")]
InterfaceName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z][\w./:\-]*(?: [\w./:\-]+)?$"),
]
Description = Annotated[str, StringConstraints(max_length=240, strip_whitespace=True)]


class IntentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class InterfaceMode(StrEnum):
    L3 = "l3"
    L2 = "l2"


class InterfaceIntent(IntentModel):
    name: InterfaceName
    description: Description | None = None
    enabled: bool = True
    mode: InterfaceMode = InterfaceMode.L3
    ipv4_address: IPv4Interface | None = Field(
        default=None, description="Адрес с маской, например 10.10.0.1/31"
    )
    mtu: int = Field(default=1500, ge=68, le=9216)
    # Входящий ACL на интерфейсе: имя из блока acls этого же устройства.
    acl_in: Identifier | None = None

    @field_validator("ipv4_address", mode="before")
    @classmethod
    def _require_prefix_length(cls, value: object) -> object:
        if isinstance(value, str) and "/" not in value:
            raise PydanticCustomError(
                "missing_prefix_length",
                "The address must include a prefix length, e.g. 10.0.0.1/31",
            )
        return value

    @field_validator("ipv4_address")
    @classmethod
    def _check_address(
        cls, value: IPv4Interface | None, info: ValidationInfo
    ) -> IPv4Interface | None:
        if value is None:
            return None
        if info.data.get("mode") is InterfaceMode.L2:
            raise PydanticCustomError(
                "l2_interface_address", "An L2 (switched) interface cannot have an IPv4 address"
            )
        network = value.network
        # В /31 и /32 нет адреса сети и broadcast (RFC 3021).
        if network.prefixlen < 31 and value.ip in (
            network.network_address,
            network.broadcast_address,
        ):
            raise PydanticCustomError(
                "reserved_address",
                "{address} is the network or broadcast address of {network}",
                {"address": str(value.ip), "network": str(network)},
            )
        return value


class BgpNeighborIntent(IntentModel):
    peer_ip: IPv4Address
    remote_asn: Asn
    description: Description | None = None
    # MD5-пароль не попадает в ответы API и в логи.
    password: str | None = Field(
        default=None, min_length=1, max_length=80, repr=False, exclude=True
    )
    announced_prefixes: list[IPv4Network] = Field(default_factory=list)


class BgpIntent(IntentModel):
    asn: Asn
    router_id: IPv4Address
    neighbors: list[BgpNeighborIntent] = Field(default_factory=list)

    @field_validator("router_id")
    @classmethod
    def _check_router_id(cls, value: IPv4Address) -> IPv4Address:
        if value.is_unspecified or value.is_multicast:
            raise PydanticCustomError("invalid_router_id", "Router ID must be a unicast address")
        return value

    @field_validator("neighbors")
    @classmethod
    def _unique_peers(cls, neighbors: list[BgpNeighborIntent]) -> list[BgpNeighborIntent]:
        _ensure_unique((str(n.peer_ip) for n in neighbors), "duplicate_neighbor", "BGP neighbor")
        return neighbors


class AclAction(StrEnum):
    PERMIT = "permit"
    DENY = "deny"


class AclProtocol(StrEnum):
    IP = "ip"
    TCP = "tcp"
    UDP = "udp"
    ICMP = "icmp"


def _parse_acl_endpoint(value: object) -> Literal["any"] | IPv4Network:
    if isinstance(value, IPv4Network):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text.lower() == "any":
            return "any"
        try:
            return IPv4Network(text)
        except ValueError as exc:
            raise PydanticCustomError(
                "acl_endpoint",
                "Expected 'any' or an IPv4 network: {reason}",
                {"reason": str(exc)},
            ) from exc
    raise PydanticCustomError("acl_endpoint", "Expected 'any' or an IPv4 network")


AclEndpoint = Annotated[
    Literal["any"] | IPv4Network,
    PlainValidator(_parse_acl_endpoint, json_schema_input_type=str),
    PlainSerializer(str, return_type=str),
]


class AclRule(IntentModel):
    sequence: int = Field(ge=1, le=4_294_967_295)
    action: AclAction
    protocol: AclProtocol
    source: AclEndpoint = "any"
    destination: AclEndpoint = "any"
    src_port: str | int | None = None
    dst_port: str | int | None = None


class AclIntent(IntentModel):
    name: Identifier
    type: str | None = None
    rules: list[AclRule] = Field(min_length=1)

    @field_validator("rules")
    @classmethod
    def _ordered_unique_sequences(cls, rules: list[AclRule]) -> list[AclRule]:
        _ensure_unique((str(r.sequence) for r in rules), "duplicate_sequence", "ACL sequence")
        return sorted(rules, key=lambda rule: rule.sequence)


class DeviceIntent(IntentModel):
    hostname: Hostname
    interfaces: list[InterfaceIntent] = Field(default_factory=list)
    bgp: BgpIntent | None = None
    acls: list[AclIntent] = Field(default_factory=list)

    @field_validator("interfaces")
    @classmethod
    def _check_interfaces(cls, interfaces: list[InterfaceIntent]) -> list[InterfaceIntent]:
        _ensure_unique((i.name.lower() for i in interfaces), "duplicate_interface", "Interface")
        addressed = [(i.name, i.ipv4_address) for i in interfaces if i.ipv4_address is not None]
        for (first, first_address), (second, second_address) in combinations(addressed, 2):
            if first_address.network.overlaps(second_address.network):
                raise PydanticCustomError(
                    "overlapping_subnets",
                    "{first} ({first_address}) overlaps with {second} ({second_address})",
                    {
                        "first": first,
                        "first_address": str(first_address),
                        "second": second,
                        "second_address": str(second_address),
                    },
                )
        return interfaces

    @field_validator("acls")
    @classmethod
    def _unique_acl_names(cls, acls: list[AclIntent]) -> list[AclIntent]:
        _ensure_unique((a.name for a in acls), "duplicate_acl", "ACL")
        return acls

    # Опечатку в имени ACL лучше поймать здесь, чем получить патч, снимающий фильтр.
    @model_validator(mode="after")
    def _known_acl_bindings(self) -> Self:
        declared = {acl.name for acl in self.acls}
        for interface in self.interfaces:
            if interface.acl_in is not None and interface.acl_in not in declared:
                raise PydanticCustomError(
                    "unknown_acl",
                    "Interface {interface} references ACL {acl}, which is not declared",
                    {"interface": interface.name, "acl": interface.acl_in},
                )
        return self


# id и status есть в модели устройства из ТЗ. Статус в файле справочный: в базе его
# выставляет Drift Engine.
class InventoryDevice(IntentModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | str | None = None
    hostname: Hostname
    management_ip: IPv4Address
    management_port: int = Field(default=22, ge=1, le=65535)
    platform: Platform
    role: DeviceRole
    auth_profile: Identifier
    status: DeviceStatus | None = None


class Inventory(IntentModel):
    devices: list[InventoryDevice] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _no_credentials(cls, data: Any) -> Any:
        if isinstance(data, dict) and "auth_profiles" in data:
            raise PydanticCustomError(
                "credentials_in_inventory",
                "Credentials must not be stored in inventory.yaml; "
                "set them in NETOPS_AUTH_PROFILES and keep only auth_profile names here",
            )
        return data

    @field_validator("devices")
    @classmethod
    def _unique_devices(cls, devices: list[InventoryDevice]) -> list[InventoryDevice]:
        _ensure_unique((d.hostname.lower() for d in devices), "duplicate_hostname", "Hostname")
        _ensure_unique((str(d.id) for d in devices if d.id is not None), "duplicate_id", "Id")
        _ensure_unique(
            (f"{d.management_ip}:{d.management_port}" for d in devices),
            "duplicate_management_endpoint",
            "Management endpoint",
        )
        return devices


def _ensure_unique(values: Iterable[str], error_type: str, subject: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise PydanticCustomError(
                error_type,
                "{subject} {value} is declared more than once",
                {"subject": subject, "value": value},
            )
        seen.add(value)
