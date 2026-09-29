from __future__ import annotations

from pathlib import Path

import pytest

from netops.intent import DeviceIntent, InventoryDevice
from netops.network import JinjaConfigRenderer, RenderError
from tests.conftest import TEMPLATES

DEVICE = InventoryDevice(
    hostname="leaf-1.croc.lab",
    management_ip="172.20.20.21",
    platform="cisco_iosxe",
    role="leaf",
    auth_profile="lab",
)
INTENT = DeviceIntent.model_validate(
    {
        "hostname": "leaf-1.croc.lab",
        "interfaces": [{"name": "GigabitEthernet2", "ipv4_address": "10.0.1.1/31"}],
        "bgp": {"asn": 65101, "router_id": "10.255.1.1"},
    }
)


def test_sections_are_rendered_in_order() -> None:
    config = JinjaConfigRenderer(TEMPLATES).render(DEVICE, INTENT)
    lines = config.splitlines()
    assert lines[0] == "hostname leaf-1.croc.lab"
    assert lines.index("interface GigabitEthernet2") < lines.index("router bgp 65101")
    assert " ip address 10.0.1.1 255.255.255.254" in lines
    assert config.endswith("\n")


def test_missing_sections_are_skipped(tmp_path: Path) -> None:
    (tmp_path / "cisco_iosxe").mkdir()
    (tmp_path / "cisco_iosxe" / "bgp.j2").write_text("router bgp {{ intent.bgp.asn }}\n")
    assert JinjaConfigRenderer(tmp_path).render(DEVICE, INTENT) == "router bgp 65101\n"


def test_platform_without_templates(tmp_path: Path) -> None:
    with pytest.raises(RenderError, match="No templates found for platform cisco_iosxe"):
        JinjaConfigRenderer(tmp_path).render(DEVICE, INTENT)


def test_undefined_variables_fail_loudly(tmp_path: Path) -> None:
    (tmp_path / "cisco_iosxe").mkdir()
    (tmp_path / "cisco_iosxe" / "base.j2").write_text("hostname {{ intent.domain_name }}\n")
    with pytest.raises(RenderError, match=r"base\.j2"):
        JinjaConfigRenderer(tmp_path).render(DEVICE, INTENT)


def test_template_syntax_errors_are_reported(tmp_path: Path) -> None:
    (tmp_path / "cisco_iosxe").mkdir()
    (tmp_path / "cisco_iosxe" / "base.j2").write_text("{% if %}\n")
    with pytest.raises(RenderError, match=r"cisco_iosxe/base\.j2"):
        JinjaConfigRenderer(tmp_path).render(DEVICE, INTENT)
