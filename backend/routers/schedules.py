"""Authenticated schedule endpoints."""

import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from database import get_db
from main import verify_clerk_token
from models import RouteRefreshAttempt, Schedule, ScheduleNameCounter, ScheduleStatus
from schemas import LocationSelection, ScheduleCreate, ScheduleResponse, ScheduleUpdate, TravelEstimate, WeatherAssessmentDiagnostic, WeatherEstimate
from routing_service import RoutingProviderConfigurationError, RoutingProviderError, TomTomRoutingService
from time_calculation import CalculationSettings, calculate_schedule_times, recalculate_schedule
from route_refresh_limits import RouteRefreshRateLimited, finish_attempt, reserve_attempt
from weather_service import OpenMeteoWeatherService


router = APIRouter(prefix="/schedules", tags=["schedules"])
logger = logging.getLogger(__name__)
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[str, Depends(verify_clerk_token)]


def get_routing_service() -> TomTomRoutingService | None:
    try:
        return TomTomRoutingService()
    except RoutingProviderConfigurationError:
        return None


RoutingService = Annotated[TomTomRoutingService | None, Depends(get_routing_service)]


def _refresh_route(schedule: Schedule, service: TomTomRoutingService | None) -> None:
    if schedule.origin_location is None or schedule.location is None:
        if schedule.travel_estimate is not None:
            schedule.travel_duration_minutes = None
        schedule.travel_estimate = None
        return
    if service is None:
        schedule.travel_estimate = None
        schedule.travel_duration_minutes = None
        return
    try:
        target = schedule.target_datetime
        if target.tzinfo is None or target.utcoffset() is None:
            target = target.replace(tzinfo=timezone.utc)
        route_time = target.astimezone(timezone.utc)
        if route_time <= datetime.now(timezone.utc):
            route_time = None
        route_time_args = {}
        if route_time is not None and schedule.time_intent.value == "arrival":
            route_time_args["arrive_at"] = route_time
        elif route_time is not None:
            route_time_args["depart_at"] = route_time
        estimate = service.estimate(
            LocationSelection.model_validate(schedule.origin_location),
            LocationSelection.model_validate(schedule.location),
            **route_time_args,
        )
    except (RoutingProviderError, ValueError):
        schedule.travel_estimate = None
        schedule.travel_duration_minutes = None
        return
    schedule.travel_estimate = estimate.model_dump(mode="json")
    schedule.travel_duration_minutes = estimate.duration_minutes


def _route_estimate(
    schedule: Schedule,
    service: TomTomRoutingService,
    *,
    diagnose_unnamed_traffic_sections: bool = False,
) -> TravelEstimate:
    target = schedule.target_datetime
    if target.tzinfo is None or target.utcoffset() is None:
        target = target.replace(tzinfo=timezone.utc)
    route_time = target.astimezone(timezone.utc)
    route_time_args = {}
    if route_time > datetime.now(timezone.utc):
        if schedule.time_intent.value == "arrival":
            route_time_args["arrive_at"] = route_time
        else:
            route_time_args["depart_at"] = route_time
    return service.estimate(
        LocationSelection.model_validate(schedule.origin_location),
        LocationSelection.model_validate(schedule.location),
        diagnose_unnamed_traffic_sections=diagnose_unnamed_traffic_sections,
        **route_time_args,
    )


def _owned_schedule(db: Session, schedule_id: int, user_id: str) -> Schedule:
    schedule = db.scalar(
        select(Schedule).where(
            Schedule.id == schedule_id,
            Schedule.clerk_user_id == user_id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return schedule


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A schedule with this name already exists in your account.",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save schedule",
        ) from exc


def _normalized_title(title: str) -> str:
    normalized = title.strip().casefold()
    if len(normalized) > 200:
        raise HTTPException(status_code=422, detail="Title is too long after normalization")
    return normalized


def _next_schedule_title(db: Session, user_id: str) -> str:
    """Allocate a name while holding this user's counter row until commit."""
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        insert = mysql_insert(ScheduleNameCounter).values(clerk_user_id=user_id, next_number=1)
        db.execute(insert.on_duplicate_key_update(clerk_user_id=insert.inserted.clerk_user_id))
    elif dialect == "sqlite":
        insert = sqlite_insert(ScheduleNameCounter).values(clerk_user_id=user_id, next_number=1)
        db.execute(insert.on_conflict_do_nothing(index_elements=["clerk_user_id"]))
    else:
        if db.get(ScheduleNameCounter, user_id) is None:
            db.add(ScheduleNameCounter(clerk_user_id=user_id, next_number=1))
            db.flush()
    counter = db.scalar(
        select(ScheduleNameCounter)
        .where(ScheduleNameCounter.clerk_user_id == user_id)
        .with_for_update()
    )
    assert counter is not None
    number = counter.next_number
    while db.scalar(select(Schedule.id).where(
        Schedule.clerk_user_id == user_id,
        Schedule.normalized_title == _normalized_title(f"Schedule {number}"),
    )) is not None:
        number += 1
    counter.next_number = number + 1
    return f"Schedule {number}"


def _calculate(schedule: Schedule) -> Schedule:
    recalculate_schedule(schedule, CalculationSettings.from_env())
    return schedule


def get_weather_service() -> OpenMeteoWeatherService:
    return OpenMeteoWeatherService()


WeatherService = Annotated[OpenMeteoWeatherService, Depends(get_weather_service)]


def _refresh_weather(schedule: Schedule, service: OpenMeteoWeatherService) -> None:
    if not schedule.origin_location or not schedule.location or schedule.travel_duration_minutes is None:
        schedule.weather_estimate = {
            "status": "unavailable",
            "summary": "Weather information is temporarily unavailable.",
            "retrieved_at": None,
            "forecast_at": None,
            "conditions": [],
            "advisories": [],
        }
        return
    target = schedule.target_datetime
    if target.tzinfo is None or target.utcoffset() is None:
        target = target.replace(tzinfo=timezone.utc)
    target = target.astimezone(timezone.utc)
    origin = LocationSelection.model_validate(schedule.origin_location)
    destination = LocationSelection.model_validate(schedule.location)
    # Weather only observes the deterministic schedule times; it never changes them.
    times = calculate_schedule_times(
        time_intent=schedule.time_intent,
        target_datetime=target,
        timezone_name=schedule.timezone,
        travel_duration_minutes=schedule.travel_duration_minutes,
        preparation_duration_minutes=schedule.preparation_duration_minutes,
        settings=CalculationSettings.from_env(),
    )
    if times.departure_time is None or times.arrival_time is None:
        schedule.weather_estimate = {
            "status": "unavailable", "summary": "Weather information is temporarily unavailable.",
            "retrieved_at": None, "forecast_at": None, "conditions": [], "advisories": [],
        }
        return
    try:
        estimate = WeatherEstimate.model_validate(service.assess(
            origin, destination, times.departure_time, times.arrival_time,
        ))
    except Exception:
        estimate = WeatherEstimate(
            status="unavailable", summary="Weather information is temporarily unavailable.",
            retrieved_at=None,
        )
        estimate._diagnostic = WeatherAssessmentDiagnostic(
            reason="invalid_response_values", assessment_pass=1,
            origin_forecast_hour=times.departure_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00Z"),
            destination_forecast_hour=times.arrival_time.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00Z"),
        )
    if estimate.status != "available":
        _log_weather_failure(estimate, assessment_pass=1)
    schedule.weather_estimate = estimate.model_dump(mode="json", exclude={"buffer_minutes", "timing_note"})


def _log_weather_failure(
    estimate: WeatherEstimate,
    *,
    assessment_pass: int,
    second_pass: bool = False,
) -> None:
    diagnostic = estimate._diagnostic
    reason = "second_pass_failure" if second_pass else (diagnostic.reason if diagnostic else "assessment_unavailable")
    fields = {
        "weather_event": "assessment_unavailable",
        "weather_reason": reason,
        "weather_cause_reason": diagnostic.reason if diagnostic and second_pass else None,
        "weather_assessment_pass": assessment_pass,
        "weather_origin_forecast_hour": diagnostic.origin_forecast_hour if diagnostic else None,
        "weather_destination_forecast_hour": diagnostic.destination_forecast_hour if diagnostic else None,
        "weather_failed_point": diagnostic.failed_point if diagnostic else None,
        "weather_rejection_reason": diagnostic.rejection_reason if diagnostic else None,
        "weather_current_utc_hour": diagnostic.current_utc_hour if diagnostic else None,
    }
    # Uvicorn's default console formatter prints the message but omits `extra`
    # LogRecord attributes. Render these fixed, sanitized fields into the message
    # as key=value pairs while retaining the attributes for structured handlers.
    rendered_fields = " ".join(f"{key}={json.dumps(value)}" for key, value in fields.items())
    logger.warning(
        "weather_assessment_unavailable %s",
        rendered_fields,
        extra={
            **fields,
        },
    )


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleCreate, db: DbSession, user_id: CurrentUser, routing: RoutingService, weather: WeatherService) -> Schedule:
    if payload.idempotency_key:
        existing = db.scalar(select(Schedule).where(
            Schedule.clerk_user_id == user_id,
            Schedule.idempotency_key == payload.idempotency_key,
        ))
        if existing is not None:
            return _calculate(existing)
    values = payload.model_dump()
    requested_title = values.pop("title")
    title = requested_title or _next_schedule_title(db, user_id)
    schedule = Schedule(clerk_user_id=user_id, title=title, normalized_title=_normalized_title(title), **values)
    if schedule.origin_location is not None and schedule.location is not None and schedule.travel_duration_minutes is None:
        _refresh_route(schedule, routing)
    _refresh_weather(schedule, weather)
    _calculate(schedule)
    db.add(schedule)
    try:
        _commit(db)
    except HTTPException as exc:
        if payload.idempotency_key:
            db.rollback()
            existing = db.scalar(select(Schedule).where(
                Schedule.clerk_user_id == user_id,
                Schedule.idempotency_key == payload.idempotency_key,
            ))
            if existing is not None:
                return _calculate(existing)
        if exc.status_code == status.HTTP_409_CONFLICT:
            raise
        raise
    try:
        db.refresh(schedule)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load saved schedule",
        ) from exc
    return schedule


@router.get("", response_model=list[ScheduleResponse])
def list_schedules(db: DbSession, user_id: CurrentUser) -> list[Schedule]:
    try:
        schedules = list(
            db.scalars(
                select(Schedule)
                .where(Schedule.clerk_user_id == user_id)
                .order_by(Schedule.created_at.desc(), Schedule.id.desc())
            ).all()
        )
        return [_calculate(item) for item in schedules]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="Unable to load schedules") from exc


@router.get("/{schedule_id}", response_model=ScheduleResponse)
def get_schedule(schedule_id: int, db: DbSession, user_id: CurrentUser) -> Schedule:
    try:
        return _calculate(_owned_schedule(db, schedule_id, user_id))
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="Unable to load schedule") from exc


@router.patch("/{schedule_id}", response_model=ScheduleResponse)
def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    db: DbSession,
    user_id: CurrentUser,
    routing: RoutingService,
    weather: WeatherService,
) -> Schedule:
    try:
        schedule = _owned_schedule(db, schedule_id, user_id)
        old_origin = schedule.origin_location
        old_destination = schedule.location
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(schedule, field, value)
        if "title" in payload.model_fields_set:
            schedule.normalized_title = _normalized_title(schedule.title)
        route_inputs_changed = schedule.origin_location != old_origin or schedule.location != old_destination
        duration_cleared = (
            "travel_duration_minutes" in payload.model_fields_set
            and payload.travel_duration_minutes is None
        )
        if route_inputs_changed or duration_cleared:
            _refresh_route(schedule, routing)
        elif (
            "travel_duration_minutes" in payload.model_fields_set
            and payload.travel_duration_minutes is not None
        ):
            # An explicit duration edit is a manual value, so old provider metadata
            # must not be presented as if it described that value.
            schedule.travel_estimate = None
        if route_inputs_changed or duration_cleared or "travel_duration_minutes" in payload.model_fields_set or "target_datetime" in payload.model_fields_set or "time_intent" in payload.model_fields_set:
            _refresh_weather(schedule, weather)
        _calculate(schedule)
        _commit(db)
        db.refresh(schedule)
        return schedule
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to update schedule") from exc


@router.post("/{schedule_id}/cancel", response_model=ScheduleResponse)
def cancel_schedule(schedule_id: int, db: DbSession, user_id: CurrentUser) -> Schedule:
    try:
        schedule = _owned_schedule(db, schedule_id, user_id)
        schedule.status = ScheduleStatus.CANCELLED
        _calculate(schedule)
        _commit(db)
        db.refresh(schedule)
        return schedule
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to cancel schedule") from exc


@router.post("/{schedule_id}/travel-estimate/refresh", response_model=ScheduleResponse)
def refresh_travel_estimate(
    schedule_id: int,
    db: DbSession,
    user_id: CurrentUser,
    routing: RoutingService,
    weather: WeatherService,
) -> Schedule:
    schedule = _owned_schedule(db, schedule_id, user_id)
    if schedule.origin_location is None or schedule.location is None:
        raise HTTPException(status_code=409, detail="Select an origin and destination before refreshing the route.")
    if schedule.status != ScheduleStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Only active schedules can refresh a route estimate.")
    try:
        attempt = reserve_attempt(db, user_id, schedule_id)
    except RouteRefreshRateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after)}) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to reserve a route refresh.") from exc

    original = (schedule.origin_location, schedule.location, schedule.target_datetime, schedule.time_intent)
    try:
        if routing is None:
            raise RoutingProviderConfigurationError
        estimate = _route_estimate(schedule, routing, diagnose_unnamed_traffic_sections=True)
    except (RoutingProviderError, RoutingProviderConfigurationError, ValueError) as exc:
        finish_attempt(db, attempt.id, "failed")
        raise HTTPException(status_code=502, detail="The route estimate could not be refreshed. Your saved estimate was kept.") from exc

    db.expire_all()
    schedule = _owned_schedule(db, schedule_id, user_id)
    current = (schedule.origin_location, schedule.location, schedule.target_datetime, schedule.time_intent)
    if current != original or schedule.status != ScheduleStatus.ACTIVE:
        finish_attempt(db, attempt.id, "failed")
        raise HTTPException(status_code=409, detail="The schedule changed during refresh. Your saved estimate was kept; refresh again.")
    current_attempt = db.get(RouteRefreshAttempt, attempt.id)
    if current_attempt is None or current_attempt.state != "in_progress":
        raise HTTPException(status_code=409, detail="The route refresh expired. Your saved estimate was kept; refresh again.")
    schedule.travel_estimate = estimate.model_dump(mode="json")
    schedule.travel_duration_minutes = estimate.duration_minutes
    _refresh_weather(schedule, weather)
    _calculate(schedule)
    current_attempt.state = "succeeded"
    _commit(db)
    db.refresh(schedule)
    return schedule
