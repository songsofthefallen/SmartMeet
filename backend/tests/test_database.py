from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import database


@pytest.fixture(autouse=True)
def clear_database_caches() -> Generator[None, None, None]:
    database.get_session_factory.cache_clear()
    database.get_engine.cache_clear()
    yield
    database.get_session_factory.cache_clear()
    database.get_engine.cache_clear()


@pytest.mark.parametrize("value", [None, "", "not-a-url", "sqlite:///wrong.db"])
def test_engine_rejects_missing_or_invalid_configuration_without_echoing_secrets(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    if value is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", value)

    with pytest.raises(database.DatabaseConfigurationError) as error:
        database.get_engine()

    assert "DATABASE_URL" in str(error.value)
    assert "replace_me" not in str(error.value)


def test_engine_and_session_factory_are_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "mysql+pymysql://db_user:secret@127.0.0.1:3306/deadline_notifier",
    )

    assert database.get_engine() is database.get_engine()
    assert database.get_session_factory() is database.get_session_factory()


def test_database_connectivity_check_uses_select_one() -> None:
    engine = create_engine("sqlite:///:memory:")
    try:
        assert database.check_database_connection(engine) is True
    finally:
        engine.dispose()


def test_database_connectivity_check_fails_safely_without_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert database.check_database_connection() is False


def test_get_db_yields_and_closes_session(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine("sqlite:///:memory:")

    class TrackingSession(Session):
        was_closed = False

        def close(self) -> None:
            self.was_closed = True
            super().close()

    factory = sessionmaker(bind=engine, class_=TrackingSession)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)
    dependency = database.get_db()
    session = next(dependency)

    assert isinstance(session, Session)
    with pytest.raises(StopIteration):
        next(dependency)
    assert session.was_closed
    engine.dispose()


def test_get_db_reports_missing_configuration_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        database,
        "get_session_factory",
        lambda: (_ for _ in ()).throw(database.DatabaseConfigurationError("private details")),
    )

    with pytest.raises(HTTPException) as error:
        next(database.get_db())

    assert error.value.status_code == 503
    assert error.value.detail == "Database is not configured"
    assert "private details" not in error.value.detail
