from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from netops.db import Base, utcnow


# Журнал ручных вмешательств: кто, когда, на каком устройстве и с каким результатом.
# Пишется в базу, а не в файл: иначе запись теряется вместе с контейнером.
class EmergencyAction(Base):
    __tablename__ = "emergency_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    user: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    device: Mapped[str] = mapped_column(String(253))
    payload: Mapped[str] = mapped_column(Text)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    output_preview: Mapped[str] = mapped_column(Text, default="")
