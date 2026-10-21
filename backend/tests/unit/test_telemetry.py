from __future__ import annotations

from netops.services.state import get_state_manager, reset_state_manager
from netops.telemetry import collector, metrics
from netops.telemetry.metrics import Sample


def test_sharded_telemetry_publish_and_lookup() -> None:
    reset_state_manager()
    sm = get_state_manager()
    samples = [
        Sample(
            metrics.DEVICE_CPU_UTIL,
            19.5,
            {"hostname": "spine-1.croc.lab", "fabric_id": "pod-1"},
        ),
        Sample(
            metrics.DEVICE_MEMORY_UTIL,
            44.0,
            {"hostname": "spine-1.croc.lab", "fabric_id": "pod-1"},
        ),
        Sample(
            metrics.SERVER_CPU_UTIL,
            31.0,
            {"hostname": "srv-1.croc.lab", "fabric_id": "pod-2"},
        ),
    ]
    ts = collector.publish(samples, ttl_seconds=120)

    all_samples, all_ts = collector.latest()
    assert all_ts == ts
    assert len(all_samples) == 3

    host_samples, host_ts = collector.latest_for_host("spine-1.croc.lab")
    assert host_ts == ts
    assert len(host_samples) == 2
    assert {s.name for s in host_samples} == {metrics.DEVICE_CPU_UTIL, metrics.DEVICE_MEMORY_UTIL}

    raw_shard = sm.get_json("netops:telemetry:host:spine-1.croc.lab")
    assert isinstance(raw_shard, dict)
    assert len(raw_shard["samples"]) == 2

    fab_samples, fab_ts = collector.latest_for_fabric("pod-2")
    assert fab_ts == ts
    assert len(fab_samples) == 1
    assert fab_samples[0].labels["hostname"] == "srv-1.croc.lab"

    sm.clear_telemetry("spine-1.croc.lab")
    assert collector.latest_for_host("spine-1.croc.lab") == ([], None)


def test_extended_l2_and_server_telemetry_parsers() -> None:
    from netops.services.telemetry_parsers import (
        parse_fdb_mac_count,
        parse_interface_errors,
        parse_linux_conntrack,
        parse_linux_tcp_retransmits,
    )

    assert parse_interface_errors("5 input errors, 2 CRC, 1 output errors") == 8.0
    assert parse_fdb_mac_count("Total Mac Addresses for this criterion: 128") == 128.0
    assert parse_linux_tcp_retransmits("TCP: inuse 12 orphan 0 tw 4 alloc 15 mem 2 retrans: 0/19") == 19.0
    assert parse_linux_conntrack("13107\n65536\n") == 20.0

