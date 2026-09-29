"""Declarative base and portable column types."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase

# Deterministic constraint names keep Alembic migrations reproducible.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

JSONType = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class TZDateTime(sa.TypeDecorator[datetime]):
    """Timezone-aware UTC datetime on every backend.

    PostgreSQL keeps the offset natively; SQLite (used in tests) drops it, so
    values read back are re-labelled as UTC.
    """

    impl = sa.DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetimes are not allowed; use timezone-aware UTC values")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


def enum_type(enum_cls: type[Enum]) -> sa.Enum:
    """Store enums as their *values* in a VARCHAR column.

    Non-native enums avoid ``ALTER TYPE`` migrations when a new platform or
    status is added.
    """
    return sa.Enum(
        enum_cls,
        native_enum=False,
        length=32,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )


class Base(DeclarativeBase):
    metadata = sa.MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map: dict[Any, Any] = {  # noqa: RUF012 - SQLAlchemy API
        datetime: TZDateTime(),
        list[str]: JSONType,
    }
