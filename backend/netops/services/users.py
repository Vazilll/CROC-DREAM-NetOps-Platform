from __future__ import annotations

import secrets
from collections.abc import Collection, Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from netops.db import utcnow
from netops.errors import ConflictError, NotFoundError
from netops.models import User
from netops.schemas.users import UserBatchCreate, UserCreate, UserUpdate
from netops.security import generate_token, hash_token
from netops.settings import ApiPrincipal


class DeviceBoundConflictError(ConflictError):
    """Raised when a single-device token is used from a different client device."""


def _norm_system(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()[:128]
    return None if cleaned in ("", "*", "all") else cleaned


def _calc_expires_at(minutes: int | None):
    from datetime import timedelta  # noqa: PLC0415

    if minutes is None or minutes <= 0:
        return None
    return utcnow() + timedelta(minutes=minutes)


def _is_expired(exp) -> bool:
    if exp is None:
        return False
    from datetime import timezone  # noqa: PLC0415

    now = utcnow()
    exp_aware = exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp
    now_aware = now.replace(tzinfo=timezone.utc) if now.tzinfo is None else now
    return now_aware >= exp_aware


def _reject_expired_token(
    user: User, clean_client: str | None, clean_ip: str | None, settings: object | None
) -> None:
    try:
        from netops.services.notifier import (  # noqa: PLC0415
            record_security_event,
            send_telegram_message,
        )
        from netops.settings import Settings  # noqa: PLC0415

        s_obj = settings if isinstance(settings, Settings) else None
        record_security_event(
            "TOKEN_EXPIRED_REJECTED",
            f"Попытка входа по истёкшему токену участника {user.username}",
            username=user.username,
            client_id=clean_client,
            client_ip=clean_ip,
            severity="error",
            settings=s_obj,
        )
        if s_obj is not None:
            send_telegram_message(
                s_obj,
                f"<b>[NetOps Security] Истёкший токен отклонён</b>\n"
                f"<b>Участник:</b> <code>{user.username}</code>\n"
                f"<b>Клиент:</b> <code>{clean_client or 'unknown'}</code> ({clean_ip or 'local'})",
            )
    except Exception:
        pass
    raise DeviceBoundConflictError(
        f"Срок действия временного токена ({user.username}) истёк. Запросите продление у администратора."
    )


def _reject_device_conflict(
    user: User,
    clean_client: str | None,
    clean_ip: str | None,
    clean_ua: str | None,
    settings: object | None,
) -> None:
    try:
        from netops.services.notifier import (  # noqa: PLC0415
            record_security_event,
            send_telegram_message,
        )
        from netops.settings import Settings  # noqa: PLC0415

        s_obj = settings if isinstance(settings, Settings) else None
        record_security_event(
            "DEVICE_CONFLICT_BLOCKED",
            f"Заблокирован повторный вход по чужой ссылке {user.username} "
            f"(привязана к {user.bound_client_id}, попытка с {clean_client or 'unknown'} / IP {clean_ip or 'unknown'})",
            username=user.username,
            client_id=clean_client,
            client_ip=clean_ip,
            severity="critical",
            settings=s_obj,
        )
        if s_obj is not None:
            send_telegram_message(
                s_obj,
                f"<b>[SECURITY ALERT] Попытка входа по чужой привязанной ссылке!</b>\n"
                f"<b>Участник (ссылка):</b> <code>{user.username}</code> ({user.role.value.upper()})\n"
                f"<b>Законный владелец:</b> <code>{user.bound_client_id}</code> ({user.bound_ip or 'local'})\n"
                f"<b>Заблокированный клиент:</b> <code>{clean_client or 'no-client-id'}</code> ({clean_ip or 'unknown'} · {clean_ua or 'Browser'})\n"
                f"<i>Вход строго заблокирован (1 токен = 1 устройство).</i>",
                reply_markup={
                    "inline_keyboard": [
                        [
                            {
                                "text": f"Заблокировать {user.username}",
                                "callback_data": f"/block {user.username}",
                            },
                            {
                                "text": f"Сбросить привязку {user.username}",
                                "callback_data": f"/unbind {user.username}",
                            },
                        ]
                    ]
                },
            )
    except Exception:
        pass
    raise DeviceBoundConflictError(
        f"Ссылка доступа ({user.username}) уже привязана к другому устройству ({user.bound_client_id}). "
        "По одной персональной ссылке может войти только один участник."
    )


def _user_quick_actions_keyboard(username: str) -> dict[str, object]:
    return {
        "inline_keyboard": [
            [
                {"text": f"Токен {username}", "callback_data": f"/token {username}"},
                {"text": f"Блок {username}", "callback_data": f"/block {username}"},
                {"text": f"Отвязать {username}", "callback_data": f"/unbind {username}"},
            ]
        ]
    }


def _notify_first_token_bind(
    session: Session,
    user: User,
    token: str,
    clean_client: str | None,
    clean_ip: str | None,
    clean_ua: str | None,
    settings: object | None,
) -> None:
    try:
        from netops.services.notifier import (  # noqa: PLC0415
            load_user_tokens,
            record_security_event,
            send_telegram_message,
            sync_access_registry,
        )
        from netops.settings import Settings  # noqa: PLC0415

        s_obj = settings if isinstance(settings, Settings) else None
        record_security_event(
            "TOKEN_BOUND",
            f"Токен участника {user.username} привязан к устройству {clean_client} (IP {clean_ip or 'local'})",
            username=user.username,
            client_id=clean_client,
            client_ip=clean_ip,
            severity="info",
            settings=s_obj,
        )
        sync_access_registry(session, s_obj)
        if s_obj is not None:
            scope = user.allowed_system or "Вся фабрика CLOS"
            tok = load_user_tokens(s_obj).get(user.username) or token
            ttl_str = (
                f"до {user.expires_at.strftime('%Y-%m-%d %H:%M UTC')}"
                if user.expires_at
                else "НАВСЕГДА (бессрочный)"
            )
            send_telegram_message(
                s_obj,
                f"<b>[NetOps Access] Первичная привязка персональной ссылки</b>\n"
                f"<b>Участник (ID #{user.id}):</b> <code>{user.username}</code> ({user.role.value.upper()})\n"
                f"<b>Токен доступа:</b> <code>{tok}</code>\n"
                f"<b>Срок действия:</b> <code>{ttl_str}</code>\n"
                f"<b>Система стенда:</b> <code>{scope}</code>\n"
                f"<b>Привязанное устройство:</b> <code>{clean_client}</code>\n"
                f"<b>IP / Клиент:</b> <code>{clean_ip or 'local'}</code> · {clean_ua or 'Browser'}\n"
                f"<i>Ссылка заперта за этим устройством. Повторный вход с другого браузера невозможен.</i>",
                reply_markup=_user_quick_actions_keyboard(user.username),
            )
    except Exception:
        pass


def _notify_new_browser_session(
    user: User,
    minted_token: str | None,
    clean_client: str,
    clean_ip: str | None,
    clean_ua: str | None,
    settings: object | None,
) -> None:
    try:
        from netops.services.notifier import load_user_tokens, send_telegram_message  # noqa: PLC0415
        from netops.settings import Settings  # noqa: PLC0415

        if isinstance(settings, Settings):
            scope = user.allowed_system or "Вся фабрика CLOS"
            tok = minted_token or load_user_tokens(settings).get(user.username) or "—"
            send_telegram_message(
                settings,
                f"<b>[NetOps Access] Новая сессия в браузере</b>\n"
                f"<b>Участник:</b> <code>{user.username}</code> ({user.role.value.upper()})\n"
                f"<b>Токен доступа:</b> <code>{tok}</code>\n"
                f"<b>Система стенда:</b> <code>{scope}</code>\n"
                f"<b>Устройство клиента:</b> <code>{clean_client}</code>\n"
                f"<b>IP / Клиент:</b> <code>{clean_ip or 'local'}</code> · {clean_ua or 'Browser'}\n"
                f"<i>Управление: /users, /token {user.username}, /block {user.username}, /unbind {user.username}</i>",
                reply_markup=_user_quick_actions_keyboard(user.username),
            )
    except Exception:
        pass


class UserService:
    def __init__(self, session: Session, *, reserved_usernames: Collection[str] = ()) -> None:
        self._session = session
        self._reserved = frozenset(reserved_usernames)

    def authenticate(
        self,
        token: str,
        *,
        client_id: str | None = None,
        user_agent: str | None = None,
        client_ip: str | None = None,
        settings: object | None = None,
    ) -> ApiPrincipal | None:
        user = self._session.scalar(
            select(User).where(User.token_sha256 == hash_token(token))
        )
        if user is None or not user.is_active:
            return None

        now = utcnow()
        clean_client = (client_id or "").strip()[:128] or None
        clean_ip = (client_ip or "").strip()[:64] or None
        clean_ua = (user_agent or "").strip()[:255] or None

        if _is_expired(user.expires_at):
            _reject_expired_token(user, clean_client, clean_ip, settings)

        first_bind = False
        if user.bound_client_id is not None:
            if clean_client != user.bound_client_id:
                _reject_device_conflict(user, clean_client, clean_ip, clean_ua, settings)
            user.last_seen_at = now
            if clean_ip:
                user.bound_ip = clean_ip
            if clean_ua:
                user.bound_user_agent = clean_ua
            self._session.commit()
        elif clean_client is not None:
            existing_by_client = self._session.scalar(
                select(User).where(User.bound_client_id == clean_client)
            )
            if existing_by_client is not None and existing_by_client.id != user.id:
                existing_by_client.bound_client_id = None
                self._session.flush()
            user.bound_client_id = clean_client
            user.bound_ip = clean_ip
            user.bound_user_agent = clean_ua
            user.bound_at = now
            user.last_seen_at = now
            self._session.commit()
            first_bind = True
        else:
            user.last_seen_at = now
            self._session.commit()

        if first_bind:
            _notify_first_token_bind(
                self._session, user, token, clean_client, clean_ip, clean_ua, settings
            )

        return ApiPrincipal(
            username=user.username,
            role=user.role,
            allowed_system=user.allowed_system,
        )

    def track_browser_session(
        self,
        principal: ApiPrincipal,
        *,
        client_id: str | None = None,
        user_agent: str | None = None,
        client_ip: str | None = None,
        settings: object | None = None,
    ) -> ApiPrincipal:
        clean_client = (client_id or "").strip()[:128] or None
        if not clean_client or not clean_client.startswith("dev-"):
            return principal

        now = utcnow()
        clean_ip = (client_ip or "").strip()[:64] or None
        clean_ua = (user_agent or "").strip()[:255] or None

        user = self._session.scalar(select(User).where(User.bound_client_id == clean_client))
        first_bind = False
        minted_token: str | None = None
        if user is not None:
            if not user.is_active:
                raise DeviceBoundConflictError(
                    f"Доступ для {user.username} ({clean_client}) ограничен владельцем (Owner)."
                )
            user.last_seen_at = now
            if clean_ip:
                user.bound_ip = clean_ip
            if clean_ua:
                user.bound_user_agent = clean_ua
            self._session.commit()
        else:
            from netops.enums import UserRole  # noqa: PLC0415

            short_id = clean_client.replace("dev-", "")[:6]
            base_name = "owner" if principal.role == UserRole.OWNER else principal.username
            candidate_name = "owner" if base_name == "owner" else f"{base_name}-{short_id}"
            existing_user = self._session.scalar(
                select(User).where(User.username == candidate_name)
            )
            if existing_user is not None:
                user = existing_user
                if not user.is_active:
                    raise DeviceBoundConflictError(
                        f"Доступ для {user.username} ({clean_client}) ограничен владельцем (Owner)."
                    )
                user.bound_client_id = clean_client
                user.bound_ip = clean_ip
                user.bound_user_agent = clean_ua
                user.bound_at = user.bound_at or now
                user.last_seen_at = now
                self._session.commit()
            else:
                db_role = principal.role
                minted_token = generate_token()
                user = User(
                    username=candidate_name,
                    role=db_role,
                    token_sha256=hash_token(minted_token),
                    is_active=True,
                    allowed_system=principal.allowed_system,
                    bound_client_id=clean_client,
                    bound_ip=clean_ip,
                    bound_user_agent=clean_ua,
                    bound_at=now,
                    last_seen_at=now,
                )
                try:
                    self._session.add(user)
                    self._session.commit()
                    first_bind = True
                    from netops.services.notifier import save_user_token  # noqa: PLC0415
                    from netops.settings import Settings  # noqa: PLC0415

                    save_user_token(
                        user.username,
                        minted_token,
                        settings if isinstance(settings, Settings) else None,
                    )
                except IntegrityError:
                    self._session.rollback()
                    return principal

        if first_bind and settings is not None:
            _notify_new_browser_session(
                user, minted_token, clean_client, clean_ip, clean_ua, settings
            )

        from netops.enums import UserRole  # noqa: PLC0415

        effective_role = UserRole.OWNER if principal.role == UserRole.OWNER else user.role
        return ApiPrincipal(
            username=user.username,
            role=effective_role,
            allowed_system=user.allowed_system,
        )


    def list_users(self) -> Sequence[User]:
        return self._session.scalars(select(User).order_by(User.username)).all()

    def get(self, user_id: int) -> User:
        user = self._session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"User {user_id} not found")
        return user

    def create(self, data: UserCreate) -> tuple[User, str]:
        from datetime import timedelta  # noqa: PLC0415

        if data.username in self._reserved:
            raise ConflictError(f"Username {data.username} is used by a configured API token")
        token = generate_token()
        v_code = f"{secrets.randbelow(900000) + 100000}"
        user = User(
            username=data.username,
            role=data.role,
            allowed_system=_norm_system(data.allowed_system),
            expires_at=_calc_expires_at(data.expires_in_minutes),
            verification_code=v_code,
            verification_expires_at=utcnow() + timedelta(minutes=30),
            token_sha256=hash_token(token),
        )
        self._session.add(user)
        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise ConflictError(f"User {data.username} already exists") from exc
        from netops.services.notifier import save_user_token, sync_access_registry  # noqa: PLC0415

        save_user_token(user.username, token)
        sync_access_registry(self._session)
        return user, token

    def create_batch(self, data: UserBatchCreate) -> list[tuple[User, str]]:
        from datetime import timedelta  # noqa: PLC0415

        existing = set(self._session.scalars(select(User.username)).all()) | set(self._reserved)
        created: list[tuple[User, str]] = []
        seq = 1
        allowed_sys = _norm_system(data.allowed_system)
        exp_at = _calc_expires_at(data.expires_in_minutes)
        v_exp = utcnow() + timedelta(minutes=30)
        from netops.services.notifier import save_user_token, sync_access_registry  # noqa: PLC0415

        for _ in range(data.count):
            while True:
                candidate = f"{data.prefix}-{seq}"
                seq += 1
                if len(candidate) > 60:
                    candidate = f"{data.prefix[:48]}-{secrets.token_hex(3)}"
                if candidate not in existing:
                    existing.add(candidate)
                    break
            token = generate_token()
            v_code = f"{secrets.randbelow(900000) + 100000}"
            user = User(
                username=candidate,
                role=data.role,
                allowed_system=allowed_sys,
                expires_at=exp_at,
                verification_code=v_code,
                verification_expires_at=v_exp,
                token_sha256=hash_token(token),
            )
            self._session.add(user)
            created.append((user, token))
        self._session.commit()
        for u, tok in created:
            save_user_token(u.username, tok)
        sync_access_registry(self._session)
        return created

    def update(self, user_id: int, data: UserUpdate, *, acting_user: str) -> User:
        user = self._get_other(user_id, acting_user)
        updates = data.model_dump(exclude_unset=True)
        if "allowed_system" in updates:
            updates["allowed_system"] = _norm_system(updates["allowed_system"])
        if "expires_in_minutes" in updates:
            mins = updates.pop("expires_in_minutes")
            user.expires_at = _calc_expires_at(mins)
        for field, value in updates.items():
            setattr(user, field, value)
        self._session.commit()
        from netops.services.notifier import sync_access_registry  # noqa: PLC0415

        sync_access_registry(self._session)
        return user

    def rotate_token(self, user_id: int) -> tuple[User, str]:
        user = self.get(user_id)
        token = generate_token()
        user.token_sha256 = hash_token(token)
        user.bound_client_id = None
        user.bound_ip = None
        user.bound_user_agent = None
        user.bound_at = None
        user.last_seen_at = None
        self._session.commit()
        from netops.services.notifier import (  # noqa: PLC0415
            record_security_event,
            save_user_token,
            sync_access_registry,
        )

        save_user_token(user.username, token)
        record_security_event(
            "TOKEN_ROTATED",
            f"Перевыпущен токен и сброшена привязка для {user.username}",
            username=user.username,
            severity="info",
        )
        sync_access_registry(self._session)
        return user, token

    def unbind_device(self, user_id: int) -> User:
        user = self.get(user_id)
        old_client = user.bound_client_id
        user.bound_client_id = None
        user.bound_ip = None
        user.bound_user_agent = None
        user.bound_at = None
        user.last_seen_at = None
        self._session.commit()
        from netops.services.notifier import record_security_event, sync_access_registry  # noqa: PLC0415

        record_security_event(
            "DEVICE_UNBOUND",
            f"Сброшена привязка устройства ({old_client or 'none'}) для участника {user.username}",
            username=user.username,
            severity="info",
        )
        sync_access_registry(self._session)
        return user

    def generate_verification_code(self, user_id: int) -> User:
        from datetime import timedelta  # noqa: PLC0415
        from netops.services.notifier import sync_access_registry  # noqa: PLC0415

        user = self.get(user_id)
        code = f"{secrets.randbelow(900000) + 100000}"
        user.verification_code = code
        user.verification_expires_at = utcnow() + timedelta(minutes=15)
        self._session.commit()
        sync_access_registry(self._session)
        return user

    def delete(self, user_id: int, *, acting_user: str) -> None:
        self._session.delete(self._get_other(user_id, acting_user))
        self._session.commit()
        from netops.services.notifier import sync_access_registry  # noqa: PLC0415

        sync_access_registry(self._session)

    # Админ не может понизить, заблокировать или удалить сам себя.
    def _get_other(self, user_id: int, acting_user: str) -> User:
        user = self.get(user_id)
        if user.username == acting_user:
            raise ConflictError("You cannot change the role, status or existence of your account")
        return user

