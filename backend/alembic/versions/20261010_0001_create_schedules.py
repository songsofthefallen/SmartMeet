"""Create schedules table.

Revision ID: 20261010_0001
Revises:
Create Date: 2026-10-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261010_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "time_intent",
            sa.Enum("arrival", "departure", name="timeintent", native_enum=False, create_constraint=False, length=10),
            nullable=False,
        ),
        sa.Column("target_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("preparation_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("travel_duration_minutes", sa.Integer(), nullable=True),
        sa.Column("calculated_departure_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calculated_wake_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "cancelled", "completed", name="schedulestatus", native_enum=False, create_constraint=False, length=10),
            server_default="active",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("preparation_duration_minutes >= 0", name="ck_schedules_preparation_nonnegative"),
        sa.CheckConstraint(
            "travel_duration_minutes IS NULL OR travel_duration_minutes >= 0",
            name="ck_schedules_travel_nonnegative",
        ),
        sa.CheckConstraint("time_intent IN ('arrival', 'departure')", name="timeintent"),
        sa.CheckConstraint("status IN ('active', 'cancelled', 'completed')", name="schedulestatus"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedules_clerk_user_id", "schedules", ["clerk_user_id"], unique=False)
    op.create_index("ix_schedules_user_status", "schedules", ["clerk_user_id", "status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_schedules_user_status", table_name="schedules")
    op.drop_index("ix_schedules_clerk_user_id", table_name="schedules")
    op.drop_table("schedules")
