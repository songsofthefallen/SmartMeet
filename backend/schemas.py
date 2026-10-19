"""Pydantic contracts for schedule data."""

import math
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, StringConstraints, computed_field, field_serializer, field_validator, model_validator

from models import ScheduleStatus, TimeIntent
from timezone_utils import get_iana_timezone


def _require_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must include a UTC offset")
    return value.astimezone(timezone.utc)


def _require_timezone(value: str) -> str:
    get_iana_timezone(value)
    return value


NonEmptyTitle = Annotated[str, StringConstraints(min_length=1, max_length=200, strip_whitespace=True)]
NonEmptyTimezone = Annotated[str, StringConstraints(min_length=1, max_length=64, strip_whitespace=True)]
DurationMinutes = Annotated[int, Field(ge=0)]


class ScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(max_length=200, strip_whitespace=True)] | None = None
    description: str | None = Field(default=None, max_length=4000)
    location: "LocationSelection | None" = None
    origin_location: "LocationSelection | None" = None
    time_intent: TimeIntent
    target_datetime: datetime
    timezone: NonEmptyTimezone
    preparation_duration_minutes: DurationMinutes | None = None
    travel_duration_minutes: DurationMinutes | None = None
    idempotency_key: Annotated[str, StringConstraints(min_length=16, max_length=64)] | None = None
    continue_without_route: bool = False
    selected_route_id: Annotated[str, StringConstraints(min_length=1, max_length=20)] | None = None

    @field_validator("target_datetime")
    @classmethod
    def target_datetime_must_be_aware(cls, value: datetime) -> datetime:
        return _require_aware(value)

    @field_validator("title")
    @classmethod
    def blank_title_uses_default(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("timezone")
    @classmethod
    def timezone_must_be_valid(cls, value: str) -> str:
        return _require_timezone(value)


class RouteOptionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin_location: "LocationSelection"
    location: "LocationSelection"
    time_intent: TimeIntent
    target_datetime: datetime

    @field_validator("target_datetime")
    @classmethod
    def target_datetime_must_be_aware(cls, value: datetime) -> datetime:
        return _require_aware(value)


class ScheduleUpdate(BaseModel):
    """Partial schedule fields; unset values can be distinguished via model_fields_set."""

    model_config = ConfigDict(extra="forbid")

    title: NonEmptyTitle | None = None
    description: str | None = Field(default=None, max_length=4000)
    location: "LocationSelection | None" = None
    origin_location: "LocationSelection | None" = None
    time_intent: TimeIntent | None = None
    target_datetime: datetime | None = None
    timezone: NonEmptyTimezone | None = None
    preparation_duration_minutes: DurationMinutes | None = None
    travel_duration_minutes: DurationMinutes | None = None
    selected_route_id: Annotated[str, StringConstraints(min_length=1, max_length=20)] | None = None
    status: ScheduleStatus | None = None

    @model_validator(mode="after")
    def disallow_null_for_non_nullable_fields(self) -> "ScheduleUpdate":
        nullable_fields = {"description", "location", "origin_location", "travel_duration_minutes", "preparation_duration_minutes"}
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
    location: "LocationSelection | None"
    origin_location: "LocationSelection | None"
    travel_estimate: "TravelEstimate | None"
    weather_estimate: "WeatherEstimate | None" = None
    time_intent: TimeIntent
    target_datetime: datetime
    timezone: str
    preparation_duration_minutes: int | None
    travel_duration_minutes: int | None
    calculated_departure_time: datetime | None
    calculated_arrival_time: datetime | None
    calculated_wake_time: datetime | None
    departure_unavailable_reason: str | None = None
    arrival_unavailable_reason: str | None = None
    wake_unavailable_reason: str | None = None
    status: ScheduleStatus
    created_at: datetime
    updated_at: datetime

    @field_serializer(
        "target_datetime",
        "calculated_departure_time",
        "calculated_arrival_time",
        "calculated_wake_time",
        when_used="json",
    )
    def serialize_schedule_times(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.isoformat().replace("+00:00", "Z")

    @computed_field
    @property
    def is_past(self) -> bool:
        target = self.calculated_departure_time or self.target_datetime
        if target.tzinfo is None or target.utcoffset() is None:
            target = target.replace(tzinfo=timezone.utc)
        return target.astimezone(timezone.utc) <= datetime.now(timezone.utc)

    @computed_field
    @property
    def route_warning(self) -> str | None:
        estimate = self.travel_estimate
        if estimate is None:
            return None
        intended_departure = self.calculated_departure_time or self.target_datetime
        retrieved_at = estimate.retrieved_at
        if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
            retrieved_at = retrieved_at.replace(tzinfo=timezone.utc)
        if intended_departure.tzinfo is None or intended_departure.utcoffset() is None:
            intended_departure = intended_departure.replace(tzinfo=timezone.utc)
        if retrieved_at.astimezone(timezone.utc) > intended_departure.astimezone(timezone.utc):
            return "This traffic estimate was retrieved after the intended departure time and may not reflect conditions when you needed to travel."
        return None

    @computed_field
    @property
    def traffic_delay_minutes(self) -> int | None:
        return self.travel_estimate.traffic_delay_minutes if self.travel_estimate else None

    @computed_field
    @property
    def traffic_status(self) -> str:
        return self.travel_estimate.traffic_status if self.travel_estimate else "unavailable"

    @computed_field
    @property
    def traffic_data_source(self) -> str:
        return self.travel_estimate.traffic_data_source if self.travel_estimate else "unknown"


class LocationSelection(BaseModel):
    """A user-confirmed geocoding result stored with its schedule."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(min_length=1, max_length=200, strip_whitespace=True)]
    locality: Annotated[str, StringConstraints(max_length=120)] | None = None
    region: Annotated[str, StringConstraints(max_length=120)] | None = None
    country: Annotated[str, StringConstraints(max_length=120)] | None = None
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    timezone: Annotated[str, StringConstraints(max_length=64)] | None = None


class TrafficSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    severity: Annotated[str, StringConstraints(pattern="^(little_or_no_delay|some_delay|significant_delay)$")] | None = None
    delay_seconds: int | None = Field(default=None, ge=0)
    start_point_index: int | None = Field(default=None, ge=0)
    end_point_index: int | None = Field(default=None, ge=0)
    road_names: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=10)
    road_numbers: list[Annotated[str, StringConstraints(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=10)
    approximate_location: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None = None
    location_source: Annotated[str, StringConstraints(pattern="^(verified_route_metadata|reverse_geocoding|unavailable)$")] = "unavailable"
    incident_type: Annotated[str, StringConstraints(pattern="^(JAM|ROAD_WORK|ROAD_CLOSURE|OTHER)$")] | None = None
    start_coordinates: "TrafficCoordinate | None" = None
    end_coordinates: "TrafficCoordinate | None" = None


class TrafficCoordinate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class RouteLandmarksRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_points: list[TrafficCoordinate] = Field(min_length=2, max_length=500)


class RouteLandmark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(min_length=1, max_length=160)]
    category: Annotated[str, StringConstraints(pattern="^(hospital|school)$")]
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class WeatherPointForecast(BaseModel):
    model_config = ConfigDict(extra="forbid")
    condition: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    weather_code: int = Field(ge=0, le=99)
    precipitation_mm: float = Field(ge=0, allow_inf_nan=False)
    snowfall_cm: float = Field(ge=0, allow_inf_nan=False)
    wind_speed_kmh: float = Field(ge=0, allow_inf_nan=False)


class WeatherAdvisory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    condition: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    endpoint: Annotated[str, StringConstraints(pattern="^(origin|destination)$")]
    forecast_at: datetime

    @field_validator("forecast_at")
    @classmethod
    def advisory_forecast_time_must_be_aware(cls, value: datetime) -> datetime:
        return _require_aware(value)


@dataclass(frozen=True)
class WeatherAssessmentDiagnostic:
    """Internal-only failure context; deliberately excluded from API serialization."""

    reason: str
    assessment_pass: int
    origin_forecast_hour: str
    destination_forecast_hour: str
    failed_point: str | None = None
    rejection_reason: str | None = None
    current_utc_hour: str | None = None


class WeatherEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Annotated[str, StringConstraints(pattern="^(available|unavailable)$")]
    summary: Annotated[str, StringConstraints(max_length=500)]
    # Read deprecated values from schedules written by Spec 14. New estimates
    # omit this field and weather never participates in time calculations.
    buffer_minutes: int | None = Field(default=None, ge=0, le=30, exclude=True)
    retrieved_at: datetime | None
    forecast_at: datetime | None = None
    origin_forecast_at: datetime | None = None
    destination_forecast_at: datetime | None = None
    timing_note: Annotated[str, StringConstraints(max_length=300)] | None = Field(default=None, exclude=True)
    origin_weather: WeatherPointForecast | None = None
    destination_weather: WeatherPointForecast | None = None
    conditions: list[Annotated[str, StringConstraints(max_length=80)]] = Field(default_factory=list, max_length=10)
    advisories: list[WeatherAdvisory] = Field(default_factory=list, max_length=20)
    _diagnostic: WeatherAssessmentDiagnostic | None = PrivateAttr(default=None)

    @field_validator("retrieved_at")
    @classmethod
    def retrieved_at_must_be_aware(cls, value: datetime | None) -> datetime | None:
        return _require_aware(value) if value is not None else None

    @field_validator("forecast_at")
    @classmethod
    def forecast_at_must_be_aware(cls, value: datetime | None) -> datetime | None:
        return _require_aware(value) if value is not None else None

    @field_validator("origin_forecast_at", "destination_forecast_at")
    @classmethod
    def endpoint_forecast_times_must_be_aware(cls, value: datetime | None) -> datetime | None:
        return _require_aware(value) if value is not None else None


class RouteAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_id: Annotated[str, StringConstraints(min_length=1, max_length=20)]
    duration_seconds: int = Field(ge=0)
    duration_minutes: int = Field(ge=0)
    distance_meters: int | None = Field(default=None, ge=0)
    traffic_delay_seconds: int | None = Field(default=None, ge=0)
    no_traffic_travel_time_seconds: int | None = Field(default=None, ge=0)
    historic_traffic_travel_time_seconds: int | None = Field(default=None, ge=0)
    live_traffic_incidents_travel_time_seconds: int | None = Field(default=None, ge=0)
    traffic_sections: list["TrafficSection"] = Field(default_factory=list, max_length=100)
    road_names: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=10)
    geometry: list["TrafficCoordinate"] = Field(default_factory=list, max_length=500)


class TravelEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_seconds: int = Field(ge=0)
    duration_minutes: int = Field(ge=0)
    provider: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    retrieved_at: datetime
    traffic_included: bool
    route_time_basis: Annotated[str, StringConstraints(pattern="^(current|scheduled_departure|scheduled_arrival)$")] = "current"
    traffic_delay_seconds: int | None = Field(default=None, ge=0)
    no_traffic_travel_time_seconds: int | None = Field(default=None, ge=0)
    historic_traffic_travel_time_seconds: int | None = Field(default=None, ge=0)
    live_traffic_incidents_travel_time_seconds: int | None = Field(default=None, ge=0)
    traffic_sections: list["TrafficSection"] = Field(default_factory=list, max_length=100)
    selected_route_id: Annotated[str, StringConstraints(min_length=1, max_length=20)] = "0"
    # TomTom's maxAlternatives is additional to the primary route: 1 + 5.
    alternatives: list[RouteAlternative] = Field(default_factory=list, max_length=6)

    @field_validator(
        "traffic_delay_seconds",
        "no_traffic_travel_time_seconds",
        "historic_traffic_travel_time_seconds",
        "live_traffic_incidents_travel_time_seconds",
    )
    @classmethod
    def traffic_seconds_must_be_finite_integer(cls, value: int | None) -> int | None:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            raise ValueError("traffic time values must be integer seconds")
        return value

    @field_validator("retrieved_at")
    @classmethod
    def retrieved_at_must_be_aware(cls, value: datetime) -> datetime:
        return _require_aware(value)

    @property
    def traffic_delay_minutes(self) -> int | None:
        if self.traffic_delay_seconds is not None and self.no_traffic_travel_time_seconds is not None and self.no_traffic_travel_time_seconds > 0:
            return int(math.ceil(self.traffic_delay_seconds / 60))
        return None

    @property
    def traffic_data_source(self) -> str:
        live = self.live_traffic_incidents_travel_time_seconds is not None
        historical = self.historic_traffic_travel_time_seconds is not None
        if live and historical:
            return "live_and_historical_available"
        if live:
            return "live_available"
        if historical:
            return "historical_available"
        return "unknown"

    @property
    def traffic_status(self) -> str:
        baseline = self.no_traffic_travel_time_seconds
        delay = self.traffic_delay_seconds
        if baseline is None or delay is None or baseline <= 0 or delay < 0:
            return "unavailable"
        ratio = delay / baseline
        # Application display thresholds: little/no <= 2 minutes and <= 5%;
        # significant >= 10 minutes or >= 20%; otherwise some delay.
        if delay <= 120 and ratio <= 0.05:
            return "little_or_no_delay"
        if delay >= 600 or ratio >= 0.20:
            return "significant_delay"
        return "some_delay"


class LocationSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: Annotated[str, StringConstraints(min_length=2, max_length=200, strip_whitespace=True)]


class LocationSearchResponse(BaseModel):
    results: list[LocationSelection]


class PushSubscriptionKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p256dh: Annotated[str, StringConstraints(min_length=20, max_length=256)]
    auth: Annotated[str, StringConstraints(min_length=16, max_length=128)]


class PushSubscriptionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: Annotated[str, StringConstraints(min_length=20, max_length=2048)]
    keys: PushSubscriptionKeys


class PushSubscriptionDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: Annotated[str, StringConstraints(min_length=20, max_length=2048)]
