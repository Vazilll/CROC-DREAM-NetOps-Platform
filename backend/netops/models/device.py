from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from netops.db import Base, enum_type, utcnow
from netops.enums import DeviceRole, DeviceStatus, Platform


class Device(Base):
    """A managed network device (cached copy of the Git inventory)."""

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("management_ip", "management_port"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    hostname: Mapped[str] = mapped_column(String(253), unique=True)
    management_ip: Mapped[str] = mapped_column(String(45))
    management_port: Mapped[int] = mapped_column(default=22, server_default="22")
    platform: Mapped[Platform] = mapped_column(enum_type(Platform), index=True)
    role: Mapped[DeviceRole] = mapped_column(enum_type(DeviceRole), index=True)
    auth_profile: Mapped[str] = mapped_column(String(64))
    status: Mapped[DeviceStatus] = mapped_column(
        enum_type(DeviceStatus),
        default=DeviceStatus.UNKNOWN,
        server_default=DeviceStatus.UNKNOWN.value,
        index=True,
    )
    last_checked_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    def __repr__(self) -> str:
        return f"<Device id={self.id} hostname={self.hostname!r} status={self.status}>"
