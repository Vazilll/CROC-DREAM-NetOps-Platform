from __future__ import annotations

from pathlib import Path

import pytest

from netops.enums import Platform
from netops.network import ConfigNormalizer

CISCO_RUNNING = """\
Building configuration...

Current configuration : 1234 bytes
!
! Last configuration change at 10:21:07 UTC Mon Sep 28 2026 by admin
! NVRAM config last updated at 10:21:09 UTC Mon Sep 28 2026 by admin
!
version 17.9
hostname leaf-1\r
ntp clock-period 17179869
!
interface GigabitEthernet2
 description Uplink   \t
 ip address 10.0.1.1 255.255.255.254
!
crypto pki trustpoint TP-self-signed-4242
 enrollment selfsigned
 revocation-check none
crypto pki certificate chain TP-self-signed-4242
 certificate self-signed 01
  30820330 30820218 A0030201 02020101
  quit
router bgp 65101
 neighbor 10.0.1.0 remote-as 65000
!
end
"""


def test_cisco_artifacts_are_removed(normalizer: ConfigNormalizer) -> None:
    assert normalizer.normalize(Platform.CISCO_IOSXE, CISCO_RUNNING) == (
        "hostname leaf-1\n"
        "interface GigabitEthernet2\n"
        " description Uplink\n"
        " ip address 10.0.1.1 255.255.255.254\n"
        "router bgp 65101\n"
        " neighbor 10.0.1.0 remote-as 65000\n"
    )


def test_arista_header_is_removed_and_indent_normalized(normalizer: ConfigNormalizer) -> None:
    running = (
        "! Command: show running-config\n"
        "! device: spine-1 (cEOS-lab, EOS-4.32.0F)\n"
        "!\n"
        "router bgp 65000\n"
        "  router-id 10.255.0.1\n"
        "  address-family ipv4\n"
        "      neighbor 10.0.1.1 activate\n"
        "!\n"
        "end\n"
    )
    assert normalizer.normalize(Platform.ARISTA_EOS, running) == (
        "router bgp 65000\n"
        "   router-id 10.255.0.1\n"
        "   address-family ipv4\n"
        "      neighbor 10.0.1.1 activate\n"
    )


def test_huawei_comment_marker(normalizer: ConfigNormalizer) -> None:
    running = "#\nsysname CE1\n#\ninterface GE1/0/1\n  undo shutdown\n#\nreturn\n"
    assert normalizer.normalize(Platform.HUAWEI_VRP, running) == (
        "sysname CE1\ninterface GE1/0/1\n undo shutdown\n"
    )


def test_normalization_is_idempotent(normalizer: ConfigNormalizer) -> None:
    once = normalizer.normalize(Platform.CISCO_IOSXE, CISCO_RUNNING)
    assert normalizer.normalize(Platform.CISCO_IOSXE, once) == once


def test_only_top_level_end_is_a_terminator(normalizer: ConfigNormalizer) -> None:
    config = "banner-like\n end\nend\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == "banner-like\n end\n"


def test_dedent_after_irregular_indentation(normalizer: ConfigNormalizer) -> None:
    config = "a\n    b\n  c\nd\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == "a\n b\n c\nd\n"


@pytest.mark.parametrize("text", ["", "!\n!\nend\n", "   \n\n"])
def test_empty_results(normalizer: ConfigNormalizer, text: str) -> None:
    assert normalizer.normalize(Platform.CISCO_IOSXE, text) == ""


def test_rules_can_be_extended_from_yaml(tmp_path: Path) -> None:
    rules_file = tmp_path / "rules.yaml"
    rules_file.write_text(
        "cisco_iosxe:\n"
        "  ignore_lines: ['^service timestamps']\n"
        "  ignore_sections: ['^line vty']\n"
    )
    normalizer = ConfigNormalizer.from_file(rules_file)
    config = "service timestamps log datetime\nline vty 0 4\n login local\nhostname x\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == "hostname x\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, "ntp clock-period 1\n") == ""


def test_invalid_rules_file(tmp_path: Path) -> None:
    rules_file = tmp_path / "rules.yaml"
    rules_file.write_text("- not a mapping\n")
    with pytest.raises(ValueError, match="expected a mapping"):
        ConfigNormalizer.from_file(rules_file)
