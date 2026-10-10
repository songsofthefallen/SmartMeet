from datetime import datetime, timezone
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models import Base, Schedule, ScheduleStatus, TimeIntent
from schemas import ScheduleCreate, ScheduleResponse, ScheduleUpdate


def valid_schedule_payload() -> dict[str, object]:
    return {
        "title": "Morning class",
        "time_intent": "arrival",
        "target_datetime": "2026-10-11T07:00:00+08:00",
        "timezone": "Asia/Manila",
        "preparation_duration_minutes": 30,
    }


def test_schedule_model_persists_fields_and_defaults_in_sqlite() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            schedule = Schedule(
                clerk_user_id="user_123",
                **ScheduleCreate.model_validate(valid_schedule_payload()).model_dump(),
            )
            session.add(schedule)
            session.commit()
            session.refresh(schedule)

            assert schedule.id is not None
            assert schedule.status is ScheduleStatus.ACTIVE
            assert schedule.created_at is not None
            assert schedule.updated_at is not None
            assert schedule.clerk_user_id == "user_123"
    finally:
        engine.dispose()


def test_create_schema_validates_enums_timezone_and_durations() -> None:
    parsed = ScheduleCreate.model_validate(valid_schedule_payload())
    assert parsed.time_intent is TimeIntent.ARRIVAL
    assert parsed.target_datetime.utcoffset() is not None

    for changes in (
        {"time_intent": "unknown"},
        {"timezone": "Mars/Olympus"},
        {"preparation_duration_minutes": -1},
        {"target_datetime": "2026-10-11T07:00:00"},
        {"extra_field": "ignored?"},
    ):
        with pytest.raises(ValidationError):
            ScheduleCreate.model_validate(valid_schedule_payload() | changes)


def test_update_schema_is_partial_and_rejects_null_required_fields() -> None:
    update = ScheduleUpdate.model_validate({"title": "Updated title"})
    assert update.model_dump(exclude_unset=True) == {"title": "Updated title"}

    with pytest.raises(ValidationError):
        ScheduleUpdate.model_validate({"title": None})
    with pytest.raises(ValidationError):
        ScheduleUpdate.model_validate({"preparation_duration_minutes": -2})

    assert ScheduleUpdate.model_validate({"description": None}).description is None
    assert ScheduleUpdate.model_validate({"travel_duration_minutes": None}).travel_duration_minutes is None


def test_response_schema_reads_orm_attributes() -> None:
    schedule = Schedule(
        id=7,
        clerk_user_id="user_123",
        title="Morning class",
        description=None,
        time_intent=TimeIntent.ARRIVAL,
        target_datetime=datetime(2026, 10, 11, 7, tzinfo=timezone.utc),
        timezone="Asia/Manila",
        preparation_duration_minutes=30,
        travel_duration_minutes=None,
        calculated_departure_time=None,
        calculated_wake_time=None,
        status=ScheduleStatus.ACTIVE,
        created_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
    )
    response = ScheduleResponse.model_validate(schedule)
    assert response.id == 7
    assert response.status is ScheduleStatus.ACTIVE


def test_schedule_model_constraints_and_indexes_are_declared() -> None:
    table = Base.metadata.tables["schedules"]
    assert {index.name for index in table.indexes} == {
        "ix_schedules_clerk_user_id",
        "ix_schedules_user_status",
    }
    assert {
        "ck_schedules_preparation_nonnegative",
        "ck_schedules_travel_nonnegative",
        "timeintent",
        "schedulestatus",
    }.issubset({constraint.name for constraint in table.constraints})
