"""Замеры метрик платформы и стенда.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "metric_samples",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "labels", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False
        ),
        sa.Column("value", sa.Double(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_metric_samples")),
    )
    op.create_index("ix_metric_samples_name_collected", "metric_samples", ["name", "collected_at"])
    op.create_index(op.f("ix_metric_samples_collected_at"), "metric_samples", ["collected_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_metric_samples_collected_at"), table_name="metric_samples")
    op.drop_index("ix_metric_samples_name_collected", table_name="metric_samples")
    op.drop_table("metric_samples")
