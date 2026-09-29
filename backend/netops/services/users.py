"""User accounts for RBAC (spec 2.7: the admin manages accounts)."""

from __future__ import annotations

from collections.abc import Collection, Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from netops.errors import ConflictError, NotFoundError
from netops.models import User
from netops.schemas.users import UserCreate, UserUpdate
from netops.security import generate_token, hash_token
from netops.settings import ApiPrincipal


class UserService:
    def __init__(self, session: Session, *, reserved_usernames: Collection[str] = ()) -> None:
        """``reserved_usernames`` belong to bootstrap tokens from the settings."""
        self._session = session
        self._reserved = frozenset(reserved_usernames)

    def authenticate(self, token: str) -> ApiPrincipal | None:
        user = self._session.scalar(
            select(User).where(User.token_sha256 == hash_token(token), User.is_active)
        )
        return ApiPrincipal(username=user.username, role=user.role) if user is not None else None

    def list_users(self) -> Sequence[User]:
        return self._session.scalars(select(User).order_by(User.username)).all()

    def get(self, user_id: int) -> User:
        user = self._session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"User {user_id} not found")
        return user

    def create(self, data: UserCreate) -> tuple[User, str]:
        """Create a user and return it with its token, which is never stored in clear."""
        if data.username in self._reserved:
            raise ConflictError(f"Username {data.username} is used by a configured API token")
        token = generate_token()
        user = User(username=data.username, role=data.role, token_sha256=hash_token(token))
        self._session.add(user)
        try:
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise ConflictError(f"User {data.username} already exists") from exc
        return user, token

    def update(self, user_id: int, data: UserUpdate, *, acting_user: str) -> User:
        user = self._get_other(user_id, acting_user)
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(user, field, value)
        self._session.commit()
        return user

    def rotate_token(self, user_id: int) -> tuple[User, str]:
        user = self.get(user_id)
        token = generate_token()
        user.token_sha256 = hash_token(token)
        self._session.commit()
        return user, token

    def delete(self, user_id: int, *, acting_user: str) -> None:
        self._session.delete(self._get_other(user_id, acting_user))
        self._session.commit()

    def _get_other(self, user_id: int, acting_user: str) -> User:
        """Admins cannot lock themselves out by demoting, disabling or deleting their account."""
        user = self.get(user_id)
        if user.username == acting_user:
            raise ConflictError("You cannot change the role, status or existence of your account")
        return user
