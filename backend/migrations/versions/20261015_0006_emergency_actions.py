"""Журнал ручных вмешательств.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "emergency_actions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("device", sa.String(length=253), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("output_preview", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_emergency_actions")),
    )
    op.create_index(op.f("ix_emergency_actions_created_at"), "emergency_actions", ["created_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_emergency_actions_created_at"), table_name="emergency_actions")
    op.drop_table("emergency_actions")
