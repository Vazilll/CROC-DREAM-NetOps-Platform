from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from netops.db import Base, utcnow


# Один замер метрики. Все замеры одного сбора пишутся с одним collected_at, поэтому
# «текущие значения» — это замеры с максимальным collected_at.
class MetricSample(Base):
    __tablename__ = "metric_samples"
    __table_args__ = (Index("ix_metric_samples_name_collected", "name", "collected_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    labels: Mapped[dict[str, Any]] = mapped_column(default=dict)
    value: Mapped[float]
    collected_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
