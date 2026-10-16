"""Live network driver for Containerlab using Scrapli (spec 2.4, 2.6).

Connects over SSH to Cisco IOS-XE and Arista EOS nodes, runs commands,
stages changes inside transaction sessions, and takes operational health snapshots.
"""

from __future__ import annotations

import concurrent.futures
import logging
import re
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
    """Transparent SSH adapter for environments where native Scrapli transport is unavailable."""

    def __init__(
        self, target: DeviceTarget, timeout: int = 15, proxy_jump: str | None = None
    ) -> None:
        self.target = target
        self.timeout = timeout
        self.proxy_jump = proxy_jump
        self.client = None
        self._jump_client = None
        self.shell = None

    def _open_jump_channel(self, paramiko_mod, jump_spec: str, dest_host: str, dest_port: int):
        import os  # noqa: PLC0415

        user = os.getenv("NETOPS_CLAB_USER", "crocdream")
        host = os.getenv("NETOPS_CLAB_HOST", "")
        port = int(os.getenv("NETOPS_CLAB_PORT", "221"))
        if jump_spec and jump_spec != "auto":
            spec = jump_spec.strip()
            if "@" in spec:
                user, spec = spec.split("@", 1)
            if ":" in spec:
                h_part, p_part = spec.rsplit(":", 1)
                host = h_part
                if p_part.isdigit():
                    port = int(p_part)
            else:
                host = spec

        jump = paramiko_mod.SSHClient()
        jump.set_missing_host_key_policy(paramiko_mod.AutoAddPolicy())
        key_path = os.path.expanduser(os.getenv("NETOPS_CLAB_KEY_PATH", "~/.ssh/id_ed25519"))
        key_file = key_path if os.path.isfile(key_path) else None
        jump.connect(
            host,
            port=port,
            username=user,
            key_filename=key_file,
            look_for_keys=True,
            allow_agent=True,
            timeout=min(self.timeout, 10),
        )
        self._jump_client = jump
        transport = jump.get_transport()
        target_ip = "127.0.0.1" if dest_host == host else dest_host
        return transport.open_channel("direct-tcpip", (target_ip, dest_port), ("127.0.0.1", 0))

    def _connect_with_sock(self, paramiko_mod, username: str, password: str, sock=None) -> None:
        try:
            self.client.connect(
                self.target.host,
                port=self.target.port,
                username=username,
                password=password,
                sock=sock,
                look_for_keys=False,
                allow_agent=False,
                timeout=min(self.timeout, 10),
                banner_timeout=6,
                auth_timeout=10,
            )
        except paramiko_mod.ssh_exception.AuthenticationException:
            transport = self.client.get_transport()
            if transport is None or not transport.is_active():
                if sock is not None:
                    raise
                transport = paramiko_mod.Transport((self.target.host, self.target.port))
                transport.start_client(timeout=min(self.timeout, 10))
                self.client._transport = transport
            transport.auth_interactive(
                username,
                lambda title, instructions, prompt_list: [password for _ in prompt_list],
            )

    def __enter__(self):  # noqa: PLR0912, PLR0915
        import os  # noqa: PLC0415
        import time  # noqa: PLC0415

        import paramiko  # noqa: PLC0415

        logging.getLogger("paramiko").setLevel(logging.CRITICAL)
        self.client = paramiko.SSHClient()
        if os.getenv("NETOPS_SSH_STRICT_HOST_KEY", "").lower() in ("1", "true", "yes"):
            self.client.load_system_host_keys()
            self.client.set_missing_host_key_policy(paramiko.RejectPolicy())
        else:
            # ponytail: AutoAddPolicy for Containerlab; set NETOPS_SSH_STRICT_HOST_KEY=true in prod
            self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        password = getattr(self.target.credentials, "password", "")
        username = self.target.credentials.username
        clab_host = os.getenv("NETOPS_CLAB_HOST", "")

        try:
            sock = None
            if self.proxy_jump:
                sock = self._open_jump_channel(
                    paramiko, self.proxy_jump, self.target.host, self.target.port
                )
            elif (
                clab_host
                and self.target.host == clab_host
                and self.target.platform == Platform.HUAWEI_VRP
                and "PYTEST_CURRENT_TEST" not in os.environ
            ):
                try:
                    sock = self._open_jump_channel(
                        paramiko, "auto", self.target.host, self.target.port
                    )
                except Exception:
                    sock = None
            try:
                self._connect_with_sock(paramiko, username, password, sock=sock)
            except paramiko.ssh_exception.SSHException as exc:
                if (
                    sock is None
                    and clab_host
                    and self.target.host == clab_host
                    and (
                        "protocol banner" in str(exc).lower()
                        or "no existing session" in str(exc).lower()
                    )
                ):
                    sock = self._open_jump_channel(
                        paramiko, "auto", self.target.host, self.target.port
                    )
                    self._connect_with_sock(paramiko, username, password, sock=sock)
                else:
                    raise

            self.shell = self.client.invoke_shell()
            time.sleep(0.8)
            while self.shell.recv_ready():
                _ = self.shell.recv(8192)

            if self.target.platform in (Platform.ARISTA_EOS, Platform.CISCO_IOSXE):
                self.shell.send("enable\nterminal length 0\n")
            elif self.target.platform == Platform.HUAWEI_VRP:
                self.shell.send("screen-length 0 temporary\n")

            init_deadline = time.time() + 4.0
            init_buf = ""
            while time.time() < init_deadline:
                if self.shell.recv_ready():
                    init_buf += self.shell.recv(8192).decode("utf-8", errors="ignore")
                    time.sleep(0.1)
                elif ("length 0" in init_buf) and init_buf.rstrip().endswith(("#", ">", "]")):
                    break
                else:
                    time.sleep(0.15)
            return self
        except Exception:
            self.client.close()
            if self._jump_client:
                self._jump_client.close()
            raise

    def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
        if self.client:
            self.client.close()
        if self._jump_client:
            self._jump_client.close()

    def send_command(self, cmd: str) -> _ScrapliResponse:
        import time  # noqa: PLC0415

        if self.shell is None:
            raise RuntimeError("SSH shell session is not initialized")
        while self.shell.recv_ready():
            _ = self.shell.recv(16384)
        self.shell.send(f"{cmd}\n")
        time.sleep(0.2)
        output = ""
        cmd_prefix = cmd.strip()[:16]
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self.shell.recv_ready():
                output += self.shell.recv(16384).decode("utf-8", errors="ignore")
                time.sleep(0.08)
            elif output and (not cmd_prefix or cmd_prefix in output):
                stripped = output.rstrip()
                if stripped.endswith(("#", ">", "]")):
                    break
                time.sleep(0.2)
                if not self.shell.recv_ready():
                    break
            else:
                time.sleep(0.15)
        return _ScrapliResponse(output)

    def send_configs(self, lines: Sequence[str]) -> _ScrapliResponse:
        import time  # noqa: PLC0415

        if self.shell is None:
            raise RuntimeError("SSH shell session is not initialized")

        if self.target.platform == Platform.HUAWEI_VRP:
            self.shell.send("system-view\n")
            time.sleep(0.2)
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.08)
            self.shell.send("commit\nreturn\n")
        elif self.target.platform == Platform.ARISTA_EOS:
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.08)
        else:
            self.shell.send("configure terminal\n")
            time.sleep(0.2)
            for line in lines:
                self.shell.send(f"{line}\n")
                time.sleep(0.08)
            self.shell.send("end\n")

        time.sleep(0.5)
        output = ""
        while self.shell.recv_ready():
            output += self.shell.recv(16384).decode("utf-8", errors="ignore")
            time.sleep(0.08)
        return _ScrapliResponse(output)


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
        import time  # noqa: PLC0415

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
                    from netops.telemetry.targets import is_externally_collected  # noqa: PLC0415

                    if not is_externally_collected(target.hostname):
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

    def run_read_only(self, target: DeviceTarget, command: str) -> str:
        with self._get_connection(target) as conn:
            response = conn.send_command(command)
        return str(response.result)

    def snapshot(  # noqa: PLR0912, PLR0915
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
                    if (
                        len(parts) >= 4
                        and parts[0].startswith(("GE", "Loop", "Gigabit"))
                        and parts[1].lower() != "unassigned"
                    ):
                        status = "up" if "up" in parts[2].lower() else "down"
                        proto = "up" if "up" in parts[3].lower() else "down"
                        interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)
            else:
                bgp_out = conn.send_command("show ip bgp summary").result
                ip_pattern = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
                for line in bgp_out.splitlines():
                    parts = line.strip().split()
                    peer_ip = next((p for p in parts if ip_pattern.match(p)), None)
                    if not peer_ip or len(parts) < 4 or "identifier" in line.lower():
                        continue
                    last = parts[-1]
                    if last.isdigit():
                        bgp_sessions[peer_ip] = BgpSessionState(
                            "Established", prefixes_accepted=int(last)
                        )
                    elif len(parts) >= 2 and parts[-2].isdigit() and parts[-1].isdigit():
                        bgp_sessions[peer_ip] = BgpSessionState(
                            "Established", prefixes_accepted=int(parts[-2])
                        )
                    else:
                        bgp_sessions[peer_ip] = BgpSessionState(last, prefixes_accepted=0)

                int_out = conn.send_command("show ip interface brief").result
                for line in int_out.splitlines():
                    parts = line.split()
                    if target.platform == Platform.CISCO_IOSXE and len(parts) >= 6:
                        if parts[0].startswith(("Gigabit", "Loop")):
                            interfaces[parts[0]] = InterfaceState(
                                status=parts[4], protocol=parts[5]
                            )
                    elif (
                        len(parts) >= 4
                        and parts[0].startswith(("Ethernet", "Loop", "Management"))
                    ):
                        status = "up" if "up" in parts[2].lower() else "down"
                        proto = "up" if "up" in parts[3].lower() else "down"
                        interfaces[parts[0]] = InterfaceState(status=status, protocol=proto)

            from netops.telemetry.targets import is_externally_collected  # noqa: PLC0415

            cli_metrics = (
                {}
                if is_externally_collected(target.hostname)
                else collect_metrics_from_cli(
                    target.hostname,
                    target.platform.value,
                    lambda c: conn.send_command(c).result,
                )
            )

            if expected:
                for peer in expected.bgp_peers:
                    if target.platform == Platform.CISCO_IOSXE:
                        ping_cmd = f"ping {peer} repeat 5"
                    elif target.platform == Platform.HUAWEI_VRP:
                        ping_cmd = f"ping -c 5 {peer}"
                    else:
                        ping_cmd = f"ping {peer} count 5"
                    ping_out = conn.send_command(ping_cmd).result
                    rate_match = re.search(
                        r"(?:Success rate is |packet loss, |transmitted, \d+ received, )(\d+)%",
                        ping_out,
                    )
                    ping_losses[peer] = (
                        (100.0 - float(rate_match.group(1))) if rate_match else 0.0
                    )

        return HealthSnapshot(
            bgp_sessions=bgp_sessions,
            interfaces=interfaces,
            ping_loss_percent=ping_losses,
            cpu_pct=cli_metrics.get("cpu_pct"),
            memory_pct=cli_metrics.get("memory_pct"),
            uplink_util_pct=cli_metrics.get("uplink_util_pct"),
            disk_util_pct=cli_metrics.get("disk_util_pct"),
            network_rate_mbps=cli_metrics.get("network_rate_mbps"),
            load_1m=cli_metrics.get("load_1m"),
        )
