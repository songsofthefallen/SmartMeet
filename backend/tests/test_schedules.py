from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from models import Base, Schedule, ScheduleStatus, TimeIntent, location_pair_signature
from schemas import ScheduleCreate, ScheduleResponse, ScheduleUpdate, TravelEstimate


def valid_schedule_payload() -> dict[str, object]:
    return {
        "title": "Morning class",
        "time_intent": "arrival",
        "target_datetime": "2026-10-11T07:00:00+08:00",
        "timezone": "Asia/Manila",
        "preparation_duration_minutes": 30,
    }


def traffic_warning_response(timezone_name: str, target: datetime, retrieved_at: datetime) -> ScheduleResponse:
    return ScheduleResponse(
        id=7,
        clerk_user_id="user_123",
        title="Traffic warning test",
        description=None,
        location=None,
        origin_location=None,
        travel_estimate=TravelEstimate(
            duration_seconds=600,
            duration_minutes=10,
            provider="tomtom",
            retrieved_at=retrieved_at,
            traffic_included=True,
        ),
        time_intent=TimeIntent.DEPARTURE,
        target_datetime=target,
        timezone=timezone_name,
        preparation_duration_minutes=None,
        travel_duration_minutes=10,
        calculated_departure_time=target,
        calculated_arrival_time=None,
        calculated_wake_time=None,
        status=ScheduleStatus.ACTIVE,
        created_at=target,
        updated_at=target,
    )


def test_schedule_model_persists_fields_and_defaults_in_sqlite() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            values = ScheduleCreate.model_validate(valid_schedule_payload()).model_dump()
            values.pop("continue_without_route", None)
            values.pop("selected_route_id", None)
            values.pop("route_outcome", None)
            schedule = Schedule(clerk_user_id="user_123", **values)
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


def test_persisted_no_route_result_is_scoped_to_the_exact_selected_pair() -> None:
    origin = {"name": "Tokyo", "latitude": 35.68, "longitude": 139.76}
    destination = {"name": "Manila", "latitude": 14.59, "longitude": 120.98}
    schedule = Schedule(
        clerk_user_id="user_123", title="Trip", normalized_title="trip",
        origin_location=origin, location=destination,
        route_status="no_drivable_route",
        route_location_signature=location_pair_signature(origin, destination),
    )
    assert schedule.route_availability == "no_drivable_route"
    schedule.location = {"name": "Osaka", "latitude": 34.69, "longitude": 135.50}
    assert schedule.route_availability is None


def test_create_schema_validates_enums_timezone_and_durations() -> None:
    parsed = ScheduleCreate.model_validate(valid_schedule_payload())
    assert parsed.time_intent is TimeIntent.ARRIVAL
    assert parsed.target_datetime == datetime(2026, 10, 10, 23, tzinfo=timezone.utc)

    for changes in (
        {"time_intent": "unknown"},
        {"timezone": "Mars/Olympus"},
        {"preparation_duration_minutes": -1},
        {"target_datetime": "2026-10-11T07:00:00"},
        {"extra_field": "ignored?"},
    ):
        with pytest.raises(ValidationError):
            ScheduleCreate.model_validate(valid_schedule_payload() | changes)


@pytest.mark.parametrize("intent", ["arrival", "departure"])
def test_both_explicit_intents_allow_unknown_optional_durations(intent: str) -> None:
    parsed = ScheduleCreate.model_validate(
        valid_schedule_payload()
        | {"time_intent": intent, "preparation_duration_minutes": None, "travel_duration_minutes": None}
    )
    assert parsed.time_intent.value == intent
    assert parsed.preparation_duration_minutes is None
    assert parsed.travel_duration_minutes is None


def test_create_schema_requires_intent_target_and_timezone() -> None:
    for changes in (
        {"time_intent": None},
        {"target_datetime": None},
        {"timezone": ""},
        {"target_datetime": "2026-02-30T07:00:00+08:00"},
        {"target_datetime": "2026-10-11T07:00:00"},
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
    timezone_update = ScheduleUpdate.model_validate({"target_datetime": "2026-10-11T08:00:00+08:00"})
    assert timezone_update.target_datetime == datetime(2026, 10, 11, 0, tzinfo=timezone.utc)


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


def test_response_serializes_naive_database_datetime_as_utc() -> None:
    schedule = Schedule(
        id=8,
        clerk_user_id="user_123",
        title="Morning class",
        description=None,
        time_intent=TimeIntent.ARRIVAL,
        target_datetime=datetime(2026, 10, 11, 0),
        timezone="Asia/Manila",
        preparation_duration_minutes=30,
        travel_duration_minutes=None,
        calculated_departure_time=None,
        calculated_wake_time=None,
        status=ScheduleStatus.ACTIVE,
        created_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
    )

    serialized = ScheduleResponse.model_validate(schedule).model_dump(mode="json")

    assert serialized["target_datetime"] == "2026-10-11T00:00:00Z"


def test_response_normalizes_offset_datetime_to_utc() -> None:
    schedule = Schedule(
        id=9,
        clerk_user_id="user_123",
        title="Morning class",
        description=None,
        time_intent=TimeIntent.ARRIVAL,
        target_datetime=datetime(2026, 10, 11, 8, tzinfo=timezone(timedelta(hours=8))),
        timezone="Asia/Manila",
        preparation_duration_minutes=30,
        travel_duration_minutes=None,
        calculated_departure_time=None,
        calculated_wake_time=None,
        status=ScheduleStatus.ACTIVE,
        created_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 10, tzinfo=timezone.utc),
    )

    serialized = ScheduleResponse.model_validate(schedule).model_dump(mode="json")

    assert serialized["target_datetime"] == "2026-10-11T00:00:00Z"


@pytest.mark.parametrize(
    ("timezone_name", "target", "retrieved_at", "has_warning"),
    [
        ("Asia/Manila", "2026-10-15T18:55:00+08:00", "2026-10-15T10:55:37Z", True),
        ("America/Los_Angeles", "2026-10-15T03:55:00-07:00", "2026-10-15T10:54:59Z", False),
        ("Asia/Manila", "2026-10-15T18:55:00+08:00", "2026-10-15T10:56:00Z", True),
    ],
    ids=["later-within-same-displayed-minute", "genuinely-earlier-other-timezone", "genuinely-later"],
)
def test_route_warning_compares_aware_instants_not_displayed_minutes(
    timezone_name: str, target: str, retrieved_at: str, has_warning: bool,
) -> None:
    response = traffic_warning_response(
        timezone_name,
        datetime.fromisoformat(target),
        datetime.fromisoformat(retrieved_at),
    )

    assert (response.route_warning is not None) is has_warning


@pytest.mark.parametrize("offset", [timedelta(days=1), -timedelta(seconds=1), -timedelta(days=3650)])
def test_response_past_status_uses_aware_instants_across_timezones(offset: timedelta) -> None:
    now = datetime.now(timezone.utc)
    target = now + offset
    manila_representation = target.astimezone(ZoneInfo("Asia/Manila"))
    response = traffic_warning_response("Asia/Manila", manila_representation, now)

    assert response.is_past is (target <= now)
    assert response.target_datetime.astimezone(timezone.utc) == target


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
