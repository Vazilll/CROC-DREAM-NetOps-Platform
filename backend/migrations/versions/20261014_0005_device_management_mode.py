"""Режим управления устройством и данные проверки.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODES = ("MONITORING_ONLY", "MANAGED")


def upgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.add_column(
            sa.Column(
                "management_mode",
                sa.Enum(*MODES, name="managementmode", native_enum=False, length=32),
                nullable=False,
                server_default="MONITORING_ONLY",
            )
        )
        batch_op.add_column(sa.Column("proxy_jump", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("hardware_specs", sa.String(length=2048), nullable=True))
    # Устройства, которые уже были в инвентаре, остаются управляемыми.
    op.execute("UPDATE devices SET management_mode = 'MANAGED'")


def downgrade() -> None:
    with op.batch_alter_table("devices") as batch_op:
        batch_op.drop_column("hardware_specs")
        batch_op.drop_column("proxy_jump")
        batch_op.drop_column("management_mode")
