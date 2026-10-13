"""Persist explicit schedule origin and routing estimate metadata."""

from alembic import op
import sqlalchemy as sa

revision = "20261013_0005"
down_revision = "20261013_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("origin_location", sa.JSON(), nullable=True))
    op.add_column("schedules", sa.Column("travel_estimate", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "travel_estimate")
    op.drop_column("schedules", "origin_location")
