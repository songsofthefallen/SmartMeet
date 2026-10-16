from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from models import TimeIntent
from time_calculation import CalculationSettings, calculate_schedule_times


def calc(**overrides: object):
    values: dict[str, object] = {
        "time_intent": TimeIntent.ARRIVAL,
        "target_datetime": datetime(2026, 10, 11, 8, tzinfo=timezone(timedelta(hours=8))),
        "timezone_name": "Asia/Manila",
        "travel_duration_minutes": 90,
        "preparation_duration_minutes": 60,
    }
    values.update(overrides)
    return calculate_schedule_times(**values)  # type: ignore[arg-type]


def test_manila_arrival_calculates_expected_local_departure_and_wake() -> None:
    result = calc(target_datetime=datetime(2026, 10, 12, 8, tzinfo=timezone(timedelta(hours=8))))
    assert result.departure_time == datetime(2026, 10, 11, 22, 30, tzinfo=timezone.utc)
    assert result.wake_time == datetime(2026, 10, 11, 21, 30, tzinfo=timezone.utc)
    assert result.departure_time.astimezone(ZoneInfo("Asia/Manila")).isoformat() == "2026-10-12T06:30:00+08:00"
    assert result.wake_time.astimezone(ZoneInfo("Asia/Manila")).isoformat() == "2026-10-12T05:30:00+08:00"


def test_departure_intent_keeps_target_and_does_not_subtract_travel() -> None:
    result = calc(time_intent=TimeIntent.DEPARTURE)
    assert result.departure_time == datetime(2026, 10, 11, 0, tzinfo=timezone.utc)
    assert result.wake_time == datetime(2026, 10, 10, 23, tzinfo=timezone.utc)


def test_departure_intent_in_tokyo_keeps_explicit_instant() -> None:
    result = calc(
        time_intent=TimeIntent.DEPARTURE,
        target_datetime=datetime(2026, 10, 12, 8, tzinfo=timezone(timedelta(hours=9))),
        timezone_name="Asia/Tokyo",
    )
    assert result.departure_time == datetime(2026, 10, 11, 23, tzinfo=timezone.utc)
    assert result.departure_time.astimezone(ZoneInfo("Asia/Tokyo")).isoformat() == "2026-10-12T08:00:00+09:00"


def test_buffers_apply_once_and_zero_duration_is_known() -> None:
    result = calc(
        travel_duration_minutes=0,
        preparation_duration_minutes=0,
        settings=CalculationSettings(travel_buffer_minutes=15, preparation_buffer_minutes=10),
    )
    assert result.departure_time.hour == 23 and result.departure_time.minute == 45
    assert result.wake_time.hour == 23 and result.wake_time.minute == 35


def test_weather_does_not_change_arrival_calculation_or_user_travel_buffer() -> None:
    result = calc(settings=CalculationSettings(travel_buffer_minutes=5))
    assert result.departure_time == datetime(2026, 10, 10, 22, 25, tzinfo=timezone.utc)


def test_weather_does_not_change_departure_intent_arrival_or_departure() -> None:
    result = calc(time_intent=TimeIntent.DEPARTURE)
    assert result.departure_time == datetime(2026, 10, 11, 0, tzinfo=timezone.utc)
    assert result.arrival_time == datetime(2026, 10, 11, 1, 30, tzinfo=timezone.utc)


def test_unknown_durations_return_reasons_without_zero_substitution() -> None:
    travel_unknown = calc(travel_duration_minutes=None)
    assert travel_unknown.departure_time is None
    assert travel_unknown.departure_unavailable_reason == "Travel duration is unknown."
    assert travel_unknown.wake_time == datetime(2026, 10, 10, 23, tzinfo=timezone.utc)
    preparation_unknown = calc(preparation_duration_minutes=None)
    assert preparation_unknown.departure_time is not None
    assert preparation_unknown.wake_time is None
    assert preparation_unknown.wake_unavailable_reason == "Preparation duration is unknown."


def test_arrival_intent_keeps_wake_suggestion_when_travel_is_unknown() -> None:
    result = calc(travel_duration_minutes=None, preparation_duration_minutes=30)
    assert result.departure_time is None
    assert result.departure_unavailable_reason == "Travel duration is unknown."
    assert result.wake_time == datetime(2026, 10, 10, 23, 30, tzinfo=timezone.utc)


def test_departure_intent_keeps_departure_and_wake_when_travel_is_unknown() -> None:
    result = calc(time_intent=TimeIntent.DEPARTURE, travel_duration_minutes=None, preparation_duration_minutes=30)
    assert result.departure_time == datetime(2026, 10, 11, 0, tzinfo=timezone.utc)
    assert result.arrival_time is None
    assert result.arrival_unavailable_reason == "Travel duration is unknown."
    assert result.wake_time == datetime(2026, 10, 10, 23, 30, tzinfo=timezone.utc)


@pytest.mark.parametrize("intent", [TimeIntent.ARRIVAL, TimeIntent.DEPARTURE])
def test_missing_preparation_does_not_remove_departure_or_arrival(intent: TimeIntent) -> None:
    result = calc(time_intent=intent, preparation_duration_minutes=None)
    assert result.departure_time is not None
    assert result.wake_time is None
    assert result.wake_unavailable_reason == "Preparation duration is unknown."
    assert result.arrival_time is not None


def test_departure_intent_estimates_arrival_from_known_travel_duration() -> None:
    result = calc(time_intent=TimeIntent.DEPARTURE, travel_duration_minutes=45)
    assert result.arrival_time == datetime(2026, 10, 11, 0, 45, tzinfo=timezone.utc)


def test_calculation_crosses_midnight_in_manila() -> None:
    result = calc(
        target_datetime=datetime(2026, 10, 12, 1, tzinfo=timezone(timedelta(hours=8))),
        travel_duration_minutes=90,
        preparation_duration_minutes=60,
    )
    assert result.departure_time.astimezone(ZoneInfo("Asia/Manila")).isoformat() == "2026-10-11T23:30:00+08:00"
    assert result.wake_time.astimezone(ZoneInfo("Asia/Manila")).isoformat() == "2026-10-11T22:30:00+08:00"


def test_calculation_crosses_dst_transition_using_elapsed_instants() -> None:
    result = calc(
        target_datetime=datetime(2026, 3, 8, 7, 30, tzinfo=timezone.utc),
        timezone_name="America/New_York",
        travel_duration_minutes=60,
        preparation_duration_minutes=0,
    )
    assert result.departure_time.astimezone(ZoneInfo("America/New_York")).isoformat() == "2026-03-08T01:30:00-05:00"
    assert result.wake_time.astimezone(ZoneInfo("America/New_York")).isoformat() == "2026-03-08T01:30:00-05:00"


@pytest.mark.parametrize("kwargs", [
    {"travel_duration_minutes": -1},
    {"preparation_duration_minutes": -1},
])
def test_negative_duration_or_buffer_is_rejected(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        calc(**kwargs)


def test_negative_buffer_configuration_is_rejected() -> None:
    with pytest.raises(ValueError):
        CalculationSettings(travel_buffer_minutes=-1)
