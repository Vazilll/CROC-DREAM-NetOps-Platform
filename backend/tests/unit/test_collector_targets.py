from __future__ import annotations

import json

import yaml

from netops.enums import TelemetryProtocol
from netops.telemetry.targets import (
    EXPORTER_TARGETS_FILE,
    GNMIC_TARGETS_FILE,
    SNMP_TARGETS_FILE,
    is_externally_collected,
    last_collector_plan,
    refresh_collector_targets,
)


def test_refresh_collector_targets_writes_files_without_secrets(
    session, toolchain, settings, devices
) -> None:
    hosts = sorted(devices)
    assert len(hosts) >= 3
    by_ip = {str(devices[h].management_ip): h for h in hosts}
    verdicts = {
        hosts[0]: {"protocol": TelemetryProtocol.GNMI, "port": 6030, "tls": False},
        hosts[1]: {"protocol": TelemetryProtocol.PROMETHEUS_EXPORTER, "port": 9101, "path": "/app"},
        hosts[2]: {"protocol": TelemetryProtocol.SNMP, "port": 161},
    }
    calls: list[dict] = []

    def fake_detect(host, platform, **kwargs):
        calls.append(kwargs)
        hostname = by_ip[host]
        if hostname == hosts[-1] and len(hosts) > 3:
            raise RuntimeError("probe exploded")
        return verdicts.get(hostname, {"protocol": TelemetryProtocol.SSH_CLI, "port": 22})

    summary = refresh_collector_targets(session, toolchain, settings, detect=fake_detect)

    assert all(c["username"] == "admin" and c["password"] == "admin" for c in calls)
    out = settings.offline_lab_path
    gnmic = yaml.safe_load((out / GNMIC_TARGETS_FILE).read_text())
    assert list(gnmic) == [hosts[0]]
    assert gnmic[hosts[0]]["insecure"] is True
    assert gnmic[hosts[0]]["event-tags"]["hostname"] == hosts[0]

    exporter = json.loads((out / EXPORTER_TARGETS_FILE).read_text())
    assert exporter[0]["labels"]["__metrics_path__"] == "/app"
    assert exporter[0]["targets"][0].endswith(":9101")
    snmp = json.loads((out / SNMP_TARGETS_FILE).read_text())
    assert [t["labels"]["hostname"] for t in snmp] == [hosts[2]]
    assert snmp[0]["labels"]["snmp_module"] in ("host_resources", "cisco_cpu", "huawei_cpu")

    for name in (GNMIC_TARGETS_FILE, EXPORTER_TARGETS_FILE, SNMP_TARGETS_FILE):
        text = (out / name).read_text()
        assert "admin" not in text
        assert "password" not in text

    assert summary["protocols"]["gnmi"] == 1
    assert sum(summary["protocols"].values()) == len(hosts)
    assert last_collector_plan()["devices"].keys() == summary["devices"].keys()
    assert is_externally_collected(hosts[0]) is True
    assert is_externally_collected(hosts[1]) is True
    assert is_externally_collected(hosts[2]) is False
    if len(hosts) > 3:
        assert is_externally_collected(hosts[-1]) is False
    assert is_externally_collected("nonexistent.croc.lab") is False

