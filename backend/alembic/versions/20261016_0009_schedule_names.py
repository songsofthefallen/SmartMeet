"""Add per-user schedule names, normalized uniqueness, and name counters.

Existing duplicate names are reported with their schedule IDs and owner IDs;
the migration leaves all existing titles untouched and must be rerun after the
owner resolves those conflicts.
"""

import re

from alembic import op
import sqlalchemy as sa


revision = "20261016_0009"
down_revision = "20261014_0008"
branch_labels = None
depends_on = None


def _normalize(title: str) -> str:
    return title.strip().casefold()


def upgrade() -> None:
    bind = op.get_bind()
    existing = bind.execute(sa.text("SELECT id, clerk_user_id, title FROM schedules ORDER BY id")).mappings().all()
    seen: dict[tuple[str, str], int] = {}
    conflicts: list[str] = []
    highest: dict[str, int] = {}
    for row in existing:
        normalized = _normalize(row["title"])
        if len(normalized) > 200:
            raise RuntimeError(f"Schedule {row['id']} title is too long after normalization; shorten it before migration")
        key = (row["clerk_user_id"], normalized)
        if key in seen:
            conflicts.append(f"user {row['clerk_user_id']}: schedules {seen[key]} and {row['id']} ({row['title']!r})")
        else:
            seen[key] = row["id"]
        match = re.fullmatch(r"schedule ([1-9][0-9]*)", row["title"].strip(), re.IGNORECASE)
        if match:
            highest[row["clerk_user_id"]] = max(highest.get(row["clerk_user_id"], 0), int(match.group(1)))
    if conflicts:
        raise RuntimeError(
            "Cannot enforce unique schedule names until these existing duplicate names are resolved: "
            + "; ".join(conflicts)
        )

    with op.batch_alter_table("schedules") as batch:
        batch.add_column(sa.Column("normalized_title", sa.String(length=200), nullable=True))
    for row in existing:
        normalized = _normalize(row["title"])
        bind.execute(
            sa.text("UPDATE schedules SET normalized_title = :normalized WHERE id = :id"),
            {"normalized": normalized, "id": row["id"]},
        )
    with op.batch_alter_table("schedules") as batch:
        batch.alter_column("normalized_title", existing_type=sa.String(length=200), nullable=False)
        batch.create_unique_constraint(
            "uq_schedules_user_normalized_title", ["clerk_user_id", "normalized_title"]
        )
    op.create_table(
        "schedule_name_counters",
        sa.Column("clerk_user_id", sa.String(length=255), primary_key=True, nullable=False),
        sa.Column("next_number", sa.Integer(), nullable=False),
    )
    for user_id, number in highest.items():
        bind.execute(
            sa.text("INSERT INTO schedule_name_counters (clerk_user_id, next_number) VALUES (:user_id, :number)"),
            {"user_id": user_id, "number": number + 1},
        )


def downgrade() -> None:
    op.drop_table("schedule_name_counters")
    with op.batch_alter_table("schedules") as batch:
        batch.drop_constraint("uq_schedules_user_normalized_title", type_="unique")
        batch.drop_column("normalized_title")
