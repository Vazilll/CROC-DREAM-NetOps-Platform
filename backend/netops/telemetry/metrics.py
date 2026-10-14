from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType

# Каталог метрик: имена и описания попадают в вывод /metrics (строки HELP и TYPE).
DEVICE_STATUS = "netops_device_status"
DEVICES_TOTAL = "netops_devices_total"
DEVICE_REACHABLE = "netops_device_reachable"
JOBS_TOTAL = "netops_jobs_total"
JOB_LAST_FINISHED = "netops_job_last_finished_timestamp_seconds"
DRIFT_DEVICES = "netops_drift_devices"
BGP_SESSION_UP = "netops_bgp_session_up"
BGP_PREFIXES_ACCEPTED = "netops_bgp_prefixes_accepted"
INTERFACE_UP = "netops_interface_up"
PING_LOSS = "netops_ping_loss_percent"
CPU_USAGE = "netops_cpu_usage_percent"
MEMORY_USAGE = "netops_memory_usage_percent"
UPLINK_UTIL = "netops_uplink_util_percent"
COLLECTED_AT = "netops_metrics_collected_timestamp_seconds"

HELP: Mapping[str, str] = MappingProxyType(
    {
        DEVICE_STATUS: "Текущий статус устройства: 1 у текущего статуса, 0 у остальных",
        DEVICES_TOTAL: "Количество устройств по статусам",
        DEVICE_REACHABLE: "Устройство ответило на опрос телеметрии",
        JOBS_TOTAL: "Количество задач по типу и статусу",
        JOB_LAST_FINISHED: "Время завершения последней задачи этого типа",
        DRIFT_DEVICES: "Количество устройств с обнаруженным дрейфом",
        BGP_SESSION_UP: "BGP-сессия в состоянии Established",
        BGP_PREFIXES_ACCEPTED: "Принятых префиксов от соседа",
        INTERFACE_UP: "Интерфейс в состоянии up/up",
        PING_LOSS: "Потери ping до соседа, проценты",
        CPU_USAGE: "Загрузка CPU устройства, проценты",
        MEMORY_USAGE: "Загрузка RAM устройства, проценты",
        UPLINK_UTIL: "Загрузка аплинка устройства, проценты",
        COLLECTED_AT: "Время последнего сбора метрик",
    }
)


@dataclass(frozen=True, slots=True)
class Sample:
    name: str
    value: float
    labels: Mapping[str, str] = field(default_factory=dict)


def render(samples: list[Sample], collected_at: datetime | None) -> str:
    lines: list[str] = []
    if collected_at is not None:
        samples = [*samples, Sample(COLLECTED_AT, collected_at.timestamp())]
    for name in sorted({sample.name for sample in samples}):
        lines.append(f"# HELP {name} {HELP.get(name, name)}")
        lines.append(f"# TYPE {name} gauge")
        lines.extend(_line(sample) for sample in samples if sample.name == name)
    return "\n".join(lines) + "\n" if lines else ""


def _line(sample: Sample) -> str:
    pairs = ",".join(f'{key}="{_escape(value)}"' for key, value in sorted(sample.labels.items()))
    labels = f"{{{pairs}}}" if pairs else ""
    return f"{sample.name}{labels} {_number(sample.value)}"


def _number(value: float) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else repr(number)


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
