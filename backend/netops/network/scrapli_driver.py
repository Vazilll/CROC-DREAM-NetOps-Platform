"""Live network driver for Containerlab using Scrapli (spec 2.4, 2.6).

Connects over SSH to Cisco IOS-XE, Arista EOS, and Huawei VRP nodes, runs commands,
stages changes inside transaction sessions, and takes operational health snapshots.
"""

from __future__ import annotations

import concurrent.futures
import contextlib
import logging
import os
import re
import time
from collections.abc import Mapping, Sequence
from types import MappingProxyType

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
from netops.network.ssh_pool import (
    _CLI_METRICS_DEDUP_SEC,
    _DEAD_ENDPOINTS,
    _DEVICE_LOCKS,
    _JUMP_LOCK,
    _LAST_CLI_METRICS_TS,
    _POOL_GUARD,
    _SESSION_IDLE_TTL,
    _SESSION_POOL,
    _check_tcp_endpoint,
    _close_pooled_session,
    _get_device_lock,
    connect_with_sock,
    establish_fresh_session,
    execute_shell_command,
    execute_shell_configs,
    open_jump_channel,
    resolve_clab_jump_defaults,
    resolve_container_endpoint,
)
from netops.network.table_parsers import collect_device_health_tables
from netops.services.telemetry import collect_metrics_from_cli

logger = logging.getLogger(__name__)

ARISTA_SESSION = "NETOPS_DEPLOY"
HUAWEI_COMMIT_LIST = "display configuration commit list"
_COMMIT_ID = re.compile(r"\b(\d{6,})\b")

SCRAPLI_PLATFORMS: Mapping[Platform, str] = MappingProxyType(
    {
        Platform.CISCO_IOSXE: "cisco_iosxe",
        Platform.ARISTA_EOS: "arista_eos",
        Platform.HUAWEI_VRP: "huawei_vrp",
        Platform.JUNIPER_JUNOS: "juniper_junos",
        Platform.ELTEX_ESR: "eltex_esr",
        Platform.ELTEX_MES: "eltex_mes",
        Platform.YADRO_KORNFE: "yadro_kornfe",
        Platform.LINUX_SERVER: "linux_server",
    }
)

TRANSACTIONAL_PLATFORMS = frozenset(
    {Platform.CISCO_IOSXE, Platform.ARISTA_EOS, Platform.HUAWEI_VRP}
)


def _latest_commit_id(output: str) -> str | None:
    for line in output.splitlines():
        match = _COMMIT_ID.search(line)
        if match:
            return match.group(1)
    return None


class _ScrapliResponse:
    """Mock Scrapli response wrapper for Paramiko operations."""

    def __init__(self, result: str, failed: bool = False) -> None:
        self.result = result
        self.failed = failed


class _ParamikoConnAdapter:
    """Transparent SSH adapter with per-device lock and persistent session pooling."""

    def __init__(
        self, target: DeviceTarget, timeout: int = 15, proxy_jump: str | None = None
    ) -> None:
        self.target = target
        self.timeout = timeout
        self.proxy_jump = proxy_jump
        self.client = None
        self._jump_client = None
        self.shell = None
        self.authenticated_password: str | None = None
        self._device_lock = None
        self._use_pool: bool = False
        self._invalidate_pool: bool = False

    def _resolve_clab_jump_defaults(self) -> tuple[str, str, int, str | None]:
        return resolve_clab_jump_defaults()

    def _resolve_container_endpoint(
        self, host: str, dest_host: str, dest_port: int
    ) -> tuple[str, int]:
        return resolve_container_endpoint(host, dest_host, dest_port)

    def _open_jump_channel(self, paramiko_mod, jump_spec: str, dest_host: str, dest_port: int):
        return open_jump_channel(self, paramiko_mod, jump_spec, dest_host, dest_port)

    def _connect_with_sock(self, paramiko_mod, username: str, password: str, sock=None) -> None:
        connect_with_sock(self, paramiko_mod, username, password, sock=sock)

    def _establish_fresh_session(self) -> None:
        establish_fresh_session(self)

    def __enter__(self):
        key = (self.target.host, self.target.port)
        self._device_lock = _get_device_lock(self.target.host, self.target.port)
        self._device_lock.acquire()
        try:
            self._use_pool = "PYTEST_CURRENT_TEST" not in os.environ
            if self._use_pool:
                with _POOL_GUARD:
                    pooled = _SESSION_POOL.get(key)
                if pooled is not None:
                    now = time.monotonic()
                    last_used = float(pooled.get("last_used") or 0.0)
                    client = pooled.get("client")
                    shell = pooled.get("shell")
                    transport = (
                        client.get_transport()  # type: ignore[attr-defined]
                        if client is not None and hasattr(client, "get_transport")
                        else None
                    )
                    shell_alive = bool(
                        shell is not None and not getattr(shell, "closed", False)
                    )
                    if (
                        (now - last_used) < _SESSION_IDLE_TTL
                        and transport is not None
                        and transport.is_active()
                        and shell_alive
                    ):
                        self.client = client
                        self.shell = shell
                        self._jump_client = pooled.get("jump_client")
                        self.authenticated_password = pooled.get("authenticated_password")  # type: ignore[assignment]
                        pooled["last_used"] = now
                        return self
                    _close_pooled_session(self.target.host, self.target.port)

            self._establish_fresh_session()
            if self._use_pool and self.client is not None and self.shell is not None:
                with _POOL_GUARD:
                    _SESSION_POOL[key] = {
                        "client": self.client,
                        "shell": self.shell,
                        "jump_client": self._jump_client,
                        "platform": self.target.platform,
                        "authenticated_password": self.authenticated_password,
                        "last_used": time.monotonic(),
                    }
            return self
        except Exception:
            self._device_lock.release()
            self._device_lock = None
            raise

    def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
        try:
            key = (self.target.host, self.target.port)
            if self._use_pool and exc_type is None and not self._invalidate_pool:
                with _POOL_GUARD:
                    if key in _SESSION_POOL:
                        _SESSION_POOL[key]["last_used"] = time.monotonic()
                        return
            if self._use_pool:
                _close_pooled_session(self.target.host, self.target.port)
                return

            if self.shell is not None:
                with contextlib.suppress(Exception):
                    if self.target.platform == Platform.HUAWEI_VRP:
                        self.shell.send("return\nquit\ny\n")
                    else:
                        self.shell.send("exit\n")
                    time.sleep(0.1)
                    self.shell.close()
            if self.client:
                self.client.close()
            if self._jump_client:
                self._jump_client.close()
        finally:
            if self._device_lock is not None:
                self._device_lock.release()
                self._device_lock = None

    def send_command(self, cmd: str) -> _ScrapliResponse:
        return _ScrapliResponse(execute_shell_command(self, cmd))

    def send_configs(self, lines: Sequence[str]) -> _ScrapliResponse:
        return _ScrapliResponse(execute_shell_configs(self, lines))


class ScrapliNetworkDriver:
    """ConfigCollector, ConfigDeployer, and HealthProbe via Scrapli with Paramiko fallback."""

    def __init__(self, max_workers: int = 6, timeout_socket: int = 15) -> None:
        self.max_workers = max_workers
        self.timeout_socket = timeout_socket
        self._commit_ids: dict[str, str | None] = {}

    def _get_connection(self, target: DeviceTarget):
        return _ParamikoConnAdapter(
            target, timeout=self.timeout_socket, proxy_jump=target.proxy_jump
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
        if target.platform == Platform.HUAWEI_VRP:
            cmd = "display current-configuration"
        elif target.platform == Platform.LINUX_SERVER:
            cmd = "ip addr show"
        else:
            cmd = "show running-config"
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                with self._get_connection(target) as conn:
                    response = conn.send_command(cmd)
                    if response.failed:
                        raise RuntimeError(f"Command '{cmd}' failed: {response.result}")
                    if not response.result.strip():
                        raise RuntimeError("Empty response from device")
                    from netops.telemetry.targets import is_externally_collected

                    now_ts = time.monotonic()
                    last_m = _LAST_CLI_METRICS_TS.get(target.hostname, 0.0)
                    if not is_externally_collected(target.hostname) and (
                        now_ts - last_m >= _CLI_METRICS_DEDUP_SEC
                    ):
                        _LAST_CLI_METRICS_TS[target.hostname] = now_ts
                        collect_metrics_from_cli(
                            target.hostname,
                            target.platform.value,
                            lambda c: conn.send_command(c).result,
                        )
                    return response.result
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Fetch attempt %d/2 failed for %s: %s", attempt + 1, target.hostname, exc
                )
                err_str = str(exc).lower()
                fast_fail = (
                    "no existing session",
                    "protocol banner",
                    "connection refused",
                    "timed out",
                )
                if any(x in err_str for x in fast_fail):
                    break
                time.sleep(1.0)
        raise RuntimeError(str(last_exc))

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        lines = [
            line.strip()
            for line in plan.remediation.splitlines()
            if line.strip() and not line.startswith(("!", "#"))
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
            elif target.platform == Platform.HUAWEI_VRP:
                self._commit_ids[target.hostname] = _latest_commit_id(
                    conn.send_command(HUAWEI_COMMIT_LIST).result
                )
                conn.send_configs(lines)
                conn.send_command("commit")
            else:
                conn.send_configs(lines)

    def confirm(self, target: DeviceTarget) -> None:
        if target.platform is Platform.HUAWEI_VRP:
            self._commit_ids.pop(target.hostname, None)
            return
        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_command("commit")
                conn.send_command("write memory")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command(f"configure session {ARISTA_SESSION}")
                conn.send_command("commit")
                conn.send_command("write memory")
            else:
                conn.send_command("write memory")

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
                if line.strip() and not line.startswith(("!", "#"))
            ]
            if rollback_lines:
                conn.send_configs(rollback_lines)

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

    def snapshot(
        self, target: DeviceTarget, expected: HealthExpectations | None
    ) -> HealthSnapshot:
        with self._get_connection(target) as conn:
            return collect_device_health_tables(
                conn,
                target,
                expected,
                last_cli_metrics_ts=_LAST_CLI_METRICS_TS,
                cli_metrics_dedup_sec=_CLI_METRICS_DEDUP_SEC,
            )


__all__ = [
    "ARISTA_SESSION",
    "HUAWEI_COMMIT_LIST",
    "SCRAPLI_PLATFORMS",
    "TRANSACTIONAL_PLATFORMS",
    "_DEAD_ENDPOINTS",
    "_DEVICE_LOCKS",
    "_JUMP_LOCK",
    "_LAST_CLI_METRICS_TS",
    "_SESSION_POOL",
    "BgpSessionState",
    "InterfaceState",
    "ScrapliNetworkDriver",
    "_ParamikoConnAdapter",
    "_check_tcp_endpoint",
    "_latest_commit_id",
]
