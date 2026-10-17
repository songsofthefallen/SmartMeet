"""Validated candidate fields returned by natural-language extraction."""

from datetime import date, datetime, time, timezone
from enum import Enum
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from models import TimeIntent
from timezone_utils import get_iana_timezone


ExtractionInputText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
DurationMinutes = Annotated[int, Field(strict=True, ge=0, le=100_000)]


class ScheduleExtraction(BaseModel):
    """Untrusted extraction candidates; absent or unclear facts remain null."""

    model_config = ConfigDict(extra="forbid", strict=True)

    is_schedule_request: bool
    time_intent: TimeIntent | None
    target_date_local: date | None
    target_time_local: time | None
    timezone: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
    ] | None
    preparation_duration_minutes: DurationMinutes | None
    travel_duration_minutes: DurationMinutes | None
    origin_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None
    destination_description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None
    time_intent_ambiguous: bool
    ambiguities: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    ] = Field(..., max_length=10)

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_iana(cls, value: str | None) -> str | None:
        if value is None:
            return None
        get_iana_timezone(value)
        return value

    @model_validator(mode="after")
    def ambiguous_intent_must_remain_unset(self) -> "ScheduleExtraction":
        if self.time_intent_ambiguous and self.time_intent is not None:
            raise ValueError("time_intent must be null when its meaning is ambiguous")
        return self

    @property
    def missing_fields(self) -> list[str]:
        """Return required schedule fields missing from validated candidates."""
        if not self.is_schedule_request:
            return []
        required = {
            "time_intent": self.time_intent,
            "target_date_local": self.target_date_local,
            "target_time_local": self.target_time_local,
            "timezone": self.timezone,
        }
        return [name for name, value in required.items() if value is None]


class ExtractionReviewStatus(str, Enum):
    READY_FOR_REVIEW = "ready_for_review"
    NEEDS_CLARIFICATION = "needs_clarification"


class ScheduleExtractionReview(BaseModel):
    """Structured readiness result for a validated extraction candidate."""

    model_config = ConfigDict(extra="forbid")

    status: ExtractionReviewStatus
    extraction: ScheduleExtraction | None
    resolved_target_datetime: datetime | None
    missing_fields: list[str] = Field(default_factory=list)
    ambiguous_fields: list[str] = Field(default_factory=list)
    invalid_fields: list[str] = Field(default_factory=list)

    @field_validator("resolved_target_datetime")
    @classmethod
    def resolved_datetime_must_be_aware(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("resolved_target_datetime must include a UTC offset")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def readiness_must_match_result(self) -> "ScheduleExtractionReview":
        if self.status is ExtractionReviewStatus.READY_FOR_REVIEW:
            if (
                self.extraction is None
                or not self.extraction.is_schedule_request
                or self.missing_fields
                or self.ambiguous_fields
                or self.invalid_fields
                or self.resolved_target_datetime is None
            ):
                raise ValueError("ready_for_review requires complete, unambiguous resolved fields")
        elif self.resolved_target_datetime is not None:
            raise ValueError("needs_clarification cannot contain a resolved target datetime")
        elif (
            self.extraction is not None
            and self.extraction.is_schedule_request
            and not (self.missing_fields or self.ambiguous_fields or self.invalid_fields)
        ):
            raise ValueError("needs_clarification requires a reported issue")
        return self


class ScheduleExtractionRequest(BaseModel):
    """Authenticated extraction input; timezone is explicit when known."""

    model_config = ConfigDict(extra="forbid")

    text: ExtractionInputText
    timezone: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
    ] | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_iana(cls, value: str | None) -> str | None:
        if value is not None:
            get_iana_timezone(value)
        return value
