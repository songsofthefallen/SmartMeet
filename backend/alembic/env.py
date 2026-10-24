"""Alembic environment, wired to the application's database URL and metadata."""

from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

import database
from models import Base, PushSubscription, RouteRefreshAttempt, RouteRefreshUserLock, SavedPlace, Schedule  # noqa: F401 - register model metadata


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Load backend/.env for the migration CLI; DATABASE_URL remains the single source.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
config.set_main_option("sqlalchemy.url", database._database_url().replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = database._database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
