"""Add lease and retry metadata for reminder workers."""

from alembic import op
import sqlalchemy as sa


revision = "20261019_0011"
down_revision = "20261019_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reminders", sa.Column("claim_token", sa.String(length=36), nullable=True))
    op.add_column("reminders", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reminders", sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("reminders", "next_attempt_at")
    op.drop_column("reminders", "lease_expires_at")
    op.drop_column("reminders", "claim_token")
