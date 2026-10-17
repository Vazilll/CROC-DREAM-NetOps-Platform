from __future__ import annotations

import secrets
from collections.abc import Collection, Sequence
from datetime import UTC

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
    from datetime import timedelta

    if minutes is None or minutes <= 0:
        return None
    return utcnow() + timedelta(minutes=minutes)


def _is_expired(exp) -> bool:
    if exp is None:
        return False

    now = utcnow()
    exp_aware = exp.replace(tzinfo=UTC) if exp.tzinfo is None else exp
    now_aware = now.replace(tzinfo=UTC) if now.tzinfo is None else now
    return now_aware >= exp_aware


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
        allow_rebind: bool = False,
    ) -> ApiPrincipal | None:
        cleaned_token = token.strip()
        if cleaned_token.lower().startswith("/verify "):
            cleaned_token = cleaned_token[8:].strip()

        if cleaned_token.startswith("inv_"):
            from netops.services.sessions import consume_invite_code

            inv_username = consume_invite_code(cleaned_token)
            user = (
                self._session.scalar(select(User).where(User.username == inv_username))
                if inv_username
                else None
            )
        elif cleaned_token.isdigit() and len(cleaned_token) == 6:
            candidate = self._session.scalar(
                select(User).where(User.verification_code == cleaned_token)
            )
            user = (
                candidate
                if candidate is not None and not _is_expired(candidate.verification_expires_at)
                else None
            )
        else:
            user = self._session.scalar(
                select(User).where(User.token_sha256 == hash_token(cleaned_token))
            )
        if user is None or not user.is_active:
            return None

        now = utcnow()
        clean_client = (client_id or "").strip()[:128] or None
        clean_ip = (client_ip or "").strip()[:64] or None
        clean_ua = (user_agent or "").strip()[:255] or None

        if _is_expired(user.expires_at):
            raise DeviceBoundConflictError(
                f"Срок действия временного токена ({user.username}) истёк. Запросите продление у администратора."
            )

        from netops.services.state import get_state_manager

        get_state_manager().set(f"auth:last_seen:{user.username}", now.isoformat(), ex=3600)
        prev_seen = (
            user.last_seen_at.replace(tzinfo=UTC)
            if user.last_seen_at is not None and user.last_seen_at.tzinfo is None
            else user.last_seen_at
        )
        should_flush_seen = prev_seen is None or (now - prev_seen).total_seconds() >= 60.0

        if user.bound_client_id is not None:
            if clean_client != user.bound_client_id:
                if not allow_rebind or user.username == "owner":
                    raise DeviceBoundConflictError(
                        f"Ссылка доступа ({user.username}) уже привязана к другому устройству ({user.bound_client_id})."
                    )
                user.bound_client_id = clean_client
                should_flush_seen = True
            ip_changed = bool(clean_ip and clean_ip != user.bound_ip)
            ua_changed = bool(clean_ua and clean_ua != user.bound_user_agent)
            if should_flush_seen or ip_changed or ua_changed:
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
            if (
                existing_by_client is not None
                and existing_by_client.id != user.id
                and existing_by_client.username != "owner"
            ):
                existing_by_client.bound_client_id = None
                self._session.flush()
            if existing_by_client is None or existing_by_client.username != "owner" or user.username == "owner":
                user.bound_client_id = clean_client
            user.bound_ip = clean_ip
            user.bound_user_agent = clean_ua
            user.bound_at = now
            user.last_seen_at = now
            self._session.commit()
        elif should_flush_seen:
            user.last_seen_at = now
            self._session.commit()

        return ApiPrincipal(
            username=user.username,
            role=user.role,
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
        from datetime import timedelta

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
        from netops.services.notifier import save_user_token

        save_user_token(user.username, token)
        return user, token

    def create_batch(self, data: UserBatchCreate) -> list[tuple[User, str]]:
        from datetime import timedelta

        existing = set(self._session.scalars(select(User.username)).all()) | set(self._reserved)
        created: list[tuple[User, str]] = []
        seq = 1
        allowed_sys = _norm_system(data.allowed_system)
        exp_at = _calc_expires_at(data.expires_in_minutes)
        v_exp = utcnow() + timedelta(minutes=30)
        from netops.services.notifier import save_user_token

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
        from netops.services.notifier import save_user_token

        save_user_token(user.username, token)
        return user, token

    def unbind_device(self, user_id: int) -> User:
        user = self.get(user_id)
        user.bound_client_id = None
        user.bound_ip = None
        user.bound_user_agent = None
        user.bound_at = None
        user.last_seen_at = None
        self._session.commit()
        return user

    def generate_verification_code(self, user_id: int) -> User:
        from datetime import timedelta

        user = self.get(user_id)
        code = f"{secrets.randbelow(900000) + 100000}"
        user.verification_code = code
        user.verification_expires_at = utcnow() + timedelta(minutes=15)
        self._session.commit()
        return user

    def delete(self, user_id: int, *, acting_user: str) -> None:
        self._session.delete(self._get_other(user_id, acting_user))
        self._session.commit()

    # Админ не может понизить, заблокировать или удалить сам себя.
    def _get_other(self, user_id: int, acting_user: str) -> User:
        user = self.get(user_id)
        if user.username == acting_user:
            raise ConflictError("You cannot change the role, status or existence of your account")
        return user

