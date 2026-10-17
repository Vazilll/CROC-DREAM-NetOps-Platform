"""Честные пробы протоколов телеметрии: открытый порт — ещё не протокол.

- gNMI: gRPC ``Capabilities`` через ``gnmic`` — тот же клиент, который потом держит поток.
- Prometheus exporter: HTTP GET, ответ должен быть в текстовом формате Prometheus.
- SNMP (UDP): ответ агента. SNMPv3 discovery не требует учётных данных; v2c GET уходит
  только с community из настроек — значения «public» по умолчанию в коде нет.
"""

from __future__ import annotations

import itertools
import os
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass

_REQUEST_IDS = itertools.count(0x1000)
_SYS_DESCR_OID = bytes.fromhex("2b06010201010100")  # 1.3.6.1.2.1.1.1.0


@dataclass(frozen=True, slots=True)
class GnmiCapabilities:
    ok: bool
    tls: bool = False  # True — TLS без проверки сертификата, False — plaintext (insecure)
    detail: str = ""


def tcp_open(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# Учётные данные передаём через окружение (GNMIC_USERNAME/GNMIC_PASSWORD), а не argv:
# аргументы процесса видны любому пользователю хоста через ps.
def gnmic_capabilities(
    host: str,
    port: int,
    username: str,
    password: str,
    *,
    timeout: float = 5.0,
    binary: str | None = None,
) -> GnmiCapabilities | None:
    """Run ``gnmic capabilities``; ``None`` means gnmic is not installed (cannot verify)."""
    exe = binary or shutil.which("gnmic")
    if not exe:
        return None
    env = {**os.environ, "GNMIC_USERNAME": username, "GNMIC_PASSWORD": password}
    base = [exe, "-a", f"{host}:{port}", "--timeout", f"{max(1, round(timeout))}s"]
    detail = ""
    for tls_flag, tls in (("--skip-verify", True), ("--insecure", False)):
        try:
            proc = subprocess.run(
                [*base, tls_flag, "capabilities"],
                capture_output=True,
                text=True,
                timeout=timeout + 5,
                env=env,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            detail = str(exc)
            continue
        if proc.returncode == 0 and "gnmi version" in proc.stdout.lower():
            return GnmiCapabilities(ok=True, tls=tls)
        detail = (proc.stderr or proc.stdout).strip()[-300:]
    return GnmiCapabilities(ok=False, detail=detail)


def prometheus_exporter_ok(host: str, port: int, path: str, timeout: float) -> bool:
    req = urllib.request.Request(f"http://{host}:{port}{path}", headers={"Accept": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return False
            body = resp.read()
            head = body[:65536].decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return "# TYPE " in head or "# HELP " in head


# --- Минимальный BER-кодировщик ровно под два SNMP-запроса -----------------------------


def _ber_len(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _tlv(tag: int, payload: bytes) -> bytes:
    return bytes([tag]) + _ber_len(len(payload)) + payload


def _int(value: int) -> bytes:
    return _tlv(0x02, value.to_bytes(value.bit_length() // 8 + 1, "big", signed=True))


def _octets(value: bytes) -> bytes:
    return _tlv(0x04, value)


def _seq(*parts: bytes) -> bytes:
    return _tlv(0x30, b"".join(parts))


def snmpv2c_get_sysdescr(community: bytes, request_id: int) -> bytes:
    varbind = _seq(_tlv(0x06, _SYS_DESCR_OID), b"\x05\x00")
    pdu = _tlv(0xA0, _int(request_id) + _int(0) + _int(0) + _seq(varbind))
    return _seq(_int(1), _octets(community), pdu)


# RFC 3414 §4: пустой engineID + флаг reportable — агент обязан ответить Report-PDU
# (usmStatsUnknownEngineIDs), учётные данные для этого не нужны.
def snmpv3_discovery(message_id: int) -> bytes:
    usm = _seq(_octets(b""), _int(0), _int(0), _octets(b""), _octets(b""), _octets(b""))
    pdu = _tlv(0xA0, _int(message_id) + _int(0) + _int(0) + _seq())
    header = _seq(_int(message_id), _int(65507), _octets(b"\x04"), _int(3))
    return _seq(_int(3), header, _octets(usm), _seq(_octets(b""), _octets(b""), pdu))


def _message_version(data: bytes) -> int | None:
    if len(data) < 5 or data[0] != 0x30:
        return None
    idx = 2 + (data[1] & 0x7F if data[1] & 0x80 else 0)
    if len(data) < idx + 3 or data[idx] != 0x02 or data[idx + 1] != 1:
        return None
    return data[idx + 2]


def snmp_agent_versions(
    host: str, port: int, *, community: str | None, timeout: float
) -> set[str]:
    """Return SNMP versions the agent actually answered: subset of {"v3", "v2c"}."""
    probes = [("v3", 3, snmpv3_discovery(next(_REQUEST_IDS)))]
    if community:
        probes.append(("v2c", 1, snmpv2c_get_sysdescr(community.encode(), next(_REQUEST_IDS))))
    answered: set[str] = set()
    for name, wire_version, packet in probes:
        # connect(): ICMP port-unreachable приходит сразу как ConnectionRefusedError,
        # а не через полный timeout; заодно отбрасываются ответы с чужих адресов.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(timeout)
            try:
                sock.connect((host, port))
                sock.send(packet)
                data = sock.recv(4096)
            except ConnectionRefusedError:
                break  # порт закрыт — агента нет, остальные пробы бессмысленны
            except OSError:
                continue
        if _message_version(data) == wire_version:
            answered.add(name)
    return answered
