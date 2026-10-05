"""Добавление management_mode, proxy_jump и hardware_specs в devices.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.add_column(
            sa.Column(
                "management_mode",
                sa.String(32),
                nullable=False,
                server_default="MONITORING_ONLY",
            )
        )
        batch_op.add_column(
            sa.Column(
                "proxy_jump",
                sa.String(255),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "hardware_specs",
                sa.String(2048),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_column("hardware_specs")
        batch_op.drop_column("proxy_jump")
        batch_op.drop_column("management_mode")
