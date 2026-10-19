"""Add persistent reminder queue entries."""

from alembic import op
import sqlalchemy as sa


revision = "20261019_0010"
down_revision = "20261016_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reminders",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("reminder_type", sa.String(length=16), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="ck_reminders_attempt_nonnegative"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'cancelled', 'failed')", name="reminderstatus"),
        sa.CheckConstraint("reminder_type IN ('wake', 'departure')", name="remindertype"),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("schedule_id", "reminder_type", "scheduled_for", name="uq_reminders_schedule_type_time"),
    )
    op.create_index("ix_reminders_clerk_user_id", "reminders", ["clerk_user_id"], unique=False)
    op.create_index("ix_reminders_status_scheduled_for", "reminders", ["status", "scheduled_for"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_reminders_status_scheduled_for", table_name="reminders")
    op.drop_index("ix_reminders_clerk_user_id", table_name="reminders")
    op.drop_table("reminders")
