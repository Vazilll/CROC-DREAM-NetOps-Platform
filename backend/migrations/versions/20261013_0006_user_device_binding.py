"""Привязка персонального токена к устройству (bound_client_id).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE platform ADD VALUE IF NOT EXISTS 'eltex_mes'")
            op.execute("ALTER TYPE platform ADD VALUE IF NOT EXISTS 'yadro_kornfe'")
            op.execute("ALTER TYPE jobtype ADD VALUE IF NOT EXISTS 'CONSOLIDATION'")
            op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'auditor'")
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("allowed_system", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("bound_client_id", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("bound_ip", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("bound_user_agent", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("bound_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("telegram_chat_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("telegram_username", sa.String(length=64), nullable=True))
        batch_op.add_column(
            sa.Column("telegram_verified_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(sa.Column("verification_code", sa.String(length=32), nullable=True))
        batch_op.add_column(
            sa.Column("verification_expires_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("verification_expires_at")
        batch_op.drop_column("verification_code")
        batch_op.drop_column("telegram_verified_at")
        batch_op.drop_column("telegram_username")
        batch_op.drop_column("telegram_chat_id")
        batch_op.drop_column("expires_at")
        batch_op.drop_column("last_seen_at")
        batch_op.drop_column("bound_at")
        batch_op.drop_column("bound_user_agent")
        batch_op.drop_column("bound_ip")
        batch_op.drop_column("bound_client_id")
        batch_op.drop_column("allowed_system")

