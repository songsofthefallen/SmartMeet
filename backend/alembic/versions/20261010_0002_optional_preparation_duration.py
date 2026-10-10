"""Make preparation duration optional.

Revision ID: 20261010_0002
Revises: 20261010_0001
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261010_0002"
down_revision: Union[str, None] = "20261010_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_schedules_preparation_nonnegative", "schedules", type_="check")
    op.alter_column(
        "schedules",
        "preparation_duration_minutes",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_schedules_preparation_nonnegative",
        "schedules",
        "preparation_duration_minutes IS NULL OR preparation_duration_minutes >= 0",
    )


def downgrade() -> None:
    op.execute("UPDATE schedules SET preparation_duration_minutes = 0 WHERE preparation_duration_minutes IS NULL")
    op.drop_constraint("ck_schedules_preparation_nonnegative", "schedules", type_="check")
    op.alter_column(
        "schedules",
        "preparation_duration_minutes",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_check_constraint(
        "ck_schedules_preparation_nonnegative",
        "schedules",
        "preparation_duration_minutes >= 0",
    )
