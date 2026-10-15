from __future__ import annotations

import pytest

from netops.enums import Platform
from netops.network.base import ChangePlan, Credentials, DeviceTarget
from netops.network.scrapli_driver import (
    SCRAPLI_PLATFORMS,
    TRANSACTIONAL_PLATFORMS,
    ScrapliNetworkDriver,
)

PLAN = ChangePlan(remediation="hostname x\n", rollback="hostname y\n", intended="hostname x\n")


def _target(platform: Platform) -> DeviceTarget:
    return DeviceTarget(
        hostname="node.croc.lab",
        platform=platform,
        host="127.0.0.1",
        port=2211,
        credentials=Credentials("admin", "admin"),
    )


def test_every_platform_has_a_scrapli_name() -> None:
    assert set(SCRAPLI_PLATFORMS) == set(Platform)


@pytest.mark.parametrize("platform", sorted(set(Platform) - TRANSACTIONAL_PLATFORMS))
def test_deploy_is_refused_without_transaction_support(platform: Platform) -> None:
    with pytest.raises(RuntimeError, match="не реализовано"):
        ScrapliNetworkDriver().apply(_target(platform), PLAN, confirm_timeout=180)


def test_empty_patch_touches_nothing() -> None:
    empty = ChangePlan(remediation="", rollback="", intended="")
    ScrapliNetworkDriver().apply(_target(Platform.HUAWEI_VRP), empty, confirm_timeout=180)
