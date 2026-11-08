"""Validated candidate fields returned by natural-language extraction."""

from datetime import date, datetime, time, timezone
from enum import Enum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from models import TimeIntent
from schemas import LocationSelection
from timezone_utils import get_iana_timezone


ExtractionInputText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
DurationMinutes = Annotated[int, Field(strict=True, ge=0, le=100_000)]


class ScheduleExtractionCandidate(BaseModel):
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


class ScheduleExtraction(ScheduleExtractionCandidate):
    """Validated extraction plus deterministic saved-place resolutions."""

    origin_saved_place_id: int | None = None
    destination_saved_place_id: int | None = None


class ExtractionReviewStatus(str, Enum):
    READY_FOR_REVIEW = "ready_for_review"
    NEEDS_CLARIFICATION = "needs_clarification"


class ExtractionClarification(BaseModel):
    """One focused, deterministic next question for an incomplete extraction."""

    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    reason: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    question: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    answer_type: Literal["choice", "date", "time", "timezone", "location", "text"]
    options: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] = Field(default_factory=list, max_length=5)


class ScheduleExtractionReview(BaseModel):
    """Structured readiness result for a validated extraction candidate."""

    model_config = ConfigDict(extra="forbid")

    status: ExtractionReviewStatus
    extraction: ScheduleExtraction | None
    resolved_target_datetime: datetime | None
    missing_fields: list[str] = Field(default_factory=list)
    ambiguous_fields: list[str] = Field(default_factory=list)
    invalid_fields: list[str] = Field(default_factory=list)
    draft_id: Annotated[str, StringConstraints(min_length=36, max_length=36)] | None = None
    clarification: ExtractionClarification | None = None

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
        if self.status is ExtractionReviewStatus.NEEDS_CLARIFICATION:
            self.clarification = self.clarification or _next_clarification(self)
        elif self.status is ExtractionReviewStatus.READY_FOR_REVIEW:
            self.clarification = None
        return self


def _next_clarification(review: ScheduleExtractionReview) -> ExtractionClarification:
    """Choose one blocking field in a stable order and phrase it without model scores."""
    extraction = review.extraction
    if extraction is None:
        return ExtractionClarification(field="model_output", reason="The extracted details could not be validated.", question="Could you restate the event, date, and time?", answer_type="text")
    ordered = (
        "schedule_request", "time_intent", "target_date_local", "target_time_local", "timezone",
        "destination_description", "origin_description", "ambiguities",
    )
    fields = set(review.missing_fields + review.ambiguous_fields + review.invalid_fields)
    if "schedule_request" in fields:
        return ExtractionClarification(field="schedule_request", reason="The request does not yet identify an event to schedule.", question="What event or plan should I schedule?", answer_type="text")
    if "target_time_offset" in fields:
        fields.add("target_time_local")
    if "ambiguities" in fields and extraction.ambiguities:
        text = extraction.ambiguities[0].casefold()
        if any(word in text for word in ("arrival", "departure", "leaving", "leave at", "arrive by")):
            fields.add("time_intent")
        elif any(word in text for word in ("date", "day", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "tomorrow")):
            fields.add("target_date_local")
        elif any(word in text for word in ("origin", "starting point", "from where")):
            fields.add("origin_description")
        elif any(word in text for word in ("destination", "which mall", "which school", "which location")):
            fields.add("destination_description")
    field = next((candidate for candidate in ordered if candidate in fields), "ambiguities")
    if field == "time_intent":
        return ExtractionClarification(field=field, reason="The wording does not clearly say whether the time is for arriving or leaving.", question="Is that time for arriving or leaving?", answer_type="choice", options=["Arrive at that time", "Leave at that time"])
    if field == "target_date_local":
        return ExtractionClarification(field=field, reason="A valid local date is needed before the schedule can be prepared.", question="What date should I use?", answer_type="date")
    if field == "target_time_local":
        reason = "The extracted local time is invalid or ambiguous." if field in review.ambiguous_fields + review.invalid_fields else "A target time is needed before the schedule can be prepared."
        return ExtractionClarification(field=field, reason=reason, question="What local time should I use?", answer_type="time")
    if field == "timezone":
        return ExtractionClarification(field=field, reason="The target time needs an agreed timezone.", question="Which timezone should interpret this time?", answer_type="timezone")
    if field in ("origin_description", "destination_description"):
        label = "starting point" if field == "origin_description" else "destination"
        return ExtractionClarification(field=field, reason=f"The {label} could not be identified confidently.", question=f"Where is the {label}?", answer_type="location")
    return ExtractionClarification(field=field, reason="The extracted information is still ambiguous.", question="Could you clarify this detail?", answer_type="text")


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


class ScheduleExtractionClarificationRequest(BaseModel):
    """Natural-language answer to the one active question on an extraction draft."""

    model_config = ConfigDict(extra="forbid")

    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
    origin_location: LocationSelection | None = None
    destination_location: LocationSelection | None = None
