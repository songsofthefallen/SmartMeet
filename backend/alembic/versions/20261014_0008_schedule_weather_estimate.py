"""Store compact weather assessment with each schedule."""

from alembic import op
import sqlalchemy as sa

revision = "20261014_0008"
down_revision = "20261013_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("weather_estimate", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "weather_estimate")
