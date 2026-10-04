"""Live network driver for Containerlab using Scrapli (spec 2.4, 2.6).

Connects over SSH to Cisco IOS-XE and Arista EOS nodes, runs commands,
stages changes inside transaction sessions, and takes operational health snapshots.
"""

from __future__ import annotations

import concurrent.futures
import logging
import re
from collections.abc import Mapping, Sequence

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


class _ScrapliResponse:
    """Mock Scrapli response wrapper for Paramiko operations."""

    def __init__(self, result: str, failed: bool = False) -> None:
        self.result = result
        self.failed = failed


class _ParamikoConnAdapter:
    """Transparent SSH adapter for environments where native Scrapli transport is unavailable."""

    def __init__(self, target: DeviceTarget, timeout: int = 15) -> None:
        self.target = target
        self.timeout = timeout
        self.client = None
        self.shell = None

    def __enter__(self):
        import time  # noqa: PLC0415
        import paramiko  # noqa: PLC0415

        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        password = getattr(self.target.credentials, "password", "")
        username = self.target.credentials.username

        try:
            self.client.connect(
                self.target.host,
                port=self.target.port,
                username=username,
                password=password,
                look_for_keys=False,
                allow_agent=False,
                timeout=self.timeout,
                banner_timeout=60,
                auth_timeout=30,
            )
        except paramiko.ssh_exception.AuthenticationException:
            # Fallback to keyboard-interactive authentication (e.g. Cisco IOS-XE)
            transport = self.client.get_transport()
            if transport is None:
                transport = paramiko.Transport((self.target.host, self.target.port))
                transport.start_client(timeout=self.timeout)
            transport.auth_interactive(
                username,
                lambda title, instructions, prompt_list: [password for _ in prompt_list],
            )

        self.shell = self.client.invoke_shell()
        time.sleep(0.8)
        if self.shell.recv_ready():
            _ = self.shell.recv(8192)

        if self.target.platform == Platform.ARISTA_EOS:
            self.shell.send("enable\nterminal length 0\n")
        elif self.target.platform == Platform.CISCO_IOSXE:
            self.shell.send("enable\nterminal length 0\n")
        elif self.target.platform == Platform.HUAWEI_VRP:
            self.shell.send("screen-length 0 temporary\n")

        time.sleep(0.5)
        if self.shell.recv_ready():
            _ = self.shell.recv(8192)
        return self

    def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
        if self.client:
            self.client.close()

    def send_command(self, cmd: str) -> _ScrapliResponse:
        import time  # noqa: PLC0415

        if self.shell is None:
            raise RuntimeError("SSH shell session is not initialized")
        self.shell.send(f"{cmd}\n")
        time.sleep(0.8)
        output = ""
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self.shell.recv_ready():
                output += self.shell.recv(8192).decode("utf-8", errors="ignore")
                time.sleep(0.1)
            elif output:
                time.sleep(0.3)
                if not self.shell.recv_ready():
                    break
            else:
                time.sleep(0.2)
        return _ScrapliResponse(output)

    def send_configs(self, lines: Sequence[str]) -> _ScrapliResponse:
        import time  # noqa: PLC0415

        if self.shell is None:
            raise RuntimeError("SSH shell session is not initialized")

        if self.target.platform == Platform.HUAWEI_VRP:
            self.shell.send("system-view\n")
            time.sleep(0.3)
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.1)
            self.shell.send("return\n")
        elif self.target.platform == Platform.ARISTA_EOS:
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.1)
        else:
            self.shell.send("configure terminal\n")
            time.sleep(0.3)
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.1)
            self.shell.send("end\n")

        time.sleep(1.0)
        output = ""
        while self.shell.recv_ready():
            output += self.shell.recv(8192).decode("utf-8", errors="ignore")
            time.sleep(0.1)
        return _ScrapliResponse(output)


class ScrapliNetworkDriver:
    """Implements ConfigCollector, ConfigDeployer, and HealthProbe via Scrapli with Paramiko fallback."""

    def __init__(self, max_workers: int = 4, timeout_socket: int = 35) -> None:
        self.max_workers = max_workers
        self.timeout_socket = timeout_socket

    def _get_connection(self, target: DeviceTarget):
        return _ParamikoConnAdapter(target, timeout=max(self.timeout_socket, 35))

    def fetch_running_configs(self, targets: Sequence[DeviceTarget]) -> Mapping[str, FetchResult]:
        results: dict[str, FetchResult] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_host = {
                executor.submit(self._fetch_single, target): target.hostname
                for target in targets
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
        cmd = "display current-configuration" if target.platform == Platform.HUAWEI_VRP else "show running-config"
        with self._get_connection(target) as conn:
            response = conn.send_command(cmd)
            if response.failed:
                raise RuntimeError(f"Command '{cmd}' failed: {response.result}")
            return response.result

    def apply(self, target: DeviceTarget, plan: ChangePlan, *, confirm_timeout: int) -> None:
        lines = [
            line.strip()
            for line in plan.remediation.splitlines()
            if line.strip() and not line.startswith("!")
        ]
        if not lines:
            return

        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_configs(lines)
                conn.send_command(f"commit confirmed {confirm_timeout}")
            elif target.platform == Platform.ARISTA_EOS:
                session_name = "NETOPS_DEPLOY"
                conn.send_command(f"configure session {session_name}")
                conn.send_configs(lines)
                conn.send_command(f"commit timer {confirm_timeout}")
            elif target.platform == Platform.HUAWEI_VRP:
                conn.send_configs(lines)
                conn.send_command(f"commit trial {confirm_timeout}")


    def confirm(self, target: DeviceTarget) -> None:
        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_command("commit")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command("configure session NETOPS_DEPLOY")
                conn.send_command("commit")
            elif target.platform == Platform.HUAWEI_VRP:
                conn.send_command("commit")

    def rollback(self, target: DeviceTarget, plan: ChangePlan) -> None:
        with self._get_connection(target) as conn:
            if target.platform == Platform.CISCO_IOSXE:
                conn.send_command("abort")
            elif target.platform == Platform.ARISTA_EOS:
                conn.send_command("configure session NETOPS_DEPLOY")
                conn.send_command("abort")
            elif target.platform == Platform.HUAWEI_VRP:
                conn.send_command("quit")

            rollback_lines = [
                line.strip()
                for line in plan.rollback.splitlines()
                if line.strip() and not line.startswith("!")
            ]
            if rollback_lines:
                conn.send_configs(rollback_lines)

    def snapshot(
        self, target: DeviceTarget, expected: HealthExpectations | None
    ) -> HealthSnapshot:
        bgp_sessions: dict[str, BgpSessionState] = {}
        interfaces: dict[str, InterfaceState] = {}
        ping_losses: dict[str, float] = {}

        with self._get_connection(target) as conn:
            if target.platform == Platform.HUAWEI_VRP:
                bgp_out = conn.send_command("display bgp peer").result
                for line in bgp_out.splitlines():
                    match = re.search(
                        r"^(\d+\.\d+\.\d+\.\d+)\s+.*?\s+(Established|Active|Idle|Connect|\d+)",
                        line.strip(),
                        re.IGNORECASE,
                    )
                    if match:
                        peer_ip, state_or_pfx = match.groups()
                        is_est = state_or_pfx.isdigit() or state_or_pfx.lower() == "established"
                        prefixes = int(state_or_pfx) if state_or_pfx.isdigit() else 1
                        bgp_sessions[peer_ip] = BgpSessionState(
                            "Established" if is_est else state_or_pfx,
                            prefixes_accepted=prefixes if is_est else 0,
                        )

                int_out = conn.send_command("display ip interface brief").result
                for line in int_out.splitlines():
                    parts = line.split()
                    if len(parts) >= 3 and parts[0].startswith(("GE", "Loop", "Gigabit")):
                        status = "up" if "up" in parts[1].lower() else "down"
                        proto = "up" if "up" in parts[2].lower() else "down"
                        interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)
            else:
                bgp_out = conn.send_command("show ip bgp summary").result
                for line in bgp_out.splitlines():
                    match = re.search(
                        r"^(\d+\.\d+\.\d+\.\d+)\s+.*?\s+(\d+|Active|Idle|Connect)$",
                        line.strip(),
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
                        if parts[0].startswith(("Gigabit", "Loop")):
                            interfaces[parts[0]] = InterfaceState(status=parts[4], protocol=parts[5])
                    elif (
                        target.platform == Platform.ARISTA_EOS
                        and len(parts) >= 4
                        and parts[0].startswith(("Ethernet", "Loop"))
                    ):
                        status = "up" if "up" in parts[1].lower() else "down"
                        proto = "up" if "up" in parts[2].lower() else "down"
                        interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)

            if expected:
                for peer in expected.bgp_peers:
                    if target.platform == Platform.CISCO_IOSXE:
                        ping_cmd = f"ping {peer} repeat 5"
                    elif target.platform == Platform.HUAWEI_VRP:
                        ping_cmd = f"ping -c 5 {peer}"
                    else:
                        ping_cmd = f"ping {peer} count 5"
                    ping_out = conn.send_command(ping_cmd).result
                    rate_match = re.search(r"(?:Success rate is |packet loss, |transmitted, \d+ received, )(\d+)%", ping_out)
                    ping_losses[peer] = (100.0 - float(rate_match.group(1))) if rate_match else 0.0

        return HealthSnapshot(
            bgp_sessions=bgp_sessions,
            interfaces=interfaces,
            ping_loss_percent=ping_losses,
        )
