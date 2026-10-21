from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from models import Base, Reminder, ReminderStatus, ReminderType, Schedule, ScheduleStatus, TimeIntent
from reminder_service import sync_schedule_reminders


def _schedule(session: Session) -> Schedule:
    schedule = Schedule(
        clerk_user_id="user_1", title="Trip", normalized_title="trip", time_intent=TimeIntent.DEPARTURE,
        target_datetime=datetime(2026, 11, 2, 14, tzinfo=timezone.utc), timezone="Asia/Manila",
        preparation_duration_minutes=30, travel_duration_minutes=45,
        calculated_departure_time=datetime(2026, 11, 2, 14, tzinfo=timezone.utc),
        calculated_wake_time=datetime(2026, 11, 2, 13, 30, tzinfo=timezone.utc),
    )
    session.add(schedule)
    session.flush()
    return schedule


def test_creates_utc_reminders_and_repeated_sync_is_idempotent() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with Session(engine) as session:
        schedule = _schedule(session)
        sync_schedule_reminders(schedule, session, now)
        sync_schedule_reminders(schedule, session, now)
        rows = list(session.scalars(select(Reminder).order_by(Reminder.reminder_type)))
        assert len(rows) == 2
        assert {row.reminder_type for row in rows} == {ReminderType.WAKE, ReminderType.DEPARTURE}
        assert all(row.status == ReminderStatus.PENDING and row.timezone == "Asia/Manila" for row in rows)
        assert all(row.scheduled_for.tzinfo is None or row.scheduled_for.utcoffset() == timedelta(0) for row in rows)


def test_edit_cancels_old_pending_and_adds_new_instants_and_cancel_cancels_all() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with Session(engine) as session:
        schedule = _schedule(session)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        schedule.timezone = "America/New_York"
        schedule.calculated_departure_time += timedelta(hours=1)
        schedule.calculated_wake_time += timedelta(hours=1)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        rows = list(session.scalars(select(Reminder)))
        assert sum(row.status == ReminderStatus.CANCELLED for row in rows) == 2
        assert sum(row.status == ReminderStatus.PENDING for row in rows) == 2
        assert {row.timezone for row in rows if row.status == ReminderStatus.PENDING} == {"America/New_York"}
        schedule.status = ScheduleStatus.CANCELLED
        sync_schedule_reminders(schedule, session, now)
        assert all(row.status == ReminderStatus.CANCELLED for row in session.scalars(select(Reminder)))


def test_sent_reminder_is_never_requeued_for_same_trigger() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with Session(engine) as session:
        schedule = _schedule(session)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        wake = session.scalar(select(Reminder).where(Reminder.reminder_type == ReminderType.WAKE))
        assert wake is not None
        wake.status = ReminderStatus.SENT
        wake.sent_at = now
        sync_schedule_reminders(schedule, session, now)
        assert wake.status == ReminderStatus.SENT
        assert session.scalar(select(Reminder).where(Reminder.reminder_type == ReminderType.WAKE)) is wake


def test_failed_reminder_stays_failed_on_unrelated_sync_but_new_trigger_is_scheduled() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with Session(engine) as session:
        schedule = _schedule(session)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        wake = session.scalar(select(Reminder).where(Reminder.reminder_type == ReminderType.WAKE))
        assert wake is not None
        wake.status = ReminderStatus.FAILED
        wake.last_error = "PermanentProcessingError:processing_failed"

        # An unrelated title/edit sync must not restart a permanent failure.
        schedule.title = "Renamed trip"
        sync_schedule_reminders(schedule, session, now)
        assert wake.status == ReminderStatus.FAILED
        assert wake.last_error == "PermanentProcessingError:processing_failed"

        # A genuinely changed trigger is a distinct reminder and is eligible.
        schedule.calculated_wake_time += timedelta(minutes=5)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        rows = list(session.scalars(select(Reminder).where(Reminder.reminder_type == ReminderType.WAKE)))
        assert sum(row.status == ReminderStatus.FAILED for row in rows) == 1
        assert sum(row.status == ReminderStatus.PENDING for row in rows) == 1


def test_fall_back_dst_repeated_wall_clock_keeps_distinct_utc_triggers() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 10, 31, tzinfo=timezone.utc)
    eastern = ZoneInfo("America/New_York")
    first_130 = datetime(2026, 11, 1, 1, 30, tzinfo=eastern, fold=0)
    second_130 = datetime(2026, 11, 1, 1, 30, tzinfo=eastern, fold=1)
    with Session(engine) as session:
        schedule = _schedule(session)
        schedule.timezone = "America/New_York"
        schedule.calculated_departure_time = first_130
        schedule.calculated_wake_time = first_130 - timedelta(minutes=30)
        sync_schedule_reminders(schedule, session, now)
        session.flush()

        schedule.calculated_departure_time = second_130
        schedule.calculated_wake_time = second_130 - timedelta(minutes=30)
        sync_schedule_reminders(schedule, session, now)
        session.flush()
        departures = list(session.scalars(select(Reminder).where(Reminder.reminder_type == ReminderType.DEPARTURE)))
        assert len(departures) == 2
        assert {row.status for row in departures} == {ReminderStatus.CANCELLED, ReminderStatus.PENDING}
        utc_instants = {row.scheduled_for.replace(tzinfo=timezone.utc) for row in departures}
        assert len(utc_instants) == 2
        assert utc_instants == {first_130.astimezone(timezone.utc), second_130.astimezone(timezone.utc)}
