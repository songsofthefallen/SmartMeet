"""Add user-owned confirmed saved places."""

from alembic import op
import sqlalchemy as sa


revision = "20261024_0014"
down_revision = "20261023_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_places",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("alias", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("formatted_address", sa.String(length=500), nullable=True),
        sa.Column("locality", sa.String(length=120), nullable=True),
        sa.Column("region", sa.String(length=120), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("location_source", sa.String(length=32), server_default="tomtom_search", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_saved_places_latitude"),
        sa.CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_saved_places_longitude"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_places_clerk_user_id", "saved_places", ["clerk_user_id"], unique=False)
    op.create_index("ix_saved_places_user_alias", "saved_places", ["clerk_user_id", "alias"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_saved_places_user_alias", table_name="saved_places")
    op.drop_index("ix_saved_places_clerk_user_id", table_name="saved_places")
    op.drop_table("saved_places")
