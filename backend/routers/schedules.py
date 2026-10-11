"""Authenticated schedule endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from main import verify_clerk_token
from models import Schedule, ScheduleStatus
from schemas import ScheduleCreate, ScheduleResponse, ScheduleUpdate
from time_calculation import CalculationSettings, recalculate_schedule


router = APIRouter(prefix="/schedules", tags=["schedules"])
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[str, Depends(verify_clerk_token)]


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
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save schedule",
        ) from exc


def _calculate(schedule: Schedule) -> Schedule:
    recalculate_schedule(schedule, CalculationSettings.from_env())
    return schedule


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
def create_schedule(payload: ScheduleCreate, db: DbSession, user_id: CurrentUser) -> Schedule:
    schedule = _calculate(Schedule(clerk_user_id=user_id, **payload.model_dump()))
    db.add(schedule)
    _commit(db)
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
                .order_by(Schedule.target_datetime, Schedule.id)
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
) -> Schedule:
    try:
        schedule = _owned_schedule(db, schedule_id, user_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(schedule, field, value)
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
