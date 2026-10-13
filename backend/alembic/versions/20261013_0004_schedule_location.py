"""Persist selected geocoding results on schedules."""

from alembic import op
import sqlalchemy as sa


revision = "20261013_0004"
down_revision = "20261012_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("location", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "location")
