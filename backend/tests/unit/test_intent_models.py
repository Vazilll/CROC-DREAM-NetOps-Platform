from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from netops.intent import AclIntent, BgpIntent, DeviceIntent, InterfaceIntent, Inventory


def _errors(model: type[Any], data: dict[str, Any]) -> list[tuple[tuple[Any, ...], str]]:
    with pytest.raises(ValidationError) as excinfo:
        model.model_validate(data)
    return [(error["loc"], error["type"]) for error in excinfo.value.errors()]


def _device(**fields: Any) -> dict[str, Any]:
    return {"hostname": "leaf-1.croc.lab", **fields}


class TestInterfaces:
    def test_defaults(self) -> None:
        interface = InterfaceIntent(name="Ethernet1")
        assert interface.enabled is True
        assert interface.mode == "l3"
        assert interface.mtu == 1500
        assert interface.ipv4_address is None

    @pytest.mark.parametrize(
        "address", ["10.0.0.1/31", "10.0.0.0/31", "10.255.0.1/32", "10.0.0.1/24"]
    )
    def test_accepts_usable_addresses(self, address: str) -> None:
        assert str(InterfaceIntent(name="Eth1", ipv4_address=address).ipv4_address) == address

    @pytest.mark.parametrize("address", ["10.0.0.0/24", "10.0.0.255/24"])
    def test_rejects_network_and_broadcast_addresses(self, address: str) -> None:
        errors = _errors(InterfaceIntent, {"name": "Eth1", "ipv4_address": address})
        assert errors == [(("ipv4_address",), "reserved_address")]

    @pytest.mark.parametrize("address", ["10.0.0.1/33", "300.0.0.1/24", "garbage"])
    def test_rejects_malformed_addresses(self, address: str) -> None:
        errors = _errors(InterfaceIntent, {"name": "Eth1", "ipv4_address": address})
        assert errors[0][0] == ("ipv4_address",)

    def test_prefix_length_is_required(self) -> None:
        errors = _errors(InterfaceIntent, {"name": "Eth1", "ipv4_address": "10.0.0.1"})
        assert errors == [(("ipv4_address",), "missing_prefix_length")]

    def test_l2_interface_cannot_have_an_address(self) -> None:
        errors = _errors(
            InterfaceIntent, {"name": "Eth1", "mode": "l2", "ipv4_address": "10.0.0.1/31"}
        )
        assert errors == [(("ipv4_address",), "l2_interface_address")]

    @pytest.mark.parametrize("mtu", [67, 9217])
    def test_mtu_bounds(self, mtu: int) -> None:
        assert _errors(InterfaceIntent, {"name": "Eth1", "mtu": mtu})[0][0] == ("mtu",)

    def test_unknown_fields_are_rejected(self) -> None:
        errors = _errors(InterfaceIntent, {"name": "Eth1", "speed": 1000})
        assert errors == [(("speed",), "extra_forbidden")]


class TestDeviceIntent:
    def test_overlapping_subnets_are_rejected(self) -> None:
        errors = _errors(
            DeviceIntent,
            _device(
                interfaces=[
                    {"name": "Eth1", "ipv4_address": "10.0.0.1/24"},
                    {"name": "Eth2", "ipv4_address": "10.0.0.5/30"},
                ]
            ),
        )
        assert errors == [(("interfaces",), "overlapping_subnets")]

    def test_loopback_inside_a_link_subnet_is_rejected(self) -> None:
        errors = _errors(
            DeviceIntent,
            _device(
                interfaces=[
                    {"name": "Eth1", "ipv4_address": "10.0.0.0/31"},
                    {"name": "Loopback0", "ipv4_address": "10.0.0.1/32"},
                ]
            ),
        )
        assert errors == [(("interfaces",), "overlapping_subnets")]

    def test_duplicate_interface_names_are_rejected_case_insensitively(self) -> None:
        errors = _errors(
            DeviceIntent, _device(interfaces=[{"name": "Ethernet1"}, {"name": "ethernet1"}])
        )
        assert errors == [(("interfaces",), "duplicate_interface")]

    def test_duplicate_acl_names_are_rejected(self) -> None:
        acl = {
            "name": "MGMT",
            "rules": [
                {
                    "sequence": 10,
                    "action": "deny",
                    "protocol": "ip",
                    "source": "any",
                    "destination": "any",
                }
            ],
        }
        assert _errors(DeviceIntent, _device(acls=[acl, acl])) == [(("acls",), "duplicate_acl")]

    @pytest.mark.parametrize("hostname", ["-leaf", "leaf_1", "leaf..croc", "a" * 64])
    def test_invalid_hostnames(self, hostname: str) -> None:
        assert _errors(DeviceIntent, {"hostname": hostname})[0][0] == ("hostname",)


class TestBgp:
    @pytest.mark.parametrize("asn", [1, 65000, 4_294_967_295])
    def test_asn_range_accepts(self, asn: int) -> None:
        assert BgpIntent(asn=asn, router_id="10.255.0.1").asn == asn

    @pytest.mark.parametrize("asn", [0, -1, 4_294_967_296])
    def test_asn_range_rejects(self, asn: int) -> None:
        assert _errors(BgpIntent, {"asn": asn, "router_id": "10.255.0.1"})[0][0] == ("asn",)

    def test_neighbor_remote_asn_is_validated(self) -> None:
        errors = _errors(
            BgpIntent,
            {
                "asn": 65000,
                "router_id": "10.255.0.1",
                "neighbors": [{"peer_ip": "10.0.0.1", "remote_asn": 0}],
            },
        )
        assert errors[0][0] == ("neighbors", 0, "remote_asn")

    @pytest.mark.parametrize("router_id", ["0.0.0.0", "224.0.0.1"])
    def test_router_id_must_be_unicast(self, router_id: str) -> None:
        errors = _errors(BgpIntent, {"asn": 65000, "router_id": router_id})
        assert errors == [(("router_id",), "invalid_router_id")]

    def test_duplicate_neighbors_are_rejected(self) -> None:
        neighbor = {"peer_ip": "10.0.0.1", "remote_asn": 65001}
        errors = _errors(
            BgpIntent, {"asn": 65000, "router_id": "10.255.0.1", "neighbors": [neighbor, neighbor]}
        )
        assert errors == [(("neighbors",), "duplicate_neighbor")]

    def test_announced_prefixes_must_be_networks(self) -> None:
        errors = _errors(
            BgpIntent,
            {
                "asn": 65000,
                "router_id": "10.255.0.1",
                "neighbors": [
                    {
                        "peer_ip": "10.0.0.1",
                        "remote_asn": 65001,
                        "announced_prefixes": ["10.255.0.1/24"],
                    }
                ],
            },
        )
        assert errors[0][0] == ("neighbors", 0, "announced_prefixes", 0)

    def test_password_is_never_serialized_or_printed(self) -> None:
        bgp = BgpIntent.model_validate(
            {
                "asn": 65000,
                "router_id": "10.255.0.1",
                "neighbors": [{"peer_ip": "10.0.0.1", "remote_asn": 65001, "password": "s3cret"}],
            }
        )
        assert bgp.neighbors[0].password == "s3cret"
        assert "s3cret" not in bgp.model_dump_json()
        assert "s3cret" not in repr(bgp)


class TestAcl:
    def _acl(self, *rules: dict[str, Any]) -> dict[str, Any]:
        return {"name": "MGMT-IN", "rules": list(rules)}

    def _rule(self, sequence: int, **fields: Any) -> dict[str, Any]:
        return {
            "sequence": sequence,
            "action": "permit",
            "protocol": "tcp",
            "source": "any",
            "destination": "any",
            **fields,
        }

    def test_rules_are_ordered_by_sequence(self) -> None:
        acl = AclIntent.model_validate(self._acl(self._rule(20), self._rule(10)))
        assert [rule.sequence for rule in acl.rules] == [10, 20]

    def test_duplicate_sequences_are_rejected(self) -> None:
        errors = _errors(AclIntent, self._acl(self._rule(10), self._rule(10)))
        assert errors == [(("rules",), "duplicate_sequence")]

    def test_endpoints(self) -> None:
        acl = AclIntent.model_validate(
            self._acl(self._rule(10, source="ANY", destination="10.0.0.0/8"))
        )
        rule = acl.rules[0]
        assert rule.source == "any"
        assert str(rule.destination) == "10.0.0.0/8"
        assert acl.model_dump(mode="json")["rules"][0]["destination"] == "10.0.0.0/8"

    @pytest.mark.parametrize("endpoint", ["10.0.0.1/8", "anywhere", 42])
    def test_invalid_endpoints(self, endpoint: object) -> None:
        errors = _errors(AclIntent, self._acl(self._rule(10, source=endpoint)))
        assert errors == [(("rules", 0, "source"), "acl_endpoint")]

    @pytest.mark.parametrize(
        ("field", "value"), [("action", "allow"), ("protocol", "gre"), ("sequence", 0)]
    )
    def test_enumerated_fields(self, field: str, value: object) -> None:
        errors = _errors(AclIntent, self._acl(self._rule(10) | {field: value}))
        assert errors[0][0] == ("rules", 0, field)

    def test_empty_acl_is_rejected(self) -> None:
        assert _errors(AclIntent, {"name": "EMPTY", "rules": []})[0][0] == ("rules",)


class TestInventory:
    def _device(self, hostname: str, ip: str, port: int = 22) -> dict[str, Any]:
        return {
            "hostname": hostname,
            "management_ip": ip,
            "management_port": port,
            "platform": "arista_eos",
            "role": "spine",
            "auth_profile": "lab",
        }

    def test_same_ip_with_different_ports_is_allowed(self) -> None:
        inventory = Inventory.model_validate(
            {
                "devices": [
                    self._device("a", "127.0.0.1", 2201),
                    self._device("b", "127.0.0.1", 2202),
                ]
            }
        )
        assert len(inventory.devices) == 2

    def test_duplicate_management_endpoints_are_rejected(self) -> None:
        errors = _errors(
            Inventory,
            {"devices": [self._device("a", "127.0.0.1"), self._device("b", "127.0.0.1")]},
        )
        assert errors == [(("devices",), "duplicate_management_endpoint")]

    def test_duplicate_hostnames_are_rejected(self) -> None:
        errors = _errors(
            Inventory, {"devices": [self._device("a", "10.0.0.1"), self._device("A", "10.0.0.2")]}
        )
        assert errors == [(("devices",), "duplicate_hostname")]

    def test_unknown_platform_is_rejected(self) -> None:
        device = self._device("a", "10.0.0.1") | {"platform": "junos"}
        assert _errors(Inventory, {"devices": [device]})[0][0] == ("devices", 0, "platform")
