from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from netops.intent import IntentRepository, IntentValidationError
from netops.intent.lint import FABRIC_SOURCE


def _edit(path: Path, **changes: object) -> None:
    data = yaml.safe_load(path.read_text())
    data.update(changes)
    path.write_text(yaml.safe_dump(data))


def _issues(repo: IntentRepository) -> list[tuple[str, str, str]]:
    return [(issue.source, issue.location, issue.code) for issue in repo.lint()]


def test_fixture_repository_is_valid(intent_repo: Path) -> None:
    snapshot = IntentRepository(intent_repo).load()
    assert sorted(snapshot.intents) == [
        "leaf-1.croc.lab",
        "leaf-2.croc.lab",
        "spine-1.croc.lab",
        "spine-2.croc.lab",
    ]
    assert len(snapshot.inventory.devices) == 4
    assert snapshot.intent_for("missing") is None


def test_duplicate_router_id_across_devices(intent_repo: Path) -> None:
    path = intent_repo / "devices" / "leaf-2.croc.lab.yaml"
    data = yaml.safe_load(path.read_text())
    data["bgp"]["router_id"] = "10.255.1.1"  # leaf-1's router ID
    path.write_text(yaml.safe_dump(data))

    repo = IntentRepository(intent_repo)
    issues = repo.lint()
    assert {(i.source, i.location, i.code, i.hostname) for i in issues} == {
        (FABRIC_SOURCE, "bgp.router_id", "duplicate_router_id", "leaf-1.croc.lab"),
        (FABRIC_SOURCE, "bgp.router_id", "duplicate_router_id", "leaf-2.croc.lab"),
    }
    with pytest.raises(IntentValidationError) as excinfo:
        repo.load()
    assert len(excinfo.value.issues) == 2


def test_duplicate_ip_across_devices(intent_repo: Path) -> None:
    path = intent_repo / "devices" / "leaf-2.croc.lab.yaml"
    data = yaml.safe_load(path.read_text())
    data["interfaces"][1]["ipv4_address"] = "10.0.1.1/31"  # leaf-1 GigabitEthernet2
    path.write_text(yaml.safe_dump(data))

    issues = IntentRepository(intent_repo).lint()
    assert {(i.hostname, i.location) for i in issues if i.code == "duplicate_ip_address"} == {
        ("leaf-1.croc.lab", "interfaces.1.ipv4_address"),
        ("leaf-2.croc.lab", "interfaces.1.ipv4_address"),
    }


def test_field_errors_point_at_file_and_field(intent_repo: Path) -> None:
    path = intent_repo / "devices" / "spine-1.croc.lab.yaml"
    data = yaml.safe_load(path.read_text())
    data["bgp"]["asn"] = 0
    path.write_text(yaml.safe_dump(data))

    issues = IntentRepository(intent_repo).lint()
    assert [(i.source, i.location, i.hostname) for i in issues] == [
        ("devices/spine-1.croc.lab.yaml", "bgp.asn", "spine-1.croc.lab")
    ]
    assert str(issues[0]).startswith("devices/spine-1.croc.lab.yaml:bgp.asn: ")


def test_hostname_must_match_file_name(intent_repo: Path) -> None:
    _edit(intent_repo / "devices" / "leaf-2.croc.lab.yaml", hostname="leaf-3.croc.lab")
    assert ("devices/leaf-2.croc.lab.yaml", "hostname", "hostname_mismatch") in _issues(
        IntentRepository(intent_repo)
    )


def test_intent_for_a_device_missing_from_inventory(intent_repo: Path) -> None:
    (intent_repo / "devices" / "leaf-9.croc.lab.yaml").write_text(
        yaml.safe_dump(
            {"hostname": "leaf-9.croc.lab", "bgp": {"asn": 65109, "router_id": "10.255.1.9"}}
        )
    )
    assert ("devices/leaf-9.croc.lab.yaml", "hostname", "unknown_device") in _issues(
        IntentRepository(intent_repo)
    )


def test_broken_yaml_and_empty_files(intent_repo: Path) -> None:
    (intent_repo / "devices" / "leaf-1.croc.lab.yaml").write_text("interfaces: [unclosed\n")
    (intent_repo / "devices" / "leaf-2.croc.lab.yaml").write_text("")
    issues = _issues(IntentRepository(intent_repo))
    assert ("devices/leaf-1.croc.lab.yaml", "", "yaml_error") in issues
    assert ("devices/leaf-2.croc.lab.yaml", "", "empty_file") in issues


def test_missing_inventory(intent_repo: Path) -> None:
    (intent_repo / "inventory.yaml").unlink()
    repo = IntentRepository(intent_repo)
    assert ("inventory.yaml", "", "invalid") in _issues(repo)
    with pytest.raises(IntentValidationError):
        repo.load_inventory()


def test_missing_repository(tmp_path: Path) -> None:
    repo = IntentRepository(tmp_path / "nowhere")
    with pytest.raises(IntentValidationError) as excinfo:
        repo.load()
    assert "does not exist" in excinfo.value.issues[0].message


class TestLoadDeviceIntent:
    def test_existing_device(self, intent_repo: Path) -> None:
        intent = IntentRepository(intent_repo).load_device_intent("leaf-1.croc.lab")
        assert intent is not None
        assert intent.bgp is not None
        assert intent.bgp.asn == 65101

    def test_missing_device(self, intent_repo: Path) -> None:
        assert IntentRepository(intent_repo).load_device_intent("leaf-9.croc.lab") is None

    def test_path_traversal_is_not_possible(self, intent_repo: Path) -> None:
        assert IntentRepository(intent_repo).load_device_intent("../inventory") is None

    def test_invalid_device(self, intent_repo: Path) -> None:
        _edit(intent_repo / "devices" / "leaf-1.croc.lab.yaml", interfaces="oops")
        with pytest.raises(IntentValidationError) as excinfo:
            IntentRepository(intent_repo).load_device_intent("leaf-1.croc.lab")
        assert excinfo.value.issues[0].location == "interfaces"
