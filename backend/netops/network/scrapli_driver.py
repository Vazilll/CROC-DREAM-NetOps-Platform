"""Live network driver for Containerlab using Scrapli (spec 2.4, 2.6).

Connects over SSH to Cisco IOS-XE and Arista EOS nodes, runs commands,
stages changes inside transaction sessions, and takes operational health snapshots.
"""

from __future__ import annotations

import concurrent.futures
import logging
import re
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, ClassVar

from netops.enums import Platform
from netops.network.base import (
    BgpSessionState,
    ChangePlan,
    DeviceTarget,
    FetchResult,
    HealthExpectations,
    HealthSnapshot,
    InterfaceState,
)

logger = logging.getLogger(__name__)

# Имена платформ для фабрики Scrapli: первые две из ядра, остальные из scrapli-community.
SCRAPLI_PLATFORMS: Mapping[Platform, str] = MappingProxyType(
    {
        Platform.CISCO_IOSXE: "cisco_iosxe",
        Platform.ARISTA_EOS: "arista_eos",
        Platform.HUAWEI_VRP: "huawei_vrp",
        Platform.ELTEX_ESR: "eltex_esr",
    }
)

# Транзакции: Cisco — commit confirmed, Arista — configure session с таймером,
# Huawei — двухэтапный commit с откатом на снятый заранее commit-id.
# Для Eltex механизма пока нет, и молча «применить» нельзя.
TRANSACTIONAL_PLATFORMS = frozenset(
    {Platform.CISCO_IOSXE, Platform.ARISTA_EOS, Platform.HUAWEI_VRP}
)

ARISTA_SESSION = "NETOPS_DEPLOY"
HUAWEI_COMMIT_LIST = "display configuration commit list"
_COMMIT_ID = re.compile(r"\b(\d{6,})\b")


# В выводе display configuration commit list самый свежий commit-id идёт первым.
def _latest_commit_id(output: str) -> str | None:
    for line in output.splitlines():
        match = _COMMIT_ID.search(line)
        if match:
            return match.group(1)
    return None


@dataclass(frozen=True, slots=True)
class _ShellResult:
    result: str
    failed: bool = False


# Минимальная замена Scrapli: те же методы send_command и send_configs, но поверх
# интерактивной shell-сессии paramiko. Нужна там, где нет системного ssh — например,
# внутри нашего Docker-образа.
class _ParamikoShell:
    _PAGER_OFF: ClassVar[Mapping[Platform, tuple[str, ...]]] = {
        Platform.CISCO_IOSXE: ("terminal length 0",),
        Platform.ARISTA_EOS: ("enable", "terminal length 0"),
        Platform.HUAWEI_VRP: ("screen-length 0 temporary",),
    }
    _CONFIG_MODE: ClassVar[Mapping[Platform, tuple[str, str]]] = {
        Platform.CISCO_IOSXE: ("configure terminal", "end"),
        Platform.ARISTA_EOS: ("configure terminal", "end"),
        Platform.HUAWEI_VRP: ("system-view", "return"),
    }

    def __init__(self, target: DeviceTarget, *, timeout: int = 15) -> None:
        self._target = target
        self._timeout = timeout
        self._client: Any = None
        self._shell: Any = None

    def __enter__(self) -> _ParamikoShell:
        import paramiko  # noqa: PLC0415

        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self._client.connect(
            self._target.host,
            port=self._target.port,
            username=self._target.credentials.username,
            password=self._target.credentials.password,
            look_for_keys=False,
            allow_agent=False,
            timeout=self._timeout,
        )
        self._shell = self._client.invoke_shell()
        self._drain()
        for command in self._PAGER_OFF.get(self._target.platform, ()):
            self._write(command)
        self._drain()
        return self

    def __exit__(self, *_: object) -> None:
        if self._client is not None:
            self._client.close()

    def send_command(self, command: str) -> _ShellResult:
        self._write(command)
        return _ShellResult(self._read())

    def send_configs(self, lines: Sequence[str]) -> _ShellResult:
        enter, leave = self._CONFIG_MODE.get(self._target.platform, ("configure terminal", "end"))
        self._write(enter)
        for line in lines:
            self._write(line)
        self._write(leave)
        return _ShellResult(self._read())

    def _write(self, command: str) -> None:
        if self._shell is None:
            raise RuntimeError("SSH-сессия не открыта")
        self._shell.send(f"{command}\n")
        time.sleep(0.1)

    def _read(self) -> str:
        if self._shell is None:
            raise RuntimeError("SSH-сессия не открыта")
        deadline = time.monotonic() + self._timeout
        chunks: list[str] = []
        while time.monotonic() < deadline:
            if self._shell.recv_ready():
                chunks.append(self._shell.recv(8192).decode("utf-8", errors="ignore"))
                time.sleep(0.1)
                continue
            if chunks:
                time.sleep(0.2)
                if not self._shell.recv_ready():
                    break
            else:
                time.sleep(0.2)
        return "".join(chunks)

    def _drain(self) -> None:
        time.sleep(0.5)
        while self._shell is not None and self._shell.recv_ready():
            self._shell.recv(8192)


class ScrapliNetworkDriver:
    """Implements ConfigCollector, ConfigDeployer, and HealthProbe via Scrapli."""

    def __init__(self, max_workers: int = 4, timeout_socket: int = 15) -> None:
        self.max_workers = max_workers
        self.timeout_socket = timeout_socket
        # Huawei: commit-id до изменения, чтобы было куда откатываться.
        self._commit_ids: dict[str, str | None] = {}

    # Драйвер выбирает фабрика Scrapli по имени платформы: Cisco и Arista — из ядра,
    # Huawei VRP и Eltex ESR — из scrapli-community. Scrapli ходит через системный ssh;
    # если его в окружении нет, работаем обычной shell-сессией через paramiko.
    def _get_connection(self, target: DeviceTarget) -> Any:
        try:
            from scrapli import Scrapli  # noqa: PLC0415
        except ImportError:
            logger.info("Scrapli не установлен, подключаемся через paramiko")
            return _ParamikoShell(target, timeout=self.timeout_socket)
        creds = target.credentials
        return Scrapli(
            platform=SCRAPLI_PLATFORMS[target.platform],
            host=target.host,
            port=target.port,
            auth_username=creds.username,
            auth_password=getattr(creds, "password", ""),
            auth_strict_key=False,
            transport="system",
            timeout_socket=self.timeout_socket,
        )

    def fetch_running_configs(self, targets: Sequence[DeviceTarget]) -> Mapping[str, FetchResult]:
        results: dict[str, FetchResult] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_host = {
                executor.submit(self._fetch_single, target): target.hostname for target in targets
            }
            for future in concurrent.futures.as_completed(future_to_host):
                hostname = future_to_host[future]
                try:
                    config = future.result()
                    results[hostname] = FetchResult.success(config)
                except Exception as exc:
                    logger.warning("Failed to collect running-config from %s: %s", hostname, exc)
                    results[hostname] = FetchResult.failure(str(exc))
        return results

    def _fetch_single(self, target: DeviceTarget) -> str:
        cmd = "show running-config"
        with self._get_connection(target) as conn:
            response = conn.send_command(cmd)
            if response.failed:
                raise RuntimeError(f"Command '{cmd}' failed: {response.result}")
            return str(response.result)

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        lines = [
            line.strip()
            for line in plan.remediation.splitlines()
            if line.strip() and not line.startswith("!")
        ]
        if not lines:
            return
        if target.platform not in TRANSACTIONAL_PLATFORMS:
            raise RuntimeError(
                f"Транзакционное применение для {target.platform.value} не реализовано: "
                "нужны commit/rollback этой платформы, иначе откат не гарантирован"
            )

        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_configs(lines)
                conn.send_command(f"commit confirmed {confirm_timeout}")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command(f"configure session {ARISTA_SESSION}")
                conn.send_configs(lines)
                conn.send_command(f"commit timer {confirm_timeout}")
            else:
                # VRP применяет изменения сразу по commit, таймера подтверждения нет.
                # Поэтому до изменения запоминаем commit-id — на него и откатываемся.
                self._commit_ids[target.hostname] = _latest_commit_id(
                    conn.send_command(HUAWEI_COMMIT_LIST).result
                )
                conn.send_configs(lines)
                conn.send_command("commit")

    def confirm(self, target: DeviceTarget) -> None:
        # На VRP изменение уже зафиксировано commit, подтверждать нечего — просто
        # забываем точку отката.
        if target.platform is Platform.HUAWEI_VRP:
            self._commit_ids.pop(target.hostname, None)
            return
        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_command("commit")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command(f"configure session {ARISTA_SESSION}")
                conn.send_command("commit")

    def rollback(self, target: DeviceTarget, plan: ChangePlan) -> None:
        if target.platform is Platform.HUAWEI_VRP:
            self._rollback_huawei(target)
            return
        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_command("abort")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command(f"configure session {ARISTA_SESSION}")
                conn.send_command("abort")

            rollback_lines = [
                line.strip()
                for line in plan.rollback.splitlines()
                if line.strip() and not line.startswith("!")
            ]
            if rollback_lines:
                conn.send_configs(rollback_lines)

    # Откат на VRP: возвращаемся к состоянию до нашего commit. Если commit-id снять не
    # удалось, откатываем последнее изменение.
    def _rollback_huawei(self, target: DeviceTarget) -> None:
        commit_id = self._commit_ids.pop(target.hostname, None)
        command = (
            f"rollback configuration to commit-id {commit_id}"
            if commit_id
            else "rollback configuration last 1"
        )
        with self._get_connection(target) as conn:
            conn.send_command("system-view")
            conn.send_command(command)
            conn.send_command("commit")

    def snapshot(self, target: DeviceTarget, expected: HealthExpectations | None) -> HealthSnapshot:
        bgp_sessions: dict[str, BgpSessionState] = {}
        interfaces: dict[str, InterfaceState] = {}
        ping_losses: dict[str, float] = {}

        with self._get_connection(target) as conn:
            bgp_out = conn.send_command("show ip bgp summary").result
            for line in bgp_out.splitlines():
                match = re.search(
                    r"^(\d+\.\d+\.\d+\.\d+)\s+.*?\s+(\d+|Active|Idle|Connect)$", line.strip()
                )
                if match:
                    peer_ip, state_or_pfx = match.groups()
                    if state_or_pfx.isdigit():
                        bgp_sessions[peer_ip] = BgpSessionState(
                            "Established", prefixes_accepted=int(state_or_pfx)
                        )
                    else:
                        bgp_sessions[peer_ip] = BgpSessionState(state_or_pfx, prefixes_accepted=0)

            int_out = conn.send_command("show ip interface brief").result
            for line in int_out.splitlines():
                parts = line.split()
                if target.platform == Platform.CISCO_IOSXE and len(parts) >= 6:
                    if parts[0].startswith("Gigabit") or parts[0].startswith("Loop"):
                        interfaces[parts[0]] = InterfaceState(status=parts[4], protocol=parts[5])
                elif (
                    target.platform == Platform.ARISTA_EOS
                    and len(parts) >= 4
                    and (parts[0].startswith("Ethernet") or parts[0].startswith("Loop"))
                ):
                    status = "up" if "up" in parts[1].lower() else "down"
                    proto = "up" if "up" in parts[2].lower() else "down"
                    interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)

            if expected:
                for peer in expected.bgp_peers:
                    ping_cmd = (
                        f"ping {peer} repeat 5"
                        if target.platform == Platform.CISCO_IOSXE
                        else f"ping {peer} count 5"
                    )
                    ping_out = conn.send_command(ping_cmd).result
                    rate_match = re.search(r"Success rate is (\d+) percent", ping_out)
                    ping_losses[peer] = (100.0 - float(rate_match.group(1))) if rate_match else 0.0

        return HealthSnapshot(
            bgp_sessions=bgp_sessions,
            interfaces=interfaces,
            ping_loss_percent=ping_losses,
        )
