import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION = Path(__file__).parents[1] / "alembic" / "versions" / "20261016_0009_schedule_names.py"
spec = importlib.util.spec_from_file_location("schedule_name_migration", MIGRATION)
assert spec and spec.loader
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def run_upgrade(engine: sa.Engine) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context) as operations:
            migration.op = operations
            migration.upgrade()


def base_database() -> sa.Engine:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(sa.text(
            "CREATE TABLE schedules (id INTEGER PRIMARY KEY, clerk_user_id VARCHAR(255) NOT NULL, title VARCHAR(200) NOT NULL)"
        ))
    return engine


def test_migration_preserves_titles_seeds_names_and_adds_unique_key() -> None:
    engine = base_database()
    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO schedules VALUES (1, 'user_a', 'Schedule 4')"))
        connection.execute(sa.text("INSERT INTO schedules VALUES (2, 'user_b', 'Meetup')"))
    run_upgrade(engine)
    with engine.connect() as connection:
        assert connection.execute(sa.text("SELECT title, normalized_title FROM schedules ORDER BY id")).all() == [
            ("Schedule 4", "schedule 4"), ("Meetup", "meetup")
        ]
        assert connection.execute(sa.text("SELECT clerk_user_id, next_number FROM schedule_name_counters")).all() == [
            ("user_a", 5)
        ]
        with pytest.raises(sa.exc.IntegrityError):
            with engine.begin() as write:
                write.execute(sa.text(
                    "INSERT INTO schedules (id, clerk_user_id, title, normalized_title) VALUES (3, 'user_a', 'schedule 4', 'schedule 4')"
                ))
    engine.dispose()


def test_migration_reports_existing_duplicate_names_without_changing_rows() -> None:
    engine = base_database()
    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO schedules VALUES (1, 'user_a', 'Project')"))
        connection.execute(sa.text("INSERT INTO schedules VALUES (2, 'user_a', ' project  ')"))
    with pytest.raises(RuntimeError, match="schedules 1 and 2"):
        run_upgrade(engine)
    with engine.connect() as connection:
        assert "normalized_title" not in sa.inspect(connection).get_columns("schedules")
        assert connection.execute(sa.text("SELECT COUNT(*) FROM schedules")).scalar_one() == 2
    engine.dispose()
