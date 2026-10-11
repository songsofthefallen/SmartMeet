"""Deterministic schedule time calculations and buffer configuration."""

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import Schedule, TimeIntent


@dataclass(frozen=True)
class CalculationSettings:
    travel_buffer_minutes: int = 0
    preparation_buffer_minutes: int = 0

    def __post_init__(self) -> None:
        if self.travel_buffer_minutes < 0 or self.preparation_buffer_minutes < 0:
            raise ValueError("time buffers must be nonnegative")

    @classmethod
    def from_env(cls) -> "CalculationSettings":
        def read(name: str) -> int:
            raw = os.getenv(name, "0").strip()
            try:
                value = int(raw)
            except ValueError as exc:
                raise ValueError(f"{name} must be a nonnegative integer") from exc
            if value < 0:
                raise ValueError(f"{name} must be a nonnegative integer")
            return value

        return cls(read("TRAVEL_BUFFER_MINUTES"), read("PREPARATION_BUFFER_MINUTES"))


@dataclass(frozen=True)
class TimeCalculation:
    departure_time: datetime | None
    wake_time: datetime | None
    departure_unavailable_reason: str | None
    wake_unavailable_reason: str | None


def calculate_schedule_times(
    *,
    time_intent: TimeIntent,
    target_datetime: datetime,
    timezone_name: str,
    travel_duration_minutes: int | None,
    preparation_duration_minutes: int | None,
    settings: CalculationSettings | None = None,
) -> TimeCalculation:
    """Calculate from aware instants and return canonical UTC instants for persistence/API."""
    # MySQL and SQLite may return UTC-backed DateTime values without tzinfo.
    if target_datetime.tzinfo is None or target_datetime.utcoffset() is None:
        target_datetime = target_datetime.replace(tzinfo=timezone.utc)
    for value in (travel_duration_minutes, preparation_duration_minutes):
        if value is not None and value < 0:
            raise ValueError("durations must be nonnegative")
    config = settings or CalculationSettings()
    ZoneInfo(timezone_name)  # Validate the schedule zone; display conversion happens in the UI.
    target = target_datetime.astimezone(timezone.utc)

    if time_intent is TimeIntent.DEPARTURE:
        departure = target
        departure_reason = None
    elif travel_duration_minutes is None:
        departure = None
        departure_reason = "Travel duration is unknown."
    else:
        departure = target - timedelta(minutes=travel_duration_minutes + config.travel_buffer_minutes)
        departure_reason = None

    if departure is None:
        wake = None
        wake_reason = "A departure time is unavailable."
    elif preparation_duration_minutes is None:
        wake = None
        wake_reason = "Preparation duration is unknown."
    else:
        wake = departure - timedelta(minutes=preparation_duration_minutes + config.preparation_buffer_minutes)
        wake_reason = None

    return TimeCalculation(
        departure,
        wake,
        departure_reason,
        wake_reason,
    )


def recalculate_schedule(schedule: Schedule, settings: CalculationSettings | None = None) -> None:
    result = calculate_schedule_times(
        time_intent=schedule.time_intent,
        target_datetime=schedule.target_datetime,
        timezone_name=schedule.timezone,
        travel_duration_minutes=schedule.travel_duration_minutes,
        preparation_duration_minutes=schedule.preparation_duration_minutes,
        settings=settings,
    )
    schedule.calculated_departure_time = result.departure_time
    schedule.calculated_wake_time = result.wake_time
    schedule.departure_unavailable_reason = result.departure_unavailable_reason
    schedule.wake_unavailable_reason = result.wake_unavailable_reason
