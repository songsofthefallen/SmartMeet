"""Store short-lived authenticated extraction drafts."""

from alembic import op
import sqlalchemy as sa


revision = "20261108_0015"
down_revision = "20261024_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "extraction_drafts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("extraction", sa.JSON(), nullable=True),
        sa.Column("clarification_field", sa.String(length=64), nullable=True),
        sa.Column("origin_location", sa.JSON(), nullable=True),
        sa.Column("destination_location", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_extraction_drafts_user_expires", "extraction_drafts", ["clerk_user_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_extraction_drafts_user_expires", table_name="extraction_drafts")
    op.drop_table("extraction_drafts")
