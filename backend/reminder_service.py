"""Persistence rules for the database-backed reminder queue."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Reminder, ReminderStatus, ReminderType, Schedule, ScheduleStatus


def sync_schedule_reminders(schedule: Schedule, db: Session, now: datetime | None = None) -> None:
    """Keep future wake/departure reminder rows aligned in the schedule transaction."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)
    wanted: dict[tuple[ReminderType, datetime], None] = {}
    if schedule.status == ScheduleStatus.ACTIVE:
        for kind, value in (
            (ReminderType.WAKE, schedule.calculated_wake_time),
            (ReminderType.DEPARTURE, schedule.calculated_departure_time),
        ):
            if value is None:
                continue
            if value.tzinfo is None or value.utcoffset() is None:
                value = value.replace(tzinfo=timezone.utc)
            value = value.astimezone(timezone.utc)
            if value > current:
                wanted[(kind, value)] = None

    rows = list(db.scalars(select(Reminder).where(Reminder.schedule_id == schedule.id))) if schedule.id is not None else []
    existing = {(row.reminder_type, _utc(row.scheduled_for)): row for row in rows}
    for row in rows:
        if row.status == ReminderStatus.PENDING and (row.reminder_type, _utc(row.scheduled_for)) not in wanted:
            row.status = ReminderStatus.CANCELLED
    for kind, scheduled_for in wanted:
        row = existing.get((kind, scheduled_for))
        if row is None:
            db.add(Reminder(
                schedule_id=schedule.id,
                clerk_user_id=schedule.clerk_user_id,
                reminder_type=kind,
                scheduled_for=scheduled_for,
                timezone=schedule.timezone,
                status=ReminderStatus.PENDING,
            ))
        elif row.status in (ReminderStatus.PENDING, ReminderStatus.CANCELLED, ReminderStatus.FAILED):
            row.status = ReminderStatus.PENDING
            row.timezone = schedule.timezone
            row.last_error = None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
