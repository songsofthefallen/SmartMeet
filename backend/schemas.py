"""Pydantic contracts for schedule data."""

from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from models import ScheduleStatus, TimeIntent


def _require_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must include a UTC offset")
    return value


def _require_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("timezone must be a valid IANA timezone") from exc
    return value


NonEmptyTitle = Annotated[str, StringConstraints(min_length=1, max_length=200, strip_whitespace=True)]
NonEmptyTimezone = Annotated[str, StringConstraints(min_length=1, max_length=64, strip_whitespace=True)]
DurationMinutes = Annotated[int, Field(ge=0)]


class ScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: NonEmptyTitle
    description: str | None = Field(default=None, max_length=4000)
    time_intent: TimeIntent
    target_datetime: datetime
    timezone: NonEmptyTimezone
    preparation_duration_minutes: DurationMinutes
    travel_duration_minutes: DurationMinutes | None = None

    @field_validator("target_datetime")
    @classmethod
    def target_datetime_must_be_aware(cls, value: datetime) -> datetime:
        return _require_aware(value)

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_valid(cls, value: str) -> str:
        return _require_timezone(value)


class ScheduleUpdate(BaseModel):
    """Partial schedule fields; unset values can be distinguished via model_fields_set."""

    model_config = ConfigDict(extra="forbid")

    title: NonEmptyTitle | None = None
    description: str | None = Field(default=None, max_length=4000)
    time_intent: TimeIntent | None = None
    target_datetime: datetime | None = None
    timezone: NonEmptyTimezone | None = None
    preparation_duration_minutes: DurationMinutes | None = None
    travel_duration_minutes: DurationMinutes | None = None
    status: ScheduleStatus | None = None

    @model_validator(mode="after")
    def disallow_null_for_non_nullable_fields(self) -> "ScheduleUpdate":
        nullable_fields = {"description", "travel_duration_minutes"}
        for field_name in self.model_fields_set - nullable_fields:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self

    @field_validator("target_datetime")
    @classmethod
    def target_datetime_must_be_aware(cls, value: datetime | None) -> datetime | None:
        return _require_aware(value) if value is not None else None

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_valid(cls, value: str | None) -> str | None:
        return _require_timezone(value) if value is not None else None


class ScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    clerk_user_id: str
    title: str
    description: str | None
    time_intent: TimeIntent
    target_datetime: datetime
    timezone: str
    preparation_duration_minutes: int
    travel_duration_minutes: int | None
    calculated_departure_time: datetime | None
    calculated_wake_time: datetime | None
    status: ScheduleStatus
    created_at: datetime
    updated_at: datetime
