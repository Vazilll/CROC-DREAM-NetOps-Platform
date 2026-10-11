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


def test_only_managed_sections_are_compared(normalizer: ConfigNormalizer) -> None:
    running = (
        "hostname spine1\n"
        "username admin privilege 15 secret 9 $9$salt$hash\n"
        "interface GigabitEthernet1\n"
        " ip address 10.0.0.15 255.255.255.0\n"
        "interface GigabitEthernet2\n"
        " no shutdown\n"
        " ip address 10.0.1.0 255.255.255.254\n"
        "line vty 0 4\n"
        " login local\n"
        "ip access-list extended MGMT\n"
        " 10 permit ip any any\n"
    )
    assert normalizer.normalize(Platform.CISCO_IOSXE, running) == (
        "hostname spine1\n"
        "interface GigabitEthernet2\n"
        " ip address 10.0.1.0 255.255.255.254\n"
        "ip access-list extended MGMT\n"
        " 10 permit ip any any\n"
    )


def test_arista_header_management_and_indent(normalizer: ConfigNormalizer) -> None:
    running = (
        "! Command: show running-config\n"
        "! device: spine-2 (cEOS-lab, EOS-4.32.0F)\n"
        "!\n"
        "interface Management0\n"
        "   ip address 172.20.20.4/24\n"
        "ip routing\n"
        "router bgp 65000\n"
        "  router-id 10.255.0.2\n"
        "  address-family ipv4\n"
        "      neighbor 10.0.1.5 activate\n"
        "!\n"
        "end\n"
    )
    assert normalizer.normalize(Platform.ARISTA_EOS, running) == (
        "ip routing\n"
        "router bgp 65000\n"
        "   router-id 10.255.0.2\n"
        "   address-family ipv4\n"
        "      neighbor 10.0.1.5 activate\n"
    )


def test_huawei_running_config(normalizer: ConfigNormalizer) -> None:
    running = (
        "!Software Version V800R021C00SPC100\n"
        "!Last configuration was updated at 2026-10-05 03:20:00+00:00\n"
        "#\n"
        "sysname leaf1\n"
        "#\n"
        "aaa\n"
        " local-user admin password irreversible-cipher $1c$abc\n"
        "#\n"
        "interface MEth0/0/0\n"
        " ip address 10.0.0.15 255.255.255.0\n"
        "#\n"
        "interface GE1/0/0\n"
        " undo shutdown\n"
        " ip address 10.0.1.1 255.255.255.254\n"
        "#\n"
        "bgp 65101\n"
        " router-id 10.255.0.11\n"
        " peer 10.0.1.0 as-number 65000\n"
        "#\n"
        "return\n"
    )
    assert normalizer.normalize(Platform.HUAWEI_VRP, running) == (
        "sysname leaf1\n"
        "interface GE1/0/0\n"
        " ip address 10.0.1.1 255.255.255.254\n"
        "bgp 65101\n"
        " router-id 10.255.0.11\n"
        " peer 10.0.1.0 as-number 65000\n"
    )


def test_eltex_ports_with_spaces(normalizer: ConfigNormalizer) -> None:
    running = (
        "#!/usr/bin/clish\n"
        "#18\n"
        "hostname leaf-eltex\n"
        "interface gigabitethernet 1/0/0\n"
        "  ip address 10.0.0.15/24\n"
        "exit\n"
        "interface gigabitethernet 1/0/1\n"
        "    ip address 10.10.0.9/31\n"
    )
    assert normalizer.normalize(Platform.ELTEX_ESR, running) == (
        "hostname leaf-eltex\ninterface gigabitethernet 1/0/1\n  ip address 10.10.0.9/31\n"
    )


def test_every_platform_has_rules(normalizer: ConfigNormalizer) -> None:
    for platform in Platform:
        assert normalizer.rules_for(platform).managed_sections


def test_normalization_is_idempotent(normalizer: ConfigNormalizer) -> None:
    once = normalizer.normalize(Platform.CISCO_IOSXE, CISCO_RUNNING)
    assert normalizer.normalize(Platform.CISCO_IOSXE, once) == once


def test_only_top_level_end_is_a_terminator(normalizer: ConfigNormalizer) -> None:
    config = "router bgp 1\n end\nend\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == "router bgp 1\n end\n"


def test_dedent_after_irregular_indentation(normalizer: ConfigNormalizer) -> None:
    config = "interface Loopback0\n    a\n  b\nrouter bgp 1\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == (
        "interface Loopback0\n a\n b\nrouter bgp 1\n"
    )


@pytest.mark.parametrize("text", ["", "!\n!\nend\n", "   \n\n", "username a secret 0 b\n"])
def test_empty_results(normalizer: ConfigNormalizer, text: str) -> None:
    assert normalizer.normalize(Platform.CISCO_IOSXE, text) == ""


def _filters_file(tmp_path: Path, cisco: str) -> Path:
    others = "".join(f"  {p.value}: {{}}\n" for p in Platform if p is not Platform.CISCO_IOSXE)
    path = tmp_path / "diff_filters.yaml"
    path.write_text(f"platforms:\n  cisco_iosxe:\n{cisco}{others}")
    return path


def test_custom_filters_file(tmp_path: Path) -> None:
    path = _filters_file(
        tmp_path,
        "    mask_secrets:\n"
        "    - re: '^(username \\S+ secret \\d) \\S+'\n"
        "      replace: '\\1 <hash>'\n"
        "    drop_line_patterns:\n"
        "    - re: '^service timestamps'\n",
    )
    normalizer = ConfigNormalizer.from_file(path)
    config = "service timestamps log\nusername admin secret 9 $9$x$y\nline vty 0 4\n login\n"
    assert normalizer.normalize(Platform.CISCO_IOSXE, config) == (
        "username admin secret 9 <hash>\nline vty 0 4\n login\n"
    )


def test_filters_file_must_cover_every_platform(tmp_path: Path) -> None:
    path = tmp_path / "diff_filters.yaml"
    path.write_text("platforms:\n  cisco_iosxe: {}\n")
    with pytest.raises(ValueError, match="no rules for platform"):
        ConfigNormalizer.from_file(path)


def test_invalid_filters_file(tmp_path: Path) -> None:
    path = tmp_path / "diff_filters.yaml"
    path.write_text("- not a mapping\n")
    with pytest.raises(ValueError, match="expected a 'platforms' mapping"):
        ConfigNormalizer.from_file(path)
