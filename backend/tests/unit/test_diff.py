from __future__ import annotations

from netops.enums import Platform
from netops.network import ConfigDiff, HierConfigDiffEngine

INTENDED = """\
hostname leaf-1
interface GigabitEthernet2
 description Uplink to spine-1
 ip address 10.0.1.1 255.255.255.254
router bgp 65101
 neighbor 10.0.1.0 remote-as 65000
 neighbor 10.0.1.2 remote-as 65000
"""

RUNNING = """\
hostname leaf-1
interface GigabitEthernet2
 description old
 ip address 10.0.1.1 255.255.255.254
username rogue privilege 15
router bgp 65101
 neighbor 10.0.1.0 remote-as 65000
"""


def test_identical_configs_are_in_sync() -> None:
    diff = HierConfigDiffEngine().compare(Platform.CISCO_IOSXE, INTENDED, INTENDED)
    assert diff.in_sync
    assert not diff.has_changes
    assert diff.remediation == diff.rollback == ""


def test_remediation_and_rollback_are_mirrored() -> None:
    diff = HierConfigDiffEngine().compare(Platform.CISCO_IOSXE, RUNNING, INTENDED)

    assert diff.has_changes
    remediation = diff.remediation.splitlines()
    assert "no username rogue privilege 15" in remediation
    assert "  description Uplink to spine-1" in remediation
    assert "  neighbor 10.0.1.2 remote-as 65000" in remediation

    rollback = diff.rollback.splitlines()
    assert "username rogue privilege 15" in rollback
    assert "  description old" in rollback
    assert "  no neighbor 10.0.1.2 remote-as 65000" in rollback


def test_unauthorized_and_missing_lines() -> None:
    diff = HierConfigDiffEngine().compare(Platform.CISCO_IOSXE, RUNNING, INTENDED)
    assert "username rogue privilege 15" in diff.unauthorized_lines
    assert "  description old" in diff.unauthorized_lines
    assert "  neighbor 10.0.1.2 remote-as 65000" in diff.missing_lines
    assert not diff.in_sync


def test_patches_exit_every_section() -> None:
    diff = HierConfigDiffEngine().compare(
        Platform.ARISTA_EOS, "", "router bgp 65000\n   router-id 1.1.1.1\n"
    )
    assert diff.remediation.splitlines() == ["router bgp 65000", "  router-id 1.1.1.1", "  exit"]
    assert diff.rollback.splitlines() == ["no router bgp 65000"]


def test_every_platform_is_supported() -> None:
    engine = HierConfigDiffEngine()
    for platform in Platform:
        assert engine.compare(platform, "a\n", "a\n").in_sync


def test_config_diff_flags() -> None:
    assert ConfigDiff(remediation="", rollback="").in_sync
    assert not ConfigDiff(remediation=" \n", rollback="", missing_lines=("x",)).in_sync
    assert not ConfigDiff(remediation=" \n", rollback="").has_changes
