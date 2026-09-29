from __future__ import annotations

import hashlib
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from netops.db import Base, enum_type, utcnow
from netops.enums import SnapshotKind


def sha256_hex(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


class ConfigSnapshot(Base):
    """A normalized configuration captured from a device or rendered from intent."""

    __tablename__ = "config_snapshots"
    __table_args__ = (
        Index("ix_config_snapshots_device_kind_created", "device_id", "kind", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[SnapshotKind] = mapped_column(enum_type(SnapshotKind))
    content: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    @classmethod
    def capture(
        cls,
        *,
        device_id: int,
        kind: SnapshotKind,
        content: str,
        job_id: uuid.UUID | None = None,
    ) -> ConfigSnapshot:
        return cls(
            device_id=device_id,
            job_id=job_id,
            kind=kind,
            content=content,
            sha256=sha256_hex(content),
        )
