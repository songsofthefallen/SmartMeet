"""Persist deterministic estimated arrival times."""

from alembic import op
import sqlalchemy as sa

revision = "20261013_0006"
down_revision = "20261013_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("calculated_arrival_time", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "calculated_arrival_time")
