"""Add per-user schedule creation idempotency keys."""

from alembic import op
import sqlalchemy as sa


revision = "20261012_0003"
down_revision = "20261010_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("idempotency_key", sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        "uq_schedules_user_idempotency", "schedules", ["clerk_user_id", "idempotency_key"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_schedules_user_idempotency", "schedules", type_="unique")
    op.drop_column("schedules", "idempotency_key")
