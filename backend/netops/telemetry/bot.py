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

from netops.constants import const
from netops.db import build_engine, build_session_factory, utcnow
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
    def send(self, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None: ...

    def updates(self, offset: int | None) -> list[dict[str, Any]]: ...


_BOT_POLLING_ACTIVE = False


# Токен подставляется в URL, поэтому в логи попадают только имена методов.
class HttpTelegramApi:
    def __init__(self, token: str, *, poll_timeout: int = 2) -> None:
        self._token = token
        self._poll_timeout = poll_timeout

    def send(self, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        self._call("sendMessage", payload)

    def edit(
        self,
        chat_id: int,
        message_id: int,
        text: str,
        reply_markup: dict[str, Any] | None = None,
    ) -> bool:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return self._call("editMessageText", payload) is not None

    def answer_callback(self, callback_query_id: str) -> None:
        self._call("answerCallbackQuery", {"callback_query_id": callback_query_id})

    def updates(self, offset: int | None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "timeout": self._poll_timeout,
            "allowed_updates": ["message", "callback_query"],
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


def _menu_keyboard() -> list[list[dict[str, str]]]:
    return [
        [
            {"text": "Обзор стенда", "callback_data": "/overview"},
            {"text": "Статус", "callback_data": "/status"},
            {"text": "Метрики", "callback_data": "/metrics"},
        ],
        [
            {"text": "Дрейф", "callback_data": "/drift"},
            {"text": "Задачи", "callback_data": "/jobs"},
            {"text": "🤖 AI-Копилот", "callback_data": "/ai"},
        ],
        [
            {"text": "🔄 Собрать метрики", "callback_data": "/collect"},
            {"text": "🔍 Скан дрейфа", "callback_data": "/scan"},
            {"text": "🔑 Реестр и токены", "callback_data": "/users"},
        ],
        [
            {"text": "🏗 Кластеры/Стенды", "callback_data": "/fabrics"},
            {"text": "🛡 Безопасность", "callback_data": "/security"},
            {"text": "❄️ Kill Switch", "callback_data": "/freeze"},
        ],
    ]


def ensure_user_token(
    session: Session,
    user: Any,
    settings: Settings | None = None,
) -> str:
    from netops.security import generate_token, hash_token
    from netops.services.notifier import load_user_tokens, save_user_token
    from netops.services.sessions import issue_invite_code

    tokens = load_user_tokens(settings)
    existing = tokens.get(user.username)
    if existing and user.token_sha256 == hash_token(existing):
        return existing
    if not getattr(user, "token_sha256", None):
        token = generate_token()
        user.token_sha256 = hash_token(token)
        session.commit()
        save_user_token(user.username, token, settings)
        return token
    return issue_invite_code(user.username)


def bind_telegram_chat_user(
    session: Session,
    chat_id: int,
    *,
    tg_username: str | None = None,
    first_name: str | None = None,
    explicit_token: str | None = None,
    settings: Settings | None = None,
) -> tuple[Any, str, str]:
    from netops.enums import UserRole
    from netops.models import User
    from netops.security import generate_token, hash_token
    from netops.services.notifier import (
        KNOWN_TELEGRAM_PROFILES,
        load_telegram_bindings,
        save_telegram_binding,
        save_user_token,
        sync_access_registry,
    )
    from netops.services.sessions import consume_invite_code

    known = KNOWN_TELEGRAM_PROFILES.get(chat_id, {})
    bindings = load_telegram_bindings(settings).get(str(chat_id), {})
    tg_handle = (
        tg_username or bindings.get("tg_username") or known.get("tg_username") or ""
    ).lstrip("@")
    disp_name = (
        first_name
        or bindings.get("first_name")
        or known.get("first_name")
        or tg_handle
        or str(chat_id)
    )

    user: User | None = None

    if explicit_token and explicit_token not in ("claim_owner", "recover_owner"):
        tok = explicit_token.strip()
        if tok.startswith("inv_"):
            inv_username = consume_invite_code(tok)
            if inv_username:
                user = session.scalar(select(User).where(User.username == inv_username))
        if user is None:
            user = session.scalar(
                select(User).where(
                    (User.verification_code == tok) | (User.token_sha256 == hash_token(tok))
                )
            )
        if user is not None:
            if user.token_sha256 == hash_token(tok):
                save_user_token(user.username, tok, settings)
            user.verification_code = None
            user.verification_expires_at = None

    owner_user = session.scalar(select(User).where(User.username == "owner"))
    # Owner binding: only the very first Telegram link, or the owner's own chat.
    # claim_owner / recover_owner deep-link payloads do NOT grant ownership by themselves.
    if user is None and (
        owner_user is None
        or not owner_user.telegram_chat_id
        or owner_user.telegram_chat_id == str(chat_id)
    ):
        if owner_user is None:
            owner_tok = generate_token()
            owner_user = User(
                username="owner",
                role=UserRole.OWNER,
                token_sha256=hash_token(owner_tok),
                is_active=True,
                telegram_chat_id=str(chat_id),
                telegram_username=tg_handle or None,
                telegram_verified_at=utcnow(),
            )
            session.add(owner_user)
            session.commit()
            save_user_token("owner", owner_tok, settings)
        user = owner_user

    if user is None:
        user = session.scalar(select(User).where(User.telegram_chat_id == str(chat_id)))

    if user is None:
        target_username = (
            known.get("username")
            or bindings.get("username")
            or (tg_handle.lower() if tg_handle else f"tg-{chat_id}")
        )
        # Never adopt an existing account just because the Telegram handle matches it.
        if session.scalar(select(User).where(User.username == target_username)) is not None:
            target_username = f"tg-{chat_id}"
        # Self-service chats are viewers; elevated roles come only from static config.
        role_enum = (
            UserRole.ADMIN
            if known.get("role") in ("owner", "admin")
            else UserRole.OPERATOR
            if known.get("role") == "operator"
            else UserRole.VIEWER
        )
        default_tok = generate_token()
        user = User(
            username=target_username,
            role=role_enum,
            token_sha256=hash_token(default_tok),
            is_active=True,
            telegram_chat_id=str(chat_id),
            telegram_username=tg_handle or None,
            telegram_verified_at=utcnow(),
        )
        session.add(user)
        session.commit()
        save_user_token(user.username, default_tok, settings)

    user.telegram_chat_id = str(chat_id)
    if tg_handle:
        user.telegram_username = tg_handle
    if user.telegram_verified_at is None:
        user.telegram_verified_at = utcnow()
    session.commit()

    token = ensure_user_token(session, user, settings)
    role_badge = "owner" if user.username == "owner" else user.role.value
    if settings is not None:
        if user.username == "owner":
            settings.save_runtime_overlay(
                {
                    "telegram_owner_linked": True,
                    "telegram_chat_id": str(chat_id),
                    "telegram_verified_username": tg_handle or disp_name,
                }
            )
        save_telegram_binding(
            chat_id,
            {
                "user_id": user.id,
                "username": user.username,
                "tg_username": tg_handle,
                "first_name": disp_name,
                "role": role_badge,
                "allowed_system": user.allowed_system or "*",
                "verified": True,
            },
            settings,
        )
        sync_access_registry(session, settings)
    return user, token, role_badge


def _users_markup(session: Session, settings: Settings | None = None) -> dict[str, Any]:
    from netops.models import User

    rows: list[list[dict[str, str]]] = []
    users = session.scalars(select(User).order_by(User.username)).all()
    current_row: list[dict[str, str]] = []
    for u in users:
        icon = (
            "🚫"
            if not u.is_active
            else ("🟢" if (u.telegram_chat_id or u.bound_client_id) else "🔑")
        )
        role_short = u.role.value.upper()[:3]
        current_row.append(
            {
                "text": f"{icon} {u.username} [{role_short}]",
                "callback_data": f"/token {u.username}",
            }
        )
        if len(current_row) == 2:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)
    rows.append([{"text": "🧹 Очистить дубли сессий", "callback_data": "/cleanup"}])
    rows.extend(_menu_keyboard())
    return {"inline_keyboard": rows}


def _public_host(settings: Settings | None = None) -> str:
    import os

    return (
        (settings.clab_host if settings and settings.clab_host else None)
        or os.getenv("NETOPS_CLAB_HOST")
        or "localhost"
    )


def _bot_username(settings: Settings | None = None) -> str:
    raw = (
        getattr(settings, "telegram_bot_username", None)
        if settings is not None
        else None
    ) or ""
    return str(raw).lstrip("@") or ""


def _web_urls(settings: Settings | None = None) -> tuple[str, str]:
    host = _public_host(settings)
    owner_port = int(const("console.owner_port"))
    port = int(getattr(settings, "frontend_port", None) or owner_port) if settings is not None else owner_port
    pub_override = (
        str(getattr(settings, "public_web_url", "") or "").strip().rstrip("/")
        if settings is not None
        else ""
    )
    public_base = pub_override or f"http://{host}:{port}"
    local_base = f"http://127.0.0.1:{port}"
    return public_base, local_base


def _user_card_markup(
    session: Session, username: str, settings: Settings | None = None
) -> dict[str, Any]:
    from netops.models import User

    u = session.scalar(select(User).where(User.username == username))
    if u is None:
        return _users_markup(session, settings)
    tok = ensure_user_token(session, u, settings)
    pub_base, _ = _web_urls(settings)
    bot_name = _bot_username(settings)
    rows: list[list[dict[str, str]]] = [
        [
            {"text": "🌐 Открыть Web-панель", "url": f"{pub_base}/?token={tok}"},
            {"text": "🔗 Привязать TG", "url": f"https://t.me/{bot_name}?start={tok}"},
        ],
        [
            {"text": "👑 Admin", "callback_data": f"/role {u.username} admin"},
            {"text": "🛠 Operator", "callback_data": f"/role {u.username} operator"},
            {"text": "👁 Viewer", "callback_data": f"/role {u.username} viewer"},
        ],
        [
            {"text": "♾ Навсегда", "callback_data": f"/ttl {u.username} forever"},
            {"text": "⏳ 24 часа", "callback_data": f"/ttl {u.username} 1440"},
            {"text": "⏱ 1 час", "callback_data": f"/ttl {u.username} 60"},
        ],
    ]
    sec_row: list[dict[str, str]] = []
    if u.is_active:
        sec_row.append({"text": "🚫 Заблокировать", "callback_data": f"/block {u.username}"})
    else:
        sec_row.append({"text": "✅ Разблокировать", "callback_data": f"/unblock {u.username}"})
    if u.bound_client_id:
        sec_row.append({"text": "🔌 Отвязать браузер", "callback_data": f"/unbind {u.username}"})
    rows.append(sec_row)
    rows.append(
        [
            {"text": "⬅️ К списку участников", "callback_data": "/users"},
            {"text": "🏠 Главное меню", "callback_data": "/overview"},
        ]
    )
    return {"inline_keyboard": rows}


@dataclass
class BotState:
    last_update_id: int | None = None
    last_drift_id: int = 0
    reported_jobs: set[str] = field(default_factory=set)
    # Последний сообщённый статус по устройству: оповещаем только при его смене.
    device_status: dict[str, DriftStatus] = field(default_factory=dict)
    # Текст последней отправленной ошибки задачи: повторы той же ошибки не дублируем.
    reported_errors: set[str] = field(default_factory=set)
    # Последние сообщённые тихие аварии AI Telemetry Guard (hostname -> тип аномалии).
    reported_anomalies: dict[str, str] = field(default_factory=dict)


class MetricsBot:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        api: TelegramApi,
        chat_ids: Sequence[int],
        state: BotState | None = None,
        *,
        admin_chat_ids: Sequence[int] | None = None,
        open_registration: bool = False,
        settings: Settings | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._api = api
        self._chat_ids = list(chat_ids)
        self._admin_chat_ids = set(admin_chat_ids if admin_chat_ids is not None else chat_ids)
        self._state = state or BotState()
        self._open_registration = open_registration
        self._settings = settings

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

    def send_startup_audit(self) -> str:
        from netops.models import User

        with self._session_factory() as session:
            users = list(session.scalars(select(User).order_by(User.id)).all())
            bound_users = [u for u in users if u.bound_client_id]
            verified_tg = [u for u in users if u.telegram_chat_id]
            mode = (
                "ONLINE SSH (Scrapli)"
                if (self._settings and self._settings.network_driver == "scrapli")
                else "OFFLINE Эмуляция"
            )
            lines = [
                f"Аудит подключений и сессий ({mode})",
                f"Участников: {len(users)} | Веб-сессий: {len(bound_users)} | Telegram: {len(verified_tg)}",
            ]
            for u in users:
                dev_str = f"В СЕТИ: {u.bound_client_id}" if u.bound_client_id else "Свободна"
                lines.append(f"• ID #{u.id} {u.username} [{u.role.value.upper()}] — {dev_str}")
            report = "\n".join(lines)
            for cid in self._owner_chat_ids(session):
                self._send(cid, report, reply_markup={"inline_keyboard": _menu_keyboard()})
            return report

    def _owner_chat_ids(self, session: Session) -> list[int]:
        from netops.models import User

        owner = session.scalar(select(User).where(User.username == "owner"))
        if (
            owner is not None
            and owner.telegram_chat_id
            and str(owner.telegram_chat_id).lstrip("-").isdigit()
        ):
            return [int(owner.telegram_chat_id)]
        if (
            self._settings is not None
            and self._settings.telegram_chat_id
            and str(self._settings.telegram_chat_id).lstrip("-").isdigit()
        ):
            return [int(self._settings.telegram_chat_id)]
        return list(self._chat_ids[:1])

    def poll_once(self) -> None:
        global _BOT_POLLING_ACTIVE
        _BOT_POLLING_ACTIVE = True
        for update in self._api.updates(self._state.last_update_id):
            self._state.last_update_id = int(update["update_id"]) + 1
            if "callback_query" in update:
                self._handle_callback(update["callback_query"] or {})
            elif "my_chat_member" in update:
                cm = dict(update["my_chat_member"] or {})
                new_status = str((cm.get("new_chat_member") or {}).get("status") or "")
                if new_status in ("member", "administrator", "creator"):
                    cm.setdefault("text", "/start")
                    self._handle(cm)
            else:
                self._handle(update.get("message") or {})

    def send_alerts(self) -> None:
        with self._session_factory() as session:
            for text in self._new_alerts(session):
                self._broadcast(text)

    def _send(self, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None:
        try:
            self._api.send(chat_id, text, reply_markup=reply_markup)
        except TypeError:
            self._api.send(chat_id, text)

    def _authorize_chat(
        self,
        chat_id: Any,
        *,
        from_user: dict[str, Any] | None = None,
        text: str = "",
    ) -> bool:
        if not isinstance(chat_id, int):
            return False
        if chat_id in self._chat_ids:
            if self._settings is not None:
                from netops.models import User

                with self._session_factory() as session:
                    owner_u = session.scalar(select(User).where(User.username == "owner"))
                    if owner_u is None or not owner_u.telegram_chat_id:
                        bind_telegram_chat_user(
                            session,
                            chat_id,
                            tg_username=(from_user or {}).get("username"),
                            first_name=(from_user or {}).get("first_name"),
                            settings=self._settings,
                        )
            return True
        if not self._open_registration:
            logger.warning(
                "Запрос из чата %s отклонён: его нет в NETOPS_TELEGRAM_CHAT_IDS", chat_id
            )
            return False

        from netops.models import User
        from netops.security import hash_token
        from netops.services.notifier import (
            KNOWN_TELEGRAM_PROFILES,
            save_subscriber,
        )
        from netops.services.users import _is_expired

        tg_user = (from_user or {}).get("username")
        first_name = (from_user or {}).get("first_name")
        parts = text.split()
        cmd = parts[0].split("@")[0] if parts else ""
        code_arg = (
            parts[1].strip() if len(parts) > 1 and cmd in ("/verify", "/start", "/auth") else None
        )

        with self._session_factory() as session:
            matched_user = session.scalar(select(User).where(User.telegram_chat_id == str(chat_id)))
            owner_u = session.scalar(select(User).where(User.username == "owner"))
            if matched_user is None and (
                owner_u is None or not owner_u.telegram_chat_id or chat_id in KNOWN_TELEGRAM_PROFILES
            ):
                matched_user, _, _ = bind_telegram_chat_user(
                    session,
                    chat_id,
                    tg_username=tg_user,
                    first_name=first_name,
                    settings=self._settings,
                )
            if matched_user is None and code_arg:
                from netops.services.sessions import peek_invite_code

                inv_uname = peek_invite_code(code_arg)
                candidate = (
                    session.scalar(select(User).where(User.username == inv_uname))
                    if inv_uname
                    else session.scalar(
                        select(User).where(
                            (User.verification_code == code_arg)
                            | (User.token_sha256 == hash_token(code_arg))
                        )
                    )
                )
                if candidate is not None:
                    if (
                        candidate.verification_code == code_arg
                        and candidate.verification_expires_at is not None
                        and _is_expired(candidate.verification_expires_at)
                    ):
                        self._send(
                            chat_id,
                            "[NetOps Security] Срок действия 6-значного кода верификации истёк.",
                        )
                        return False
                    matched_user = candidate

            if matched_user is None:
                self._send(
                    chat_id,
                    f"[NetOps Security] Ваш Telegram (ID: {chat_id}) не привязан. Отправьте /verify <КОД>.",
                )
                return False

            self._chat_ids.append(chat_id)
            if self._settings is not None:
                save_subscriber(self._settings, chat_id)
            bind_telegram_chat_user(
                session,
                chat_id,
                tg_username=tg_user,
                first_name=first_name,
                explicit_token=code_arg,
                settings=self._settings,
            )
        return True

    def _handle_callback(self, cb: dict[str, Any]) -> None:
        cb_id = cb.get("id")
        if cb_id and hasattr(self._api, "answer_callback"):
            self._api.answer_callback(str(cb_id))
        msg = cb.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id")
        message_id = msg.get("message_id")
        from_user = cb.get("from") or {}
        text = str(cb.get("data") or "").strip()
        if not text.startswith("/") or not self._authorize_chat(
            chat_id, from_user=from_user, text=text
        ):
            return
        self._dispatch(
            int(chat_id),
            text,
            from_user=from_user,
            edit_message_id=int(message_id) if isinstance(message_id, int) else None,
        )

    def _handle(self, message: dict[str, Any]) -> None:
        chat_id = (message.get("chat") or {}).get("id")
        from_user = message.get("from") or message.get("chat") or {}
        text = str(message.get("text") or "").strip()
        if not text:
            return
        if not text.startswith("/"):
            if not self._authorize_chat(chat_id, from_user=from_user, text="/ai"):
                return
            self._dispatch(int(chat_id), f"/ai {text}", from_user=from_user)
            return
        if not self._authorize_chat(chat_id, from_user=from_user, text=text):
            return
        self._dispatch(int(chat_id), text, from_user=from_user)

    def _caller_role(self, session: Session, chat_id: int | None) -> str:
        if chat_id is None:
            return "admin"
        from netops.models import User

        u = session.scalar(select(User).where(User.telegram_chat_id == str(chat_id)))
        if u is not None:
            if not u.is_active:
                return "blocked"
            return "owner" if u.username == "owner" else u.role.value
        if chat_id in self._admin_chat_ids:
            return "admin"
        return "viewer"

    def _dispatch(
        self,
        chat_id: int,
        text: str,
        *,
        from_user: dict[str, Any] | None = None,
        edit_message_id: int | None = None,
    ) -> None:
        parts = text.split()
        command = parts[0].split("@")[0]
        args = parts[1:]
        with self._session_factory() as session:
            role = self._caller_role(session, chat_id)
            is_admin = role in ("owner", "admin")
            answer = self._answer(
                session,
                command,
                args,
                chat_id=chat_id,
                from_user=from_user,
            )
            if (
                is_admin
                and command in ("/token", "/ttl", "/block", "/unblock", "/unbind", "/role")
                and args
            ):
                target_user = args[0].strip()
                if edit_message_id is not None and command != "/token":
                    card = _token_text(session, [target_user], settings=self._settings)
                    answer = f"✅ {answer}\n\n{card}"
                markup = _user_card_markup(session, target_user, self._settings)
            elif is_admin and command in ("/users", "/tokens", "/cleanup"):
                markup = _users_markup(session, self._settings)
            else:
                markup = {"inline_keyboard": _menu_keyboard()}

            if edit_message_id is not None and hasattr(self._api, "edit"):
                if self._api.edit(chat_id, edit_message_id, answer, reply_markup=markup):
                    return
            self._send(chat_id, answer, reply_markup=markup)

    def _answer(
        self,
        session: Session,
        command: str,
        args: Sequence[str] = (),
        *,
        chat_id: int | None = None,
        from_user: dict[str, Any] | None = None,
    ) -> str:
        if command in ("/start", "/verify"):
            return _answer_verify_or_start(
                session, command, args, chat_id, from_user, self._settings
            )
        if command == "/help":
            return _BOT_HELP_TEXT

        role = self._caller_role(session, chat_id)
        if role == "blocked":
            return "🚫 Ваш профиль заблокирован администратором."
        if command == "/recover":
            return _answer_recover(session, chat_id, from_user, self._settings)

        admin_commands = {
            "/users",
            "/tokens",
            "/cleanup",
            "/ttl",
            "/security",
            "/block",
            "/unblock",
            "/unbind",
            "/role",
        }
        if command in admin_commands and role not in ("owner", "admin"):
            return "⛔ Недостаточно прав: управление реестром и доступом доступно только Admin / Owner."

        if command == "/token" and role not in ("owner", "admin"):
            from netops.models import User

            caller = (
                session.scalar(select(User).where(User.telegram_chat_id == str(chat_id)))
                if chat_id is not None
                else None
            )
            if caller is None:
                return "⛔ Недостаточно прав."
            if args and args[0].strip() != caller.username:
                return "⛔ Недостаточно прав: вы можете запросить ссылку только для своего профиля."
            args = [caller.username]

        if command in ("/collect", "/scan") and role not in ("owner", "admin", "operator"):
            return "⛔ Недостаточно прав: запуск опроса и сканирования доступен с ролью Operator и выше."
        if command == "/freeze" and args and role not in ("owner", "admin", "operator"):
            return "⛔ Недостаточно прав: управление Kill Switch доступно с ролью Operator и выше."

        simple_routes = {
            "/overview": lambda: _overview_text(session, self._settings),
            "/status": lambda: _status_text(session, self._settings),
            "/drift": lambda: _drift_text(session),
            "/jobs": lambda: _jobs_text(session),
            "/metrics": lambda: _metrics_text(session),
            "/fabrics": lambda: _fabrics_text(session, self._settings),
            "/stands": lambda: _fabrics_text(session, self._settings),
            "/users": lambda: _users_text(session, self._settings),
            "/tokens": lambda: _users_text(session, self._settings),
            "/cleanup": lambda: _cleanup_duplicates_text(session, self._settings),
            "/token": lambda: _token_text(session, args, settings=self._settings),
            "/ttl": lambda: _set_user_ttl_text(session, args, settings=self._settings),
            "/security": lambda: _security_text(self._settings),
            "/block": lambda: _set_user_active_text(session, args, active=False),
            "/unblock": lambda: _set_user_active_text(session, args, active=True),
            "/unbind": lambda: _unbind_user_text(session, args),
            "/role": lambda: _set_user_role_text(session, args),
            "/collect": lambda: _collect_now_text(session, self._settings),
            "/scan": lambda: _scan_now_text(session, self._session_factory, self._settings),
            "/freeze": lambda: _freeze_text(args, self._settings),
            "/ai": lambda: _ai_copilot_text(session, args, settings=self._settings),
            "/ask": lambda: _ai_copilot_text(session, args, settings=self._settings),
        }
        handler = simple_routes.get(command)
        if handler is not None:
            return handler()
        if not command.startswith("/"):
            return _ai_copilot_text(session, [command, *args], settings=self._settings)
        return _ai_copilot_text(session, [command.lstrip("/"), *args], settings=self._settings)

    def _new_alerts(self, session: Session) -> list[str]:
        from netops.services.ai_guard import AiTelemetryGuard

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
                    alerts.append(f"[OK] {hostname}: снова совпадает с эталоном")
                continue
            alerts.append(f"[ALERT] {hostname}: {record.status.value}\n{_drift_details(record)}")
        # Плановая задача падает так же регулярно, поэтому один и тот же текст не повторяем.
        for job in _failed_jobs(session):
            if str(job.id) in self._state.reported_jobs:
                continue
            self._state.reported_jobs.add(str(job.id))
            text = f"[ERROR] Задача {job.type.value} упала: {job.error or 'без описания'}"
            if text in self._state.reported_errors:
                continue
            self._state.reported_errors.add(text)
            alerts.append(text)
        # Проактивные оповещения о «тихих» авариях трафика (AI Telemetry Guard Blackhole / Storm)
        guard = AiTelemetryGuard(self._settings or get_settings())
        for dev in session.scalars(select(Device).order_by(Device.hostname)).all():
            injected = guard.get_injected_anomaly(dev.hostname)
            if injected is not None:
                if self._state.reported_anomalies.get(dev.hostname) != injected:
                    self._state.reported_anomalies[dev.hostname] = injected
                    verdict = guard.verify_execution(dev)
                    alerts.append(
                        f"[AI GUARD ALERT] {dev.hostname}: {verdict.problem or injected}"
                    )
            elif dev.hostname in self._state.reported_anomalies:
                self._state.reported_anomalies.pop(dev.hostname, None)
                alerts.append(f"[OK] {dev.hostname}: телеметрия вернулась в норму (AI Guard)")
        return alerts

    def _broadcast(self, text: str) -> None:
        for chat_id in self._chat_ids:
            self._send(chat_id, text)


_BOT_HELP_TEXT = (
    "Метрики, AI-Копилот, реестр и безопасность NetOps:\n"
    "/ai [вопрос] — ИИ-аудит фабрики, прогноз нагрузки и ответ на любой вопрос\n"
    "/fabrics — список подключенных кластеров/стендов и политика подключения новых\n"
    "/collect — принудительно снять свежие метрики с роутеров по SSH\n"
    "/scan — запустить внеочередное сканирование дрейфа (Drift Scan)\n"
    "/freeze [on|off] — аварийный Kill Switch (блокировка деплоев на фабрике)\n"
    "/verify <код> — привязать Telegram к системе по 6-значному коду из фронтенда\n"
    "/overview — наглядная сводка: что и где сейчас происходит на стенде\n"
    "/status — устройства, IP:порт, роли и статусы синхронизации\n"
    "/drift — где найден дрейф и какие именно строки расходятся\n"
    "/jobs — последние задачи пайплайна и целевые узлы\n"
    "/metrics — живая телеметрия CPU, RAM, портов, BGP и пингов\n"
    "/users — единый реестр участников (ID, TG ID, системы, сроки токенов)\n"
    "/token <имя> — открыть персональную карточку и пульт управления участником\n"
    "/ttl <имя> <минуты|forever> — задать время жизни токена или навсегда\n"
    "/security — журнал событий безопасности и заблокированных атак\n"
    "/block <имя> / /unblock <имя> — ограничить или разблокировать доступ\n"
    "/role <имя> <viewer|operator|admin> — сменить роль\n"
    "/unbind <имя> — отвязать устройство от ссылки"
)


def _answer_verify_or_start(
    session: Session,
    command: str,
    args: Sequence[str],
    chat_id: int | None,
    from_user: dict[str, Any] | None,
    settings: Any,
) -> str:
    explicit_tok = args[0] if args else None
    if command == "/verify" and not explicit_tok:
        return "Укажите 6-значный код верификации из веб-панели:\n/verify <КОД>"
    is_recover = explicit_tok == "recover_owner"
    if explicit_tok in ("claim_owner", "recover_owner"):
        explicit_tok = None
    user, token, role_badge = bind_telegram_chat_user(
        session,
        chat_id or 0,
        tg_username=(from_user or {}).get("username"),
        first_name=(from_user or {}).get("first_name"),
        explicit_token=explicit_tok,
        settings=settings,
    )
    if is_recover:
        user.bound_client_id = None
        user.bound_ip = None
        user.bound_user_agent = None
        user.bound_at = None
        session.commit()
    pub_base, loc_base = _web_urls(settings)
    bot_name = _bot_username(settings)
    return (
        f"CROC DREAM NetOps Bot (@{bot_name}) — Верификация подтверждена\n"
        f"Участник: ID #{user.id} {user.username} [{role_badge.upper()}]\n"
        f"Веб-панель (публичная): {pub_base}/?token={token}\n"
        f"Веб-панель (локальная): {loc_base}/?token={token}\n\n"
        + _overview_text(session, settings)
    )


def _answer_recover(
    session: Session,
    chat_id: int | None,
    from_user: dict[str, Any] | None,
    settings: Any,
) -> str:
    from netops.models import User
    from netops.services.sessions import issue_invite_code

    user = (
        session.scalar(select(User).where(User.telegram_chat_id == str(chat_id)))
        if chat_id is not None
        else None
    )
    if user is None:
        return "Ваш Telegram ещё не привязан к профилю. Сначала выполните /verify <КОД>."
    user.bound_client_id = None
    user.bound_ip = None
    user.bound_user_agent = None
    user.bound_at = None
    session.commit()
    role_badge = "owner" if user.username == "owner" else user.role.value
    inv_code = issue_invite_code(user.username)
    pub_base, loc_base = _web_urls(settings)
    return (
        f"🔓 Привязка старого ПК для {user.username} [{role_badge.upper()}] успешно сброшена!\n"
        f"• Публичная: {pub_base}/?token={inv_code}\n"
        f"• Локальная: {loc_base}/?token={inv_code}"
    )


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
        f"лишних строк: {len(record.unauthorized_lines)}, не хватает: {len(record.missing_lines)}"
    )


def _overview_text(session: Session, settings: Settings | None = None) -> str:
    from netops.models import User

    driver = settings.network_driver if settings is not None else "scrapli"
    mode_str = "ONLINE SSH (Scrapli)" if driver == "scrapli" else "OFFLINE (эмуляция)"
    devices = session.scalars(select(Device).order_by(Device.hostname)).all()
    samples, collected_at = collector.latest()

    cpu_by_host: dict[str, float] = {}
    mem_by_host: dict[str, float] = {}
    uplink_by_host: dict[str, float] = {}
    bgp_up_by_host: dict[str, list[str]] = {}
    for s in samples:
        h = str(s.labels.get("hostname", ""))
        if s.name == metrics.CPU_USAGE:
            cpu_by_host[h] = s.value
        elif s.name == metrics.MEMORY_USAGE:
            mem_by_host[h] = s.value
        elif s.name == metrics.UPLINK_UTIL:
            uplink_by_host[h] = s.value
        elif s.name == metrics.BGP_SESSION_UP:
            state_lbl = "UP" if s.value else "DOWN"
            bgp_up_by_host.setdefault(h, []).append(f"{s.labels.get('peer')}:{state_lbl}")

    lines = [
        f"Состояние стенда ({mode_str}) — узлов: {len(devices)}"
        + (f", срез {collected_at:%H:%M:%S} UTC" if collected_at else ""),
    ]
    for d in devices:
        cpu = f"{cpu_by_host[d.hostname]:g}%" if d.hostname in cpu_by_host else "—"
        mem = f"{mem_by_host[d.hostname]:g}%" if d.hostname in mem_by_host else "—"
        upl = f"{uplink_by_host[d.hostname]:g}%" if d.hostname in uplink_by_host else "—"
        bgp_peers = ", ".join(bgp_up_by_host.get(d.hostname, [])) or "нет соседей"
        lines.append(
            f"• {d.hostname} ({d.platform.value}, {d.management_ip}:{d.management_port})\n"
            f"  Статус: {d.status.value} | CPU: {cpu} | RAM: {mem} | Uplink: {upl}\n"
            f"  BGP: {bgp_peers}"
        )

    jobs = session.scalars(select(Job).order_by(Job.created_at.desc()).limit(3)).all()
    if jobs:
        lines.append("\nПоследние операции:")
        for j in jobs:
            lines.append(
                f"• {j.created_at:%H:%M:%S} {j.type.value} -> {j.status.value} ({j.progress}%, автор: {j.created_by})"
            )

    users = session.scalars(select(User).order_by(User.username)).all()
    if users:
        active_cnt = sum(1 for u in users if u.is_active)
        bound_cnt = sum(1 for u in users if u.bound_client_id)
        lines.append(
            f"\nУчастников в реестре: {len(users)} (активных: {active_cnt}, сессий: {bound_cnt})"
        )

    return "\n".join(lines)


def _status_text(session: Session, settings: Settings | None = None) -> str:
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
    lines.append("\nДетализация по узлам:")
    for d in devices:
        checked = f"{d.last_checked_at:%H:%M:%S}" if d.last_checked_at else "не проверялся"
        lines.append(
            f"• {d.hostname} [{d.role.value}/{d.platform.value}] "
            f"{d.management_ip}:{d.management_port} — {d.status.value} (проверен: {checked})"
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
    lines: list[str] = []
    for record in records:
        head = (
            f"{record.device.hostname} — {record.status.value}, "
            f"{record.checked_at:%d.%m %H:%M}: {_drift_details(record)}"
        )
        lines.append(head)
        for u_line in (record.unauthorized_lines or [])[:3]:
            lines.append(f"  + {u_line}")
        for m_line in (record.missing_lines or [])[:3]:
            lines.append(f"  - {m_line}")
    return "\n".join(lines)


def _jobs_text(session: Session) -> str:
    jobs = session.scalars(select(Job).order_by(Job.created_at.desc()).limit(5)).all()
    if not jobs:
        return "Задач пока не было"
    lines: list[str] = []
    for job in jobs:
        target_names = ", ".join(t.hostname for t in job.targets) if job.targets else "все узлы"
        lines.append(
            f"{job.created_at:%d.%m %H:%M} {job.type.value} — {job.status.value}"
            f" ({job.progress}%), автор {job.created_by} [{target_names}]"
        )
    return "\n".join(lines)


def _metrics_text(session: Session) -> str:
    samples, collected_at = collector.latest()
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
    cpus: list[str] = []
    mems: list[str] = []
    uplinks: list[str] = []
    for sample in samples:
        host = str(sample.labels.get("hostname", ""))
        peer = f"{host} → {sample.labels.get('peer')}"
        if sample.name == metrics.DEVICES_TOTAL:
            devices += sample.value
        elif sample.name == metrics.DRIFT_DEVICES:
            drift = sample.value
        elif sample.name == metrics.DEVICE_REACHABLE and not sample.value:
            unreachable.append(host)
        elif sample.name == metrics.BGP_SESSION_UP:
            bgp.append((peer, sample.value))
        elif sample.name == metrics.INTERFACE_UP:
            ports.append((f"{host} {sample.labels.get('interface')}", sample.value))
        elif sample.name == metrics.PING_LOSS:
            losses.append((peer, sample.value))
        elif sample.name == metrics.CPU_USAGE:
            cpus.append(f"{host}: {sample.value:g}%")
        elif sample.name == getattr(metrics, "MEMORY_USAGE", "netops_memory_usage_percent"):
            mems.append(f"{host}: {sample.value:g}%")
        elif sample.name == metrics.UPLINK_UTIL:
            uplinks.append(f"{host}: {sample.value:g}%")

    lines = [
        f"Устройств: {devices:g}"
        + (f", не отвечают: {', '.join(unreachable)}" if unreachable else ", все отвечают")
    ]
    if cpus:
        lines.append(f"CPU: {', '.join(cpus)}")
    if mems:
        lines.append(f"RAM: {', '.join(mems)}")
    if uplinks:
        lines.append(f"Аплинки: {', '.join(uplinks)}")
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


def _users_text(session: Session, settings: Settings | None = None) -> str:
    from netops.models import User
    from netops.services.notifier import load_telegram_bindings

    users = session.scalars(select(User).order_by(User.username)).all()
    if not users:
        return "Персональных ссылок в БД пока нет."
    tg_bindings = load_telegram_bindings(settings)
    lines = [f"Единый реестр участников, токенов и систем ({len(users)}):"]
    for u in users:
        state_label = "[ACTIVE]" if u.is_active else "[BLOCKED]"
        scope = u.allowed_system or "Вся фабрика"
        if u.bound_client_id:
            dev_info = f"привязана: {u.bound_client_id}" + (
                f" ({u.bound_ip})" if u.bound_ip else ""
            )
        else:
            dev_info = "свободна"
        tg_match = next(
            (b for b in tg_bindings.values() if b.get("username") == u.username),
            None,
        )
        extra = f" · ID #{u.id}"
        ttl_str = (
            f"до {u.expires_at.strftime('%d.%m %H:%M UTC')}"
            if getattr(u, "expires_at", None)
            else "НАВСЕГДА"
        )
        extra += f" · срок: {ttl_str}"
        tg_cid = getattr(u, "telegram_chat_id", None) or (
            tg_match.get("chat_id") if (tg_match and settings is not None) else None
        )
        tg_handle = getattr(u, "telegram_username", None) or (
            tg_match.get("tg_username") if (tg_match and settings is not None) else None
        )
        if tg_cid and settings is not None:
            extra += f" · TG: @{tg_handle} [{tg_cid}]" if tg_handle else f" · TG: [{tg_cid}]"
        if getattr(u, "verification_code", None):
            extra += f" · КОД TG: {u.verification_code}"
        lines.append(
            f"{state_label} {u.username} [{u.role.value}] · система: {scope} · {dev_info}{extra}"
        )
    return "\n".join(lines)


def _cleanup_duplicates_text(session: Session, settings: Settings | None = None) -> str:
    from netops.models import User

    users = list(session.scalars(select(User).order_by(User.id)).all())
    removed: list[str] = []
    for u in users:
        if not u.telegram_chat_id and u.username.startswith(("owner-", "viewer-")):
            removed.append(u.username)
            session.delete(u)
    session.commit()
    if not removed:
        return "Дублирующихся гостевых сессий не обнаружено.\n\n" + _users_text(session, settings)
    return f"Очищено временных дублей ({len(removed)}): {', '.join(removed)}\n\n" + _users_text(
        session, settings
    )


def _token_text(session: Session, args: Sequence[str], *, settings: Settings | None = None) -> str:
    from netops.models import User

    if not args:
        return "Укажите имя пользователя: /token <username>"
    username = args[0].strip()
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        return f"Пользователь {username} не найден"
    tok = ensure_user_token(session, user, settings)
    state_icon = "🟢 АКТИВЕН" if user.is_active else "🚫 ЗАБЛОКИРОВАН"
    pub_base, loc_base = _web_urls(settings)
    bot_name = _bot_username(settings)
    return (
        f"Участник #{user.id}: {user.username} ({state_icon}, {user.role.value.upper()})\n"
        f"Токен: {tok}\n"
        f"Публичный вход: {pub_base}/?token={tok}\n"
        f"Локальный вход: {loc_base}/?token={tok}\n"
        f"Привязка TG: https://t.me/{bot_name}?start={tok}"
    )


def _set_user_ttl_text(
    session: Session, args: Sequence[str], *, settings: Settings | None = None
) -> str:
    from datetime import timedelta

    from netops.models import User

    if len(args) < 2:
        return "Укажите участника и время: /ttl <username> <минуты|forever>"
    username, ttl_arg = args[0].strip(), args[1].strip().lower()
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        return f"Пользователь {username} не найден"
    if ttl_arg in ("forever", "0", "none", "inf", "навсегда"):
        user.expires_at = None
        label = "НАВСЕГДА (бессрочный)"
    elif ttl_arg.isdigit() and int(ttl_arg) > 0:
        mins = int(ttl_arg)
        user.expires_at = utcnow() + timedelta(minutes=mins)
        label = f"{mins} мин (до {user.expires_at.strftime('%Y-%m-%d %H:%M UTC')})"
    else:
        return "Укажите число минут (например, 60) или forever (навсегда)"
    session.commit()
    return f"Срок действия токена для {username} изменён: {label}"


def _security_text(settings: Settings | None = None) -> str:
    from netops.services.notifier import load_access_registry

    reg = load_access_registry(settings)
    events = list(reg.get("security_events") or [])
    if not events:
        return "Журнал безопасности чист: подозрительных событий не зафиксировано."
    lines = [f"Журнал событий безопасности (последние {min(len(events), 12)}):"]
    for ev in events[:12]:
        ts = str(ev.get("timestamp") or "")[11:19]
        sev = str(ev.get("severity") or "info").upper()
        etype = ev.get("type") or "EVENT"
        msg = ev.get("message") or ""
        lines.append(f"• {ts} [{sev}] {etype}: {msg}")
    return "\n".join(lines)


def _set_user_active_text(session: Session, args: Sequence[str], *, active: bool) -> str:
    from netops.models import User

    if not args:
        return f"Укажите имя пользователя: /{'unblock' if active else 'block'} <username>"
    username = args[0].strip()
    if username == "owner" and not active:
        return "Нельзя заблокировать владельца стенда (owner)"
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        return f"Пользователь {username} не найден"
    user.is_active = active
    session.commit()
    return (
        f"Доступ для {username} возобновлён"
        if active
        else f"Доступ для {username} ограничен (заблокирован)"
    )


def _unbind_user_text(session: Session, args: Sequence[str]) -> str:
    from netops.models import User

    if not args:
        return "Укажите имя пользователя: /unbind <username>"
    username = args[0].strip()
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        return f"Пользователь {username} не найден"
    user.bound_client_id = None
    user.bound_ip = None
    user.bound_user_agent = None
    user.bound_at = None
    user.last_seen_at = None
    session.commit()
    return f"Привязка устройства для {username} сброшена. Ссылка снова свободна."


def _set_user_role_text(session: Session, args: Sequence[str]) -> str:
    from netops.enums import UserRole
    from netops.models import User

    if len(args) < 2:
        return "Укажите имя и роль: /role <username> <viewer|operator|admin>"
    username, role_str = args[0].strip(), args[1].strip().lower()
    if username == "owner":
        return "Роль владельца стенда (owner) изменить нельзя"
    if role_str not in ("viewer", "operator", "admin"):
        return "Допустимые роли: viewer, operator, admin"
    user = session.scalar(select(User).where(User.username == username))
    if user is None:
        return f"Пользователь {username} не найден"
    user.role = UserRole(role_str)
    session.commit()
    return f"Роль для {username} изменена на {role_str}"


def _collect_now_text(session: Session, settings: Settings | None = None) -> str:
    from netops.toolchain import build_toolchain

    eff = settings or get_settings()
    try:
        toolchain = build_toolchain(eff)
        samples = collector.collect(session, toolchain)
        ts = collector.publish(samples, ttl_seconds=eff.metrics_interval_seconds * 3)
        lines = [f"✅ Сбор живой телеметрии завершён ({ts:%H:%M:%S} UTC):"]
        lines.extend(_summary(samples))
        return "\n".join(lines)
    except Exception as exc:
        return f"⚠️ Ошибка при сборе телеметрии: {exc}"


def _scan_now_text(
    session: Session,
    session_factory: sessionmaker[Session],
    settings: Settings | None = None,
) -> str:
    import threading

    from netops.enums import IntentSource, JobType
    from netops.models import JobTarget
    from netops.pipeline.runner import JobRunner
    from netops.toolchain import build_toolchain

    eff = settings or get_settings()
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    if not devices:
        return "В инвентаре нет устройств для сканирования."
    job = Job(
        type=JobType.DRIFT_SCAN,
        intent_source=IntentSource.GIT_MAIN.value,
        created_by="telegram-operator",
    )
    job.targets = [JobTarget(device_id=d.id, hostname=d.hostname) for d in devices]
    session.add(job)
    session.commit()
    job_id = job.id

    def _bg() -> None:
        runner = JobRunner(session_factory, lambda: build_toolchain(eff))
        runner.run(job_id)

    threading.Thread(target=_bg, daemon=True, name=f"tg-scan-{job_id}").start()
    return (
        f"🔍 Запущено внеочередное сканирование дрейфа (Job {str(job_id)[:8]}).\n"
        f"Целевые узлы ({len(devices)}): {', '.join(d.hostname for d in devices)}.\n"
        "По завершении опроса по SSH бот пришлёт отчёт."
    )


def _freeze_text(args: Sequence[str], settings: Settings | None = None) -> str:
    from netops.services.freeze import get_freeze_state, set_freeze_state
    from netops.services.notifier import record_security_event

    if args:
        act = args[0].strip().lower()
        if act in ("on", "1", "true", "freeze"):
            reason = " ".join(args[1:]) or "Активирован через Telegram Kill Switch"
            set_freeze_state(frozen=True, reason=reason, by="telegram-admin")
            record_security_event(
                "KILL_SWITCH_ENGAGED",
                f"Фабрика заморожена из Telegram: {reason}",
                severity="critical",
                settings=settings,
            )
        elif act in ("off", "0", "false", "unfreeze"):
            set_freeze_state(frozen=False, reason="", by="telegram-admin")
            record_security_event(
                "KILL_SWITCH_RELEASED",
                "Заморозка фабрики снята из Telegram",
                severity="info",
                settings=settings,
            )
    state = get_freeze_state()
    if state.get("frozen"):
        return (
            f"❄️ KILL SWITCH АКТИВЕН (ФАБРИКА ЗАМОРОЖЕНА)\n"
            f"Причина: {state.get('reason')}\n"
            f"Кем включён: {state.get('updated_by')}\n"
            "Любые операции DEPLOY и DRIFT_REMEDIATE заблокированы.\n"
            "Для снятия: /freeze off"
        )
    return (
        "🟢 Kill Switch отключён: фабрика в штатном режиме (деплой разрешён).\n"
        "Для экстренной блокировки изменений: /freeze on <причина>"
    )


def _fabrics_text(session: Session, settings: Settings | None = None) -> str:
    eff = settings or get_settings()
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    by_site: dict[str, list[Device]] = {}
    for d in devices:
        site_key = (getattr(d, "site", None) or "dc1").strip() or "dc1"
        by_site.setdefault(site_key, []).append(d)

    host = _public_host(eff)
    driver = "ONLINE SSH (Scrapli)" if eff.network_driver == "scrapli" else "OFFLINE (эмуляция)"
    pub_base, _ = _web_urls(eff)
    lines = [
        f"🏗 Подключенные кластеры и стенды ({driver} -> {host}):",
    ]
    if not by_site:
        lines.append("• Нет подключенных стендов (инвентарь пуст).")
    else:
        for site_name, site_devs in sorted(by_site.items()):
            sync_cnt = sum(1 for d in site_devs if d.status is DeviceStatus.IN_SYNC)
            drift_cnt = sum(1 for d in site_devs if d.status is DeviceStatus.DRIFT_DETECTED)
            unreach_cnt = sum(1 for d in site_devs if d.status is DeviceStatus.UNREACHABLE)
            state_badge = "🟢 OK" if (drift_cnt == 0 and unreach_cnt == 0) else "⚠️ ALERT"
            lines.append(
                f"• Стенд «{site_name}» [{state_badge}]: узлов {len(site_devs)} "
                f"(Sync: {sync_cnt}, Drift: {drift_cnt}, Unreachable: {unreach_cnt})"
            )

    lines.extend(
        [
            "",
            "🔐 Политика безопасности (Zero-Secret Chat):",
            "Подключение нового кластера/сервера по SSH и ввод паролей/ключей через чат Telegram "
            "отключены намеренно — переписка мессенджера хранит историю в открытом виде.",
            f"Для безопасного добавления нового кластера или авто-обнаружения топологии Containerlab "
            f"откройте мастер «Матрёшка» в веб-панели ({pub_base}/).",
        ]
    )
    return "\n".join(lines)


def _ai_copilot_text(
    session: Session, args: Sequence[str], *, settings: Settings | None = None
) -> str:
    import asyncio

    from netops.api.routes.insights import select_rag_devices
    from netops.services.ai_guard import AiTelemetryGuard
    from netops.services.freeze import is_factory_frozen
    from netops.services.llm import chat_with_llm

    eff = settings or get_settings()
    question = " ".join(args).strip()[:500]
    devices = list(session.scalars(select(Device).order_by(Device.hostname)).all())
    samples, collected_at = collector.latest()
    guard = AiTelemetryGuard(eff)

    verdict_by_host: dict[str, str] = {}
    anomalies: list[str] = []
    ai_anom_map: dict[str, str] = {}
    for d in devices:
        v_cpu = guard.verify_execution(d, metric="cpu_pct", horizon=12)
        v_upl = guard.verify_execution(d, metric="uplink_util_pct", horizon=12)
        ok_pre, pre_msg = guard.check_preflight(d)
        status_tag = "OK" if (v_cpu.healthy and v_upl.healthy and ok_pre) else "ALERT"
        verdict_by_host[d.hostname] = (
            f"• {d.hostname} [{d.status.value}]: Guard={status_tag} | "
            f"CPU={v_cpu.observed_value:g}% (коридор [{v_cpu.expected_range[0]:g}..{v_cpu.expected_range[1]:g}%]) | "
            f"{pre_msg}"
        )
        if not v_cpu.healthy and v_cpu.problem:
            anomalies.append(f"{d.hostname}: {v_cpu.problem}")
            ai_anom_map[d.hostname] = v_cpu.problem
        if not v_upl.healthy and v_upl.problem:
            anomalies.append(f"{d.hostname}: {v_upl.problem}")
            ai_anom_map[d.hostname] = v_upl.problem

    rag_devs = select_rag_devices(question, devices, ai_anomalies=ai_anom_map, top_k=12)
    verdicts = [verdict_by_host[d.hostname] for d in rag_devs if d.hostname in verdict_by_host]

    summary_lines = _summary(samples) if collected_at else ["Метрики ещё не собирались"]
    freeze_note = "ЗАМОРОЖЕНА (Kill Switch)" if is_factory_frozen() else "Штатный режим"
    context_block = (
        f"Режим фабрики: {freeze_note} (всего узлов: {len(devices)})\n"
        f"Сводка метрик:\n" + "\n".join(summary_lines) + "\n\n"
        "Вердикты мониторинга телеметрии:\n" + "\n".join(verdicts)
    )

    sys_prompt = (
        "Ты — сетевой ассистент платформы CROC DREAM NetOps (CLOS Spine-Leaf).\n"
        "Опирайся на переданные метрики, не раскрывай пароли/токены и название своей LLM-модели.\n"
        "Отвечай естественно, кратко и по делу (2–5 предложений) на русском языке, без лишних заголовков."
    )
    user_prompt = (
        f"Контекст сети:\n{context_block}\n\n"
        f"Сообщение: {question or 'Дай краткую сводку по состоянию сети и прогнозу нагрузки.'}"
    )
    try:
        res = asyncio.run(chat_with_llm(eff, sys_prompt, user_prompt, timeout_floor=4.0))
        if res is not None:
            return res[0].strip()
    except Exception:
        pass

    drifting = [d.hostname for d in devices if d.status is DeviceStatus.DRIFT_DETECTED]
    unreach = [d.hostname for d in devices if d.status is DeviceStatus.UNREACHABLE]
    problem_parts: list[str] = []
    if drifting:
        problem_parts.append(f"⚠️ Обнаружен дрейф конфигурации на узлах: {', '.join(drifting)}")
    if unreach:
        problem_parts.append(f"🚨 Недоступны по SSH: {', '.join(unreach)}")
    if anomalies:
        problem_parts.append("Обнаружены отклонения по прогнозу нагрузки:\n" + "\n".join(anomalies))
    if problem_parts:
        return "\n".join(problem_parts)
    if not devices:
        return "В фабрике пока нет подключенных устройств."
    in_sync = sum(1 for d in devices if d.status is DeviceStatus.IN_SYNC)
    return (
        f"Фабрика работает штатно: устройств в инвентаре — {len(devices)} (IN_SYNC: {in_sync}), "
        "прогноз нагрузки в пределах нормы.\n\n" + "\n".join(summary_lines)
    )


def build_bot(settings: Settings, token: str) -> MetricsBot:
    import os

    from netops.services.notifier import load_saved_subscribers

    if (
        ":" in token
        and "PYTEST_CURRENT_TEST" not in os.environ
        and not getattr(settings, "telegram_bot_username", "")
    ):
        try:
            with urllib.request.urlopen(
                f"https://api.telegram.org/bot{token}/getMe", timeout=4.0
            ) as resp:
                body = json.loads(resp.read())
                if body.get("ok"):
                    raw_uname = (body.get("result") or {}).get("username") or ""
                    uname = str(raw_uname).strip().lstrip("@")
                    if uname:
                        settings.telegram_bot_username = uname
                        settings.save_runtime_overlay({"telegram_bot_username": uname})
        except Exception as exc:
            logger.debug("Telegram getMe skipped: %s", exc)

    session_factory = build_session_factory(build_engine(settings.database_url))
    admin_chat_ids = list(settings.telegram_chat_ids)
    chat_ids = list(admin_chat_ids)
    for sub in load_saved_subscribers(settings):
        if sub not in chat_ids:
            chat_ids.append(sub)
    return MetricsBot(
        session_factory,
        HttpTelegramApi(token),
        chat_ids,
        admin_chat_ids=admin_chat_ids,
        open_registration=True,
        settings=settings,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    if settings.telegram_bot_token is None:
        logger.warning("Бот простаивает: задайте NETOPS_TELEGRAM_BOT_TOKEN")
        while settings.telegram_bot_token is None:
            time.sleep(IDLE_SECONDS)
            settings.apply_runtime_overlay()

    bot = build_bot(settings, settings.telegram_bot_token.get_secret_value())
    bot.catch_up()
    bot.send_startup_audit()
    alert_interval = max(3600, settings.drift_scan_interval_seconds)
    last_alert_ts = time.monotonic()
    logger.info(
        "Бот @%s запущен (чатов: %d, верификация по коду: %s, интервал алертов: %ds)",
        _bot_username(settings),
        len(bot._chat_ids),
        bot._open_registration,
        alert_interval,
    )
    while True:
        t0 = time.monotonic()
        bot.poll_once()
        now = time.monotonic()
        if now - last_alert_ts >= alert_interval:
            bot.send_alerts()
            last_alert_ts = now
        if now - t0 < 2.0:
            time.sleep(2.0)


if __name__ == "__main__":
    main()
