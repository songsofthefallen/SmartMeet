"""Add encrypted, user-owned Web Push subscriptions."""

from alembic import op
import sqlalchemy as sa


revision = "20261019_0012"
down_revision = "20261019_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("clerk_user_id", sa.String(length=255), nullable=False),
        sa.Column("endpoint_hash", sa.String(length=64), nullable=False),
        sa.Column("encrypted_subscription", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_hash", name="uq_push_subscriptions_endpoint_hash"),
    )
    op.create_index("ix_push_subscriptions_clerk_user_id", "push_subscriptions", ["clerk_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_clerk_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
