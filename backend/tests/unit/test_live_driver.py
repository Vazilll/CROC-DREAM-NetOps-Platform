from __future__ import annotations

from collections.abc import Sequence

import pytest

from netops.enums import Platform
from netops.network.base import ChangePlan, Credentials, DeviceTarget
from netops.network.scrapli_driver import (
    HUAWEI_COMMIT_LIST,
    SCRAPLI_PLATFORMS,
    TRANSACTIONAL_PLATFORMS,
    ScrapliNetworkDriver,
    _latest_commit_id,
)

PLAN = ChangePlan(remediation="hostname x\n", rollback="hostname y\n", intended="hostname x\n")


def _target(platform: Platform, hostname: str = "node.croc.lab") -> DeviceTarget:
    return DeviceTarget(
        hostname=hostname,
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


class FakeConnection:
    """Записывает команды вместо отправки на устройство."""

    def __init__(self, commit_list: str = "", default_output: str = "") -> None:
        self.commands: list[str] = []
        self.configs: list[list[str]] = []
        self._commit_list = commit_list
        self._default_output = default_output

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def send_command(self, command: str) -> object:
        self.commands.append(command)
        text = self._commit_list if command == HUAWEI_COMMIT_LIST else self._default_output
        return type("R", (), {"result": text, "failed": False})()

    def send_configs(self, lines: Sequence[str]) -> object:
        self.configs.append(list(lines))
        return type("R", (), {"result": "", "failed": False})()


COMMIT_LIST = """\
 CommitId  Label     User
 1000000013           admin
 1000000012           admin
"""


def _driver_with(conn: FakeConnection) -> ScrapliNetworkDriver:
    driver = ScrapliNetworkDriver()
    driver._get_connection = lambda target: conn  # type: ignore[method-assign]
    return driver


def test_huawei_apply_remembers_commit_point() -> None:
    conn = FakeConnection(COMMIT_LIST)
    driver = _driver_with(conn)

    driver.apply(_target(Platform.HUAWEI_VRP), PLAN, confirm_timeout=180)

    assert conn.commands == [HUAWEI_COMMIT_LIST, "commit"]
    assert conn.configs == [["hostname x"]]
    assert driver._commit_ids["node.croc.lab"] == "1000000013"


def test_huawei_rollback_returns_to_that_commit() -> None:
    conn = FakeConnection(COMMIT_LIST)
    driver = _driver_with(conn)
    driver.apply(_target(Platform.HUAWEI_VRP), PLAN, confirm_timeout=180)

    driver.rollback(_target(Platform.HUAWEI_VRP), PLAN)

    assert conn.commands[-3:] == [
        "system-view",
        "rollback configuration to commit-id 1000000013",
        "commit",
    ]


def test_huawei_rollback_without_commit_id_undoes_last_change() -> None:
    conn = FakeConnection()
    driver = _driver_with(conn)
    driver.apply(_target(Platform.HUAWEI_VRP), PLAN, confirm_timeout=180)

    driver.rollback(_target(Platform.HUAWEI_VRP), PLAN)

    assert "rollback configuration last 1" in conn.commands


def test_huawei_confirm_only_forgets_the_commit_point() -> None:
    conn = FakeConnection(COMMIT_LIST)
    driver = _driver_with(conn)
    driver.apply(_target(Platform.HUAWEI_VRP), PLAN, confirm_timeout=180)
    before = len(conn.commands)

    driver.confirm(_target(Platform.HUAWEI_VRP))

    assert len(conn.commands) == before
    assert "node.croc.lab" not in driver._commit_ids


def test_run_read_only_returns_output() -> None:
    conn = FakeConnection(default_output="Huawei Versatile Routing Platform Software\n")
    driver = _driver_with(conn)
    target = _target(Platform.HUAWEI_VRP)

    out = driver.run_read_only(target, "display version")

    assert "Huawei Versatile Routing Platform Software" in out
    assert conn.commands == ["display version"]


def test_latest_commit_id_parsing() -> None:
    assert _latest_commit_id("") is None
    assert _latest_commit_id("No commits recorded") is None
    assert _latest_commit_id(COMMIT_LIST) == "1000000013"
    single = " 1000000042 system user "
    assert _latest_commit_id(single) == "1000000042"
