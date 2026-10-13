from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from netops.db import utcnow
from netops.enums import DeviceStatus, DriftStatus, JobStatus, JobType
from netops.models import Device, DriftRecord, Job
from netops.telemetry import collector, metrics
from netops.telemetry.bot import MetricsBot

CHAT_ID = 100
STRANGER_ID = 999


class FakeTelegram:
    def __init__(self, updates: list[dict[str, Any]] | None = None) -> None:
        self.sent: list[tuple[int, str]] = []
        self._updates = updates or []

    def send(self, chat_id: int, text: str) -> None:
        self.sent.append((chat_id, text))

    def updates(self, offset: int | None) -> list[dict[str, Any]]:
        return [u for u in self._updates if offset is None or u["update_id"] >= offset]

    def texts(self) -> str:
        return "\n".join(text for _, text in self.sent)


def _command(text: str, *, update_id: int = 1, chat_id: int = CHAT_ID) -> dict[str, Any]:
    return {"update_id": update_id, "message": {"chat": {"id": chat_id}, "text": text}}


def _bot(
    session_factory: sessionmaker[Session], api: FakeTelegram, chat_ids: list[int] | None = None
) -> MetricsBot:
    return MetricsBot(session_factory, api, chat_ids if chat_ids is not None else [CHAT_ID])


def _drift(session: Session, device: Device, status: DriftStatus, **fields: Any) -> DriftRecord:
    record = DriftRecord(device_id=device.id, status=status, checked_at=utcnow(), **fields)
    session.add(record)
    session.commit()
    return record


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        ("/status", "Устройств: 4"),
        ("/drift", "Дрейфа нет"),
        ("/jobs", "Задач пока не было"),
        ("/metrics", "Метрики ещё не собирались"),
        ("/help", "/status"),
    ],
)
def test_commands_answer_in_the_same_chat(
    session_factory: sessionmaker[Session],
    devices: dict[str, Device],
    command: str,
    expected: str,
) -> None:
    api = FakeTelegram([_command(command)])
    _bot(session_factory, api).poll_once()
    assert len(api.sent) == 1
    chat_id, text = api.sent[0]
    assert chat_id == CHAT_ID
    assert expected in text


def test_unknown_chat_gets_no_answer(
    session_factory: sessionmaker[Session], devices: dict[str, Device]
) -> None:
    api = FakeTelegram([_command("/status", chat_id=STRANGER_ID)])
    _bot(session_factory, api).poll_once()
    assert api.sent == []


def test_each_update_is_handled_once(
    session_factory: sessionmaker[Session], devices: dict[str, Device]
) -> None:
    api = FakeTelegram([_command("/status", update_id=7)])
    bot = _bot(session_factory, api)
    bot.poll_once()
    bot.poll_once()
    assert len(api.sent) == 1


def test_status_and_drift_show_the_current_state(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    device = session.get_one(Device, devices["leaf-2.croc.lab"].id)
    device.status = DeviceStatus.DRIFT_DETECTED
    _drift(session, device, DriftStatus.DRIFT_DETECTED, unauthorized_lines=["interface Loopback99"])

    api = FakeTelegram([_command("/status", update_id=1), _command("/drift", update_id=2)])
    _bot(session_factory, api).poll_once()

    assert "DRIFT_DETECTED: 1 (leaf-2.croc.lab)" in api.texts()
    assert "leaf-2.croc.lab — DRIFT_DETECTED" in api.texts()
    assert "лишних строк: 1" in api.texts()


def test_metrics_command_reports_problems(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    collector.store(
        session,
        [
            metrics.Sample(metrics.DRIFT_DEVICES, 1),
            metrics.Sample(metrics.DEVICE_REACHABLE, 0, {"hostname": "leaf-1.croc.lab"}),
            metrics.Sample(
                metrics.BGP_SESSION_UP,
                0,
                {"hostname": "leaf-1.croc.lab", "peer": "10.0.1.0", "state": "Active"},
            ),
        ],
        retention=timedelta(days=1),
    )
    api = FakeTelegram([_command("/metrics")])
    _bot(session_factory, api).poll_once()

    text = api.texts()
    assert "Дрейф: 1 устройств" in text
    assert "не отвечают: leaf-1.croc.lab" in text
    assert "BGP Established: 0 из 1, проблемы: leaf-1.croc.lab → 10.0.1.0" in text


def test_alerts_are_sent_once_for_drift_and_failed_jobs(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    api = FakeTelegram()
    bot = _bot(session_factory, api, [CHAT_ID, 200])
    bot.catch_up()

    _drift(session, devices["leaf-1.croc.lab"], DriftStatus.IN_SYNC)
    _drift(session, devices["leaf-2.croc.lab"], DriftStatus.UNREACHABLE, error="нет ответа")
    session.add(
        Job(
            type=JobType.DEPLOY,
            status=JobStatus.FAILED,
            created_by="tester",
            error="post-check не прошёл",
            finished_at=utcnow(),
        )
    )
    session.commit()

    bot.send_alerts()
    bot.send_alerts()

    assert [chat_id for chat_id, _ in api.sent] == [CHAT_ID, 200, CHAT_ID, 200]
    text = api.texts()
    assert "leaf-2.croc.lab: UNREACHABLE" in text
    assert "нет ответа" in text
    assert "Задача DEPLOY упала: post-check не прошёл" in text
    assert "leaf-1.croc.lab" not in text


def test_catch_up_skips_what_happened_before_the_start(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    _drift(session, devices["leaf-1.croc.lab"], DriftStatus.DRIFT_DETECTED)
    api = FakeTelegram()
    bot = _bot(session_factory, api)
    bot.catch_up()

    bot.send_alerts()

    assert api.sent == []


def test_metrics_command_shows_numbers_when_everything_is_fine(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    collector.store(
        session,
        [
            metrics.Sample(metrics.DEVICES_TOTAL, 4, {"status": "IN_SYNC"}),
            metrics.Sample(metrics.DEVICE_REACHABLE, 1, {"hostname": "leaf-1.croc.lab"}),
            metrics.Sample(
                metrics.BGP_SESSION_UP,
                1,
                {"hostname": "leaf-1.croc.lab", "peer": "10.0.1.0", "state": "Established"},
            ),
            metrics.Sample(
                metrics.INTERFACE_UP,
                1,
                {"hostname": "leaf-1.croc.lab", "interface": "GE1/0/0", "state": "up/up"},
            ),
            metrics.Sample(
                metrics.PING_LOSS, 0, {"hostname": "leaf-1.croc.lab", "peer": "10.0.1.0"}
            ),
        ],
        retention=timedelta(days=1),
    )
    api = FakeTelegram([_command("/metrics")])
    _bot(session_factory, api).poll_once()

    text = api.texts()
    assert "Устройств: 4, все отвечают" in text
    assert "BGP Established: 1 из 1" in text
    assert "Порты up/up: 1 из 1" in text
    assert "Потери ping: до 0%" in text
    assert "Дрейф: нет" in text


def test_repeated_drift_is_reported_once(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    api = FakeTelegram()
    bot = _bot(session_factory, api)
    bot.catch_up()
    device = devices["leaf-1.croc.lab"]

    # Скан идёт каждые 15 минут и каждый раз пишет запись по устройству.
    for _ in range(3):
        _drift(session, device, DriftStatus.DRIFT_DETECTED, unauthorized_lines=["interface Lo99"])
        bot.send_alerts()

    assert [text for _, text in api.sent] == [
        "⚠️ leaf-1.croc.lab: DRIFT_DETECTED\nлишних строк: 1, не хватает: 0"
    ]


def test_recovery_and_new_status_are_reported(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    api = FakeTelegram()
    bot = _bot(session_factory, api)
    bot.catch_up()
    device = devices["leaf-1.croc.lab"]

    _drift(session, device, DriftStatus.DRIFT_DETECTED, unauthorized_lines=["interface Lo99"])
    bot.send_alerts()
    _drift(session, device, DriftStatus.IN_SYNC)
    bot.send_alerts()
    _drift(session, device, DriftStatus.UNREACHABLE, error="нет ответа")
    bot.send_alerts()

    statuses = [text.splitlines()[0] for _, text in api.sent]
    assert statuses == [
        "⚠️ leaf-1.croc.lab: DRIFT_DETECTED",
        "✅ leaf-1.croc.lab: снова совпадает с эталоном",
        "⚠️ leaf-1.croc.lab: UNREACHABLE",
    ]


def test_same_job_error_is_not_repeated(
    session_factory: sessionmaker[Session], session: Session, devices: dict[str, Device]
) -> None:
    api = FakeTelegram()
    bot = _bot(session_factory, api)
    bot.catch_up()

    for _ in range(3):
        session.add(
            Job(
                type=JobType.DRIFT_SCAN,
                status=JobStatus.FAILED,
                created_by="scheduler",
                error="2 of 4 device(s) failed: leaf-1.croc.lab, leaf-2.croc.lab",
                finished_at=utcnow(),
            )
        )
        session.commit()
        bot.send_alerts()

    assert len(api.sent) == 1
    assert "2 of 4 device(s) failed" in api.sent[0][1]
