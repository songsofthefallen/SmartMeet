"""Persist pair-scoped definitive route availability."""

from alembic import op
import sqlalchemy as sa


revision = "20261023_0013"
down_revision = "20261019_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("route_status", sa.String(length=32), nullable=True))
    op.add_column("schedules", sa.Column("route_location_signature", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "route_location_signature")
    op.drop_column("schedules", "route_status")
