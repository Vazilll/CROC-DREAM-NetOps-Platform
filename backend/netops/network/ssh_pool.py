"""SSH session pool, jump-host connection helpers, and shell execution for ScrapliNetworkDriver."""

from __future__ import annotations

import contextlib
import ipaddress
import logging
import os
import socket
import threading
import time
from collections.abc import Sequence
from typing import Any

from netops.constants import unset_password_marker
from netops.enums import Platform

_JUMP_LOCK = threading.Lock()
_DEAD_ENDPOINTS: dict[tuple[str, int], float] = {}
_POOL_GUARD = threading.Lock()
_DEVICE_LOCKS: dict[tuple[str, int], threading.RLock] = {}
_SESSION_POOL: dict[tuple[str, int], dict[str, object]] = {}
_LAST_CLI_METRICS_TS: dict[str, float] = {}
_SESSION_IDLE_TTL = 90.0
_CLI_METRICS_DEDUP_SEC = 12.0


def _get_device_lock(host: str, port: int) -> threading.RLock:
    key = (host, port)
    with _POOL_GUARD:
        lock = _DEVICE_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _DEVICE_LOCKS[key] = lock
        return lock


def _close_pooled_session(host: str, port: int) -> None:
    key = (host, port)
    with _POOL_GUARD:
        entry = _SESSION_POOL.pop(key, None)
    if not entry:
        return
    shell = entry.get("shell")
    client = entry.get("client")
    jump_client = entry.get("jump_client")
    platform = entry.get("platform")
    if shell is not None:
        with contextlib.suppress(Exception):
            if platform == Platform.HUAWEI_VRP:
                shell.send("return\nquit\ny\n")  # type: ignore[attr-defined]
            else:
                shell.send("exit\n")  # type: ignore[attr-defined]
            time.sleep(0.05)
            shell.close()  # type: ignore[attr-defined]
    if client is not None:
        with contextlib.suppress(Exception):
            client.close()  # type: ignore[attr-defined]
    if jump_client is not None:
        with contextlib.suppress(Exception):
            jump_client.close()  # type: ignore[attr-defined]


def _check_tcp_endpoint(host: str, port: int, timeout: float = 2.5) -> bool:
    if "PYTEST_CURRENT_TEST" in os.environ:
        return True
    now = time.monotonic()
    dead_ts = _DEAD_ENDPOINTS.get((host, port))
    if dead_ts is not None and (now - dead_ts) < 8.0:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            _DEAD_ENDPOINTS.pop((host, port), None)
            return True
    except OSError:
        _DEAD_ENDPOINTS[(host, port)] = time.monotonic()
        return False


def resolve_clab_jump_defaults() -> tuple[str, str, int, str | None]:
    user = os.getenv("NETOPS_CLAB_USER", "")
    host = os.getenv("NETOPS_CLAB_HOST", "")
    port_raw = os.getenv("NETOPS_CLAB_PORT", "")
    pwd = os.getenv("NETOPS_CLAB_PASSWORD", "") or None
    if not host and "PYTEST_CURRENT_TEST" not in os.environ:
        try:
            from netops.settings import get_settings

            s = get_settings()
            s.apply_runtime_overlay()
            host = s.clab_host or ""
            user = user or s.clab_user or "crocdream"
            port_raw = port_raw or str(s.clab_port or 221)
            if not pwd and s.clab_password:
                pwd = s.clab_password.get_secret_value() or None
        except Exception:
            pass
    return (
        user or "crocdream",
        host,
        int(port_raw) if str(port_raw).isdigit() else 221,
        pwd,
    )


def resolve_container_endpoint(
    host: str, dest_host: str, dest_port: int
) -> tuple[str, int]:
    if dest_host == host and "PYTEST_CURRENT_TEST" not in os.environ:
        with contextlib.suppress(Exception):
            from netops.services.state import get_state_manager

            rt_data = get_state_manager().get_db_state("runtime_settings", {})
            if isinstance(rt_data, dict):
                port_map = rt_data.get("clab_port_map")
                if isinstance(port_map, dict) and str(dest_port) in port_map:
                    return str(port_map[str(dest_port)]), 22
    return ("127.0.0.1" if dest_host == host else dest_host), dest_port


def build_candidate_passwords(platform_value: str, password: str) -> list[str]:
    candidate_passwords: list[str] = []
    if password and password != unset_password_marker():
        candidate_passwords.append(password)
    with contextlib.suppress(Exception):
        from netops.services.discovery import load_platform_profiles

        profiles = load_platform_profiles()
        plat_prof = profiles.get(platform_value)
        own_default = str(plat_prof.get("default_password") or "") if plat_prof else ""
        if own_default and own_default not in candidate_passwords:
            candidate_passwords.append(own_default)
    if not candidate_passwords and password:
        candidate_passwords.append(password)
    return candidate_passwords


def open_jump_channel(
    adapter: Any, paramiko_mod: Any, jump_spec: str, dest_host: str, dest_port: int
) -> Any:
    user, host, port, jump_pwd = resolve_clab_jump_defaults()
    if jump_spec and jump_spec != "auto":
        spec = jump_spec.strip()
        if "@" in spec:
            u_part, spec = spec.split("@", 1)
            if ":" in u_part:
                user, jump_pwd = u_part.split(":", 1)
            else:
                user = u_part
        if ":" in spec:
            h_part, p_part = spec.rsplit(":", 1)
            host = h_part
            if p_part.isdigit():
                port = int(p_part)
        else:
            host = spec

    target_ip, target_port = resolve_container_endpoint(host, dest_host, dest_port)

    if adapter._jump_client is not None:
        t_existing = adapter._jump_client.get_transport()
        if t_existing is not None and t_existing.is_active():
            return t_existing.open_channel(
                "direct-tcpip", (target_ip, target_port), ("127.0.0.1", 0)
            )
        with contextlib.suppress(Exception):
            adapter._jump_client.close()
        adapter._jump_client = None

    if not host:
        raise TimeoutError("Jump host is not configured")

    with _JUMP_LOCK:
        jump = paramiko_mod.SSHClient()
        jump.set_missing_host_key_policy(paramiko_mod.AutoAddPolicy())
        key_path = os.path.expanduser(os.getenv("NETOPS_CLAB_KEY_PATH", "~/.ssh/id_ed25519"))
        key_file = key_path if os.path.isfile(key_path) else None
        jump.connect(
            host,
            port=port,
            username=user,
            password=jump_pwd,
            key_filename=key_file,
            look_for_keys=not bool(jump_pwd),
            allow_agent=not bool(jump_pwd),
            timeout=min(adapter.timeout, 8),
            banner_timeout=12,
            auth_timeout=10,
        )
        try:
            transport = jump.get_transport()
            if transport is None:
                raise TimeoutError("Jump host SSH transport is not active")
            chan = transport.open_channel(
                "direct-tcpip", (target_ip, target_port), ("127.0.0.1", 0)
            )
        except Exception:
            adapter._jump_client = None
            with contextlib.suppress(Exception):
                jump.close()
            raise
        adapter._jump_client = jump
        return chan


def connect_with_sock(
    adapter: Any, paramiko_mod: Any, username: str, password: str, sock: Any = None
) -> None:
    candidate_passwords = build_candidate_passwords(adapter.target.platform.value, password)
    last_err: Exception | None = None
    for idx, cand_pw in enumerate(candidate_passwords):
        current_sock = sock if idx == 0 else None
        if idx > 0 and sock is not None:
            current_sock = adapter._open_jump_channel(
                paramiko_mod,
                adapter.proxy_jump or "auto",
                adapter.target.host,
                adapter.target.port,
            )
        try:
            adapter.client.connect(
                adapter.target.host,
                port=adapter.target.port,
                username=username,
                password=cand_pw,
                sock=current_sock,
                look_for_keys=False,
                allow_agent=False,
                timeout=min(adapter.timeout, 12),
                banner_timeout=15,
                auth_timeout=12,
            )
            adapter.authenticated_password = cand_pw
            return
        except paramiko_mod.ssh_exception.BadAuthenticationType as bad_auth_exc:
            last_err = bad_auth_exc
            try:
                transport = adapter.client.get_transport()
                if transport is None or not transport.is_active():
                    if current_sock is not None:
                        current_sock = adapter._open_jump_channel(
                            paramiko_mod,
                            adapter.proxy_jump or "auto",
                            adapter.target.host,
                            adapter.target.port,
                        )
                        transport = paramiko_mod.Transport(current_sock)
                    else:
                        transport = paramiko_mod.Transport((adapter.target.host, adapter.target.port))
                    transport.start_client(timeout=min(adapter.timeout, 12))
                    adapter.client._transport = transport
                transport.auth_interactive(
                    username,
                    lambda title, instructions, prompt_list, pw=cand_pw: [
                        pw for _ in prompt_list
                    ],
                )
                adapter.authenticated_password = cand_pw
                return
            except paramiko_mod.ssh_exception.AuthenticationException as interactive_exc:
                last_err = interactive_exc
                with contextlib.suppress(Exception):
                    adapter.client.close()
                continue
        except paramiko_mod.ssh_exception.AuthenticationException as auth_exc:
            last_err = auth_exc
            with contextlib.suppress(Exception):
                adapter.client.close()
            continue
    if last_err is not None:
        raise last_err


def establish_fresh_session(adapter: Any) -> None:
    import paramiko

    logging.getLogger("paramiko").setLevel(logging.CRITICAL)
    adapter.client = paramiko.SSHClient()
    if os.getenv("NETOPS_SSH_STRICT_HOST_KEY", "").lower() in ("1", "true", "yes"):
        adapter.client.load_system_host_keys()
        adapter.client.set_missing_host_key_policy(paramiko.RejectPolicy())
    else:
        # ponytail: AutoAddPolicy for Containerlab; set NETOPS_SSH_STRICT_HOST_KEY=true in prod
        adapter.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    password = getattr(adapter.target.credentials, "password", "")
    username = adapter.target.credentials.username
    _, clab_host, _, _ = adapter._resolve_clab_jump_defaults()
    is_internal_docker_ip = False
    if clab_host and adapter.target.host != clab_host:
        with contextlib.suppress(ValueError):
            is_internal_docker_ip = ipaddress.ip_address(
                adapter.target.host
            ) in ipaddress.ip_network("172.16.0.0/12")
    is_unrouted_docker_target = bool(
        clab_host
        and is_internal_docker_ip
        and "PYTEST_CURRENT_TEST" not in os.environ
    )

    try:
        sock = None
        if adapter.proxy_jump:
            sock = adapter._open_jump_channel(
                paramiko, adapter.proxy_jump, adapter.target.host, adapter.target.port
            )
        elif is_unrouted_docker_target and not _check_tcp_endpoint(
            adapter.target.host, adapter.target.port, timeout=1.2
        ):
            sock = adapter._open_jump_channel(
                paramiko, "auto", adapter.target.host, adapter.target.port
            )
        adapter._connect_with_sock(paramiko, username, password, sock=sock)

        adapter.shell = adapter.client.invoke_shell()
        time.sleep(0.8)
        while adapter.shell.recv_ready():
            _ = adapter.shell.recv(8192)

        if adapter.target.platform in (Platform.ARISTA_EOS, Platform.CISCO_IOSXE):
            adapter.shell.send("enable\nterminal length 0\n")
        elif adapter.target.platform == Platform.HUAWEI_VRP:
            adapter.shell.send("screen-length 0 temporary\n")

        init_deadline = time.time() + 4.0
        init_buf = ""
        while time.time() < init_deadline:
            if adapter.shell.recv_ready():
                init_buf += adapter.shell.recv(8192).decode("utf-8", errors="ignore")
                time.sleep(0.1)
            elif ("length 0" in init_buf) and init_buf.rstrip().endswith(("#", ">", "]")):
                break
            else:
                time.sleep(0.15)
    except Exception:
        if adapter.client:
            with contextlib.suppress(Exception):
                adapter.client.close()
        if adapter._jump_client:
            with contextlib.suppress(Exception):
                adapter._jump_client.close()
        raise


def execute_shell_command(adapter: Any, cmd: str) -> str:
    if adapter.shell is None:
        raise RuntimeError("SSH shell session is not initialized")
    try:
        while adapter.shell.recv_ready():
            _ = adapter.shell.recv(16384)
        adapter.shell.send(f"{cmd}\n")
    except Exception:
        adapter._invalidate_pool = True
        raise
    time.sleep(0.15)
    output = ""
    cmd_prefix = cmd.strip()[:16]
    deadline = time.time() + adapter.timeout
    last_recv_at = time.time()
    while time.time() < deadline:
        if adapter.shell.recv_ready():
            output += adapter.shell.recv(16384).decode("utf-8", errors="ignore")
            last_recv_at = time.time()
            time.sleep(0.05)
        elif output and (not cmd_prefix or cmd_prefix in output):
            stripped = output.rstrip()
            last_line = stripped.rsplit("\n", 1)[-1].strip()
            has_body = "\n" in stripped
            if adapter.target.platform == Platform.HUAWEI_VRP:
                is_prompt = has_body and (
                    (last_line.startswith("<") and last_line.endswith(">"))
                    or (last_line.startswith("[") and last_line.endswith("]"))
                )
            else:
                is_prompt = (
                    has_body
                    and last_line != "#"
                    and len(last_line) > 1
                    and last_line.endswith(("#", ">", "]", "$", "%"))
                )
            if is_prompt:
                time.sleep(0.05)
                if not adapter.shell.recv_ready():
                    break
                continue
            if has_body and (time.time() - last_recv_at) >= 2.5:
                break
            time.sleep(0.1)
        else:
            time.sleep(0.1)
    return output


def execute_shell_configs(adapter: Any, lines: Sequence[str]) -> str:
    if adapter.shell is None:
        raise RuntimeError("SSH shell session is not initialized")

    if adapter.target.platform == Platform.HUAWEI_VRP:
        adapter.shell.send("system-view\n")
        time.sleep(0.2)
        for line in lines:
            adapter.shell.send(f"{line}\n")
            time.sleep(0.08)
        adapter.shell.send("commit\nreturn\n")
    elif adapter.target.platform == Platform.ARISTA_EOS:
        for line in lines:
            adapter.shell.send(f"{line}\n")
            time.sleep(0.08)
    else:
        adapter.shell.send("configure terminal\n")
        time.sleep(0.2)
        for line in lines:
            adapter.shell.send(f"{line}\n")
            time.sleep(0.08)
        adapter.shell.send("end\n")

    time.sleep(0.5)
    output = ""
    while adapter.shell.recv_ready():
        output += adapter.shell.recv(16384).decode("utf-8", errors="ignore")
        time.sleep(0.08)
    return output
