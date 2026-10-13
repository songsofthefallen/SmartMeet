"""Persist route refresh attempts and per-user refresh locks."""

from alembic import op
import sqlalchemy as sa

revision = "20261013_0007"
down_revision = "20261013_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "route_refresh_user_locks",
        sa.Column("clerk_user_id", sa.String(length=255), primary_key=True),
    )
    op.create_table(
        "route_refresh_attempts",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("schedule_id", sa.Integer(), sa.ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
    )
    op.create_index("ix_route_refresh_user_attempted", "route_refresh_attempts", ["clerk_user_id", "attempted_at"])
    op.create_index("ix_route_refresh_schedule_attempted", "route_refresh_attempts", ["schedule_id", "attempted_at"])


def downgrade() -> None:
    op.drop_index("ix_route_refresh_schedule_attempted", table_name="route_refresh_attempts")
    op.drop_index("ix_route_refresh_user_attempted", table_name="route_refresh_attempts")
    op.drop_table("route_refresh_attempts")
    op.drop_table("route_refresh_user_locks")
