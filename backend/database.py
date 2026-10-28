"""SQLAlchemy engine and request-scoped session utilities."""

import os
from collections.abc import Generator
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.engine import make_url
from dotenv import load_dotenv

load_dotenv()


class DatabaseConfigurationError(RuntimeError):
    """Raised when database configuration is missing or unsupported."""


def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise DatabaseConfigurationError("DATABASE_URL is not configured")
    try:
        url = make_url(value)
    except (ArgumentError, TypeError, ValueError) as exc:
        raise DatabaseConfigurationError("DATABASE_URL is invalid") from exc
    if url.drivername != "mysql+pymysql":
        raise DatabaseConfigurationError("DATABASE_URL must use mysql+pymysql")
    if not all((url.username, url.host, url.database)):
        raise DatabaseConfigurationError(
            "DATABASE_URL must include a username, host, and database"
        )
    return value



@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Return the process-wide engine, creating its pool on first use."""
    url = make_url(_database_url())

    # Remove the unsupported URL option before passing the URL to PyMySQL.
    query = dict(url.query)
    ssl_mode = query.pop("ssl-mode", None)
    url = url.set(query=query)

    connect_args = {}
    if ssl_mode and ssl_mode.upper() == "REQUIRED":
        connect_args["ssl"] = {"check_hostname": True}

    return create_engine(
        url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )



@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    """Return the reusable factory for independent request sessions."""
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield one session per request and always close it afterward."""
    try:
        session = get_session_factory()()
    except DatabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Database is not configured") from exc
    try:
        yield session
    finally:
        session.close()


def check_database_connection(engine: Engine | None = None) -> bool:
    """Check connectivity without returning driver errors or credentials."""
    try:
        with (engine or get_engine()).connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except (DatabaseConfigurationError, SQLAlchemyError):
        return False

