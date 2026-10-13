from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from netops.db import build_engine, build_session_factory
from netops.enums import DeviceStatus, DriftStatus, JobStatus
from netops.models import Device, DriftRecord, Job
from netops.settings import Settings, get_settings
from netops.telemetry import collector, metrics
from netops.telemetry.metrics import Sample

logger = logging.getLogger(__name__)

API_URL = "https://api.telegram.org"
IDLE_SECONDS = 60
MAX_ROWS = 10


class TelegramApi(Protocol):
    def send(self, chat_id: int, text: str) -> None: ...

    def updates(self, offset: int | None) -> list[dict[str, Any]]: ...


# Токен подставляется в URL, поэтому в логи попадают только имена методов.
class HttpTelegramApi:
    def __init__(self, token: str, *, poll_timeout: int = 25) -> None:
        self._token = token
        self._poll_timeout = poll_timeout

    def send(self, chat_id: int, text: str) -> None:
        self._call("sendMessage", {"chat_id": chat_id, "text": text})

    def updates(self, offset: int | None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "timeout": self._poll_timeout,
            "allowed_updates": ["message"],
        }
        if offset is not None:
            payload["offset"] = offset
        result = self._call("getUpdates", payload, timeout=self._poll_timeout + 10)
        return list(result) if isinstance(result, list) else []

    def _call(self, method: str, payload: dict[str, Any], *, timeout: float = 15.0) -> Any:
        request = urllib.request.Request(
            f"{API_URL}/bot{self._token}/{method}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            logger.warning("Telegram %s: HTTP %s", method, exc.code)
            return None
        except OSError as exc:
            logger.warning("Telegram %s недоступен: %s", method, exc)
            return None
        if not body.get("ok"):
            logger.warning("Telegram %s отказал: %s", method, body.get("description"))
            return None
        return body.get("result")


@dataclass
class BotState:
    last_update_id: int | None = None
    last_drift_id: int = 0
    reported_jobs: set[str] = field(default_factory=set)
    # Последний сообщённый статус по устройству: оповещаем только при его смене.
    device_status: dict[str, DriftStatus] = field(default_factory=dict)
    # Текст последней отправленной ошибки задачи: повторы той же ошибки не дублируем.
    reported_errors: set[str] = field(default_factory=set)


class MetricsBot:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        api: TelegramApi,
        chat_ids: Sequence[int],
        state: BotState | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._api = api
        self._chat_ids = list(chat_ids)
        self._state = state or BotState()

    # Стартовую точку берём от текущего состояния базы, иначе после перезапуска бот
    # пришлёт весь накопленный дрейф.
    def catch_up(self) -> None:
        with self._session_factory() as session:
            self._state.last_drift_id = _max_drift_id(session)
            self._state.reported_jobs = {str(job.id) for job in _failed_jobs(session)}
            self._state.device_status = {
                device.hostname: DriftStatus(device.status.value)
                for device in session.scalars(select(Device))
                if device.status.value in DriftStatus.__members__.values()
            }

    def poll_once(self) -> None:
        for update in self._api.updates(self._state.last_update_id):
            self._state.last_update_id = int(update["update_id"]) + 1
            self._handle(update.get("message") or {})

    def send_alerts(self) -> None:
        with self._session_factory() as session:
            for text in self._new_alerts(session):
                self._broadcast(text)

    def _handle(self, message: dict[str, Any]) -> None:
        chat_id = (message.get("chat") or {}).get("id")
        text = str(message.get("text") or "").strip()
        if not isinstance(chat_id, int) or not text.startswith("/"):
            return
        if chat_id not in self._chat_ids:
            logger.warning(
                "Запрос из чата %s отклонён: его нет в NETOPS_TELEGRAM_CHAT_IDS", chat_id
            )
            return
        command = text.split()[0].split("@")[0]
        with self._session_factory() as session:
            self._api.send(chat_id, self._answer(session, command))

    def _answer(self, session: Session, command: str) -> str:
        if command == "/status":
            return _status_text(session)
        if command == "/drift":
            return _drift_text(session)
        if command == "/jobs":
            return _jobs_text(session)
        if command == "/metrics":
            return _metrics_text(session)
        return (
            "Метрики платформы NetOps:\n"
            "/status — устройства по статусам\n"
            "/drift — где найден дрейф\n"
            "/jobs — последние задачи\n"
            "/metrics — время сбора и ключевые метрики"
        )

    def _new_alerts(self, session: Session) -> list[str]:
        alerts: list[str] = []
        records = session.scalars(
            select(DriftRecord)
            .where(DriftRecord.id > self._state.last_drift_id)
            .order_by(DriftRecord.id)
        ).all()
        # Скан идёт каждые 15 минут и каждый раз пишет запись по каждому устройству.
        # Поэтому сообщаем только о смене состояния, иначе бот спамит одним и тем же.
        for record in records:
            self._state.last_drift_id = max(self._state.last_drift_id, record.id)
            hostname = record.device.hostname
            if self._state.device_status.get(hostname) is record.status:
                continue
            previous = self._state.device_status.get(hostname)
            self._state.device_status[hostname] = record.status
            if record.status is DriftStatus.IN_SYNC:
                if previous is not None:
                    alerts.append(f"✅ {hostname}: снова совпадает с эталоном")
                continue
            alerts.append(f"⚠️ {hostname}: {record.status.value}\n{_drift_details(record)}")
        # Плановая задача падает так же регулярно, поэтому один и тот же текст не повторяем.
        for job in _failed_jobs(session):
            if str(job.id) in self._state.reported_jobs:
                continue
            self._state.reported_jobs.add(str(job.id))
            text = f"❌ Задача {job.type.value} упала: {job.error or 'без описания'}"
            if text in self._state.reported_errors:
                continue
            self._state.reported_errors.add(text)
            alerts.append(text)
        return alerts

    def _broadcast(self, text: str) -> None:
        for chat_id in self._chat_ids:
            self._api.send(chat_id, text)


def _max_drift_id(session: Session) -> int:
    record = session.scalars(select(DriftRecord).order_by(DriftRecord.id.desc()).limit(1)).first()
    return record.id if record is not None else 0


def _failed_jobs(session: Session) -> Sequence[Job]:
    return session.scalars(
        select(Job)
        .where(Job.status == JobStatus.FAILED)
        .order_by(Job.finished_at.desc())
        .limit(MAX_ROWS)
    ).all()


def _drift_details(record: DriftRecord) -> str:
    if record.error:
        return record.error
    return (
        f"лишних строк: {len(record.unauthorized_lines)}, "
        f"не хватает: {len(record.missing_lines)}"
    )


def _status_text(session: Session) -> str:
    devices = session.scalars(select(Device).order_by(Device.hostname)).all()
    if not devices:
        return "Устройств в инвентаре нет"
    by_status: dict[DeviceStatus, list[str]] = {}
    for device in devices:
        by_status.setdefault(device.status, []).append(device.hostname)
    lines = [f"Устройств: {len(devices)}"]
    lines.extend(
        f"{status.value}: {len(hostnames)} ({', '.join(hostnames)})"
        for status, hostnames in sorted(by_status.items())
    )
    return "\n".join(lines)


def _drift_text(session: Session) -> str:
    records = session.scalars(
        select(DriftRecord)
        .where(DriftRecord.status != DriftStatus.IN_SYNC)
        .order_by(DriftRecord.checked_at.desc())
        .limit(MAX_ROWS)
    ).all()
    if not records:
        return "Дрейфа нет: все устройства совпадают с эталоном"
    return "\n".join(
        f"{record.device.hostname} — {record.status.value}, "
        f"{record.checked_at:%d.%m %H:%M}: {_drift_details(record)}"
        for record in records
    )


def _jobs_text(session: Session) -> str:
    jobs = session.scalars(select(Job).order_by(Job.created_at.desc()).limit(5)).all()
    if not jobs:
        return "Задач пока не было"
    return "\n".join(
        f"{job.created_at:%d.%m %H:%M} {job.type.value} — {job.status.value}"
        f" ({job.progress}%), автор {job.created_by}"
        for job in jobs
    )


def _metrics_text(session: Session) -> str:
    samples, collected_at = collector.latest(session)
    if collected_at is None:
        return "Метрики ещё не собирались"
    lines = [f"Сбор: {collected_at:%d.%m %H:%M:%S} UTC"]
    lines.extend(_summary(samples))
    return "\n".join(lines)


def _summary(samples: Iterable[Sample]) -> list[str]:
    devices = drift = 0.0
    unreachable: list[str] = []
    bgp: list[tuple[str, float]] = []
    ports: list[tuple[str, float]] = []
    losses: list[tuple[str, float]] = []
    for sample in samples:
        peer = f"{sample.labels.get('hostname')} → {sample.labels.get('peer')}"
        if sample.name == metrics.DEVICES_TOTAL:
            devices += sample.value
        elif sample.name == metrics.DRIFT_DEVICES:
            drift = sample.value
        elif sample.name == metrics.DEVICE_REACHABLE and not sample.value:
            unreachable.append(str(sample.labels.get("hostname")))
        elif sample.name == metrics.BGP_SESSION_UP:
            bgp.append((peer, sample.value))
        elif sample.name == metrics.INTERFACE_UP:
            ports.append(
                (f"{sample.labels.get('hostname')} {sample.labels.get('interface')}", sample.value)
            )
        elif sample.name == metrics.PING_LOSS:
            losses.append((peer, sample.value))

    lines = [
        f"Устройств: {devices:g}"
        + (f", не отвечают: {', '.join(unreachable)}" if unreachable else ", все отвечают")
    ]
    lines.append(_ratio("BGP Established", bgp))
    lines.append(_ratio("Порты up/up", ports))
    if losses:
        worst, loss = max(losses, key=lambda item: item[1])
        lines.append(f"Потери ping: до {loss:g}%" + (f" ({worst})" if loss else ""))
    lines.append(f"Дрейф: {drift:g} устройств" if drift else "Дрейф: нет")
    return lines


def _ratio(title: str, items: list[tuple[str, float]]) -> str:
    if not items:
        return f"{title}: данных нет"
    down = [name for name, value in items if not value]
    line = f"{title}: {len(items) - len(down)} из {len(items)}"
    return line + (f", проблемы: {', '.join(down)}" if down else "")


def build_bot(settings: Settings, token: str) -> MetricsBot:
    session_factory = build_session_factory(build_engine(settings.database_url))
    return MetricsBot(session_factory, HttpTelegramApi(token), settings.telegram_chat_ids)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    if settings.telegram_bot_token is None or not settings.telegram_chat_ids:
        logger.warning(
            "Бот простаивает: задайте NETOPS_TELEGRAM_BOT_TOKEN и NETOPS_TELEGRAM_CHAT_IDS"
        )
        while True:
            time.sleep(IDLE_SECONDS)

    bot = build_bot(settings, settings.telegram_bot_token.get_secret_value())
    bot.catch_up()
    logger.info("Бот запущен, чатов: %d", len(settings.telegram_chat_ids))
    while True:
        bot.poll_once()
        bot.send_alerts()


if __name__ == "__main__":
    main()
