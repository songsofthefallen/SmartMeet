"""Standalone database-backed reminder worker with Web Push delivery."""

from __future__ import annotations

import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import or_, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from database import get_session_factory
from models import Reminder, ReminderStatus, ReminderType, Schedule, ScheduleStatus

logger = logging.getLogger("reminder_worker")


class RetryableProcessingError(Exception):
    """A handler failed temporarily; the queue may try again."""


class PermanentProcessingError(Exception):
    """A handler determined this reminder cannot be processed."""


@dataclass(frozen=True)
class ClaimedReminder:
    reminder_id: int
    claim_token: str


@dataclass(frozen=True)
class ReminderMessage:
    id: int
    schedule_id: int
    clerk_user_id: str
    reminder_type: ReminderType
    scheduled_for: datetime
    timezone: str
    attempt_count: int
    title: str = ""
    destination: str | None = None
    target_datetime: datetime | None = None
    time_intent: str = "arrival"
    preparation_duration_minutes: int | None = None
    travel_duration_minutes: int | None = None
    departure_datetime: datetime | None = None
    arrival_datetime: datetime | None = None


ReminderHandler = Callable[[ReminderMessage], bool]


@dataclass(frozen=True)
class WorkerSettings:
    poll_seconds: float = 2.0
    batch_size: int = 20
    lease_seconds: int = 60
    max_attempts: int = 5
    retry_base_seconds: int = 15
    retry_max_seconds: int = 600

    def __post_init__(self) -> None:
        if self.poll_seconds <= 0 or self.batch_size <= 0 or self.lease_seconds <= 0:
            raise ValueError("poll interval, batch size, and lease must be positive")
        if self.max_attempts <= 0 or self.retry_base_seconds <= 0 or self.retry_max_seconds <= 0:
            raise ValueError("retry settings must be positive")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def claim_due_reminders(
    session_factory: sessionmaker[Session],
    *,
    worker_id: str,
    now: datetime | None = None,
    lease_seconds: int = 60,
    limit: int = 20,
    max_attempts: int = 5,
) -> list[ClaimedReminder]:
    """Atomically claim due rows; MySQL SKIP LOCKED allows parallel workers."""
    if not worker_id or len(worker_id) > 100 or lease_seconds <= 0 or limit <= 0 or max_attempts <= 0:
        raise ValueError("invalid worker claim settings")
    instant = _utc(now or datetime.now(timezone.utc))
    claimed: list[ClaimedReminder] = []
    with session_factory() as db:
        try:
            if db.get_bind().dialect.name == "sqlite":
                # SQLite has no SELECT FOR UPDATE; acquire its write reservation
                # before selecting so tests and local single-host workers serialize.
                for attempt in range(50):
                    try:
                        db.connection().exec_driver_sql("BEGIN IMMEDIATE")
                        break
                    except OperationalError as exc:
                        db.rollback()
                        if "locked" not in str(exc).lower() or attempt == 49:
                            raise
                        time.sleep(0.02)
            candidates = list(db.scalars(
                select(Reminder)
                .where(
                    Reminder.status == ReminderStatus.PENDING,
                    Reminder.scheduled_for <= instant,
                    or_(Reminder.next_attempt_at.is_(None), Reminder.next_attempt_at <= instant),
                    or_(Reminder.lease_expires_at.is_(None), Reminder.lease_expires_at <= instant),
                )
                .order_by(Reminder.scheduled_for, Reminder.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ))
            recovered_count = 0
            exhausted_count = 0
            for reminder in candidates:
                if reminder.attempt_count >= max_attempts:
                    reminder.status = ReminderStatus.FAILED
                    reminder.last_error = "RetryLimit:claim_expired"
                    reminder.next_attempt_at = None
                    _clear_claim(reminder)
                    exhausted_count += 1
                    continue
                if reminder.lease_expires_at is not None and _utc(reminder.lease_expires_at) <= instant:
                    recovered_count += 1
                token = str(uuid.uuid4())
                reminder.claim_token = token
                reminder.lease_expires_at = instant + timedelta(seconds=lease_seconds)
                reminder.attempt_count += 1
                claimed.append(ClaimedReminder(reminder.id, token))
            db.commit()
            if recovered_count:
                logger.info("Recovered expired reminder claims count=%d", recovered_count)
            if exhausted_count:
                logger.warning("Expired reminder claims exhausted retries count=%d", exhausted_count)
            if claimed:
                logger.debug("Claimed %d due reminders worker_id=%s", len(claimed), worker_id)
        except Exception:
            db.rollback()
            raise
    return claimed


def _is_current(db: Session, reminder: Reminder, now: datetime) -> bool:
    schedule = db.get(Schedule, reminder.schedule_id)
    if schedule is None or schedule.status != ScheduleStatus.ACTIVE:
        return False
    if schedule.timezone != reminder.timezone:
        return False
    expected = (
        schedule.calculated_wake_time
        if reminder.reminder_type == ReminderType.WAKE
        else schedule.calculated_departure_time
    )
    return expected is not None and _utc(expected) == _utc(reminder.scheduled_for) and _utc(reminder.scheduled_for) <= now


def _clear_claim(reminder: Reminder) -> None:
    reminder.claim_token = None
    reminder.lease_expires_at = None


def _destination_label(location: dict | None) -> str | None:
    if not isinstance(location, dict):
        return None
    parts = [location.get(key) for key in ("name", "locality", "region")]
    labels = list(dict.fromkeys(value.strip() for value in parts if isinstance(value, str) and value.strip()))
    return ", ".join(labels)[:250] or None


def _safe_error(exc: Exception) -> str:
    # Never store provider/user exception text; it can contain payloads or secrets.
    kind = type(exc).__name__
    allowed = {"TimeoutError", "ConnectionError", "OSError", "RetryableProcessingError", "PermanentProcessingError"}
    return f"{kind}:processing_failed" if kind in allowed else "ProcessingError:processing_failed"


def process_claim(
    session_factory: sessionmaker[Session],
    claim: ClaimedReminder,
    handler: ReminderHandler,
    *,
    now: datetime | None = None,
    settings: WorkerSettings | None = None,
) -> str:
    """Validate, invoke the handler, then persist confirmed or retry state."""
    config = settings or WorkerSettings()
    instant = _utc(now or datetime.now(timezone.utc))
    with session_factory() as db:
        reminder = db.scalar(select(Reminder).where(Reminder.id == claim.reminder_id).with_for_update())
        if reminder is None or reminder.status != ReminderStatus.PENDING or reminder.claim_token != claim.claim_token:
            db.rollback()
            return "claim_lost"
        if reminder.lease_expires_at is None or _utc(reminder.lease_expires_at) <= instant:
            db.rollback()
            return "lease_expired"
        if not _is_current(db, reminder, instant):
            reminder.status = ReminderStatus.CANCELLED
            _clear_claim(reminder)
            reminder.next_attempt_at = None
            db.commit()
            return "cancelled"
        schedule = db.get(Schedule, reminder.schedule_id)
        if schedule is None:
            reminder.status = ReminderStatus.CANCELLED
            _clear_claim(reminder)
            reminder.next_attempt_at = None
            db.commit()
            return "cancelled"
        message = ReminderMessage(
            id=reminder.id,
            schedule_id=reminder.schedule_id,
            clerk_user_id=reminder.clerk_user_id,
            reminder_type=ReminderType(reminder.reminder_type),
            scheduled_for=_utc(reminder.scheduled_for),
            timezone=reminder.timezone,
            attempt_count=reminder.attempt_count,
            title=schedule.title,
            destination=_destination_label(schedule.location),
            target_datetime=_utc(schedule.target_datetime),
            time_intent=schedule.time_intent.value,
            preparation_duration_minutes=schedule.preparation_duration_minutes,
            travel_duration_minutes=schedule.travel_duration_minutes,
            departure_datetime=_utc(schedule.calculated_departure_time) if schedule.calculated_departure_time else None,
            arrival_datetime=_utc(schedule.calculated_arrival_time) if schedule.calculated_arrival_time else None,
        )

    try:
        confirmed = handler(message)
        if confirmed is not True:
            raise RetryableProcessingError("delivery not confirmed")
    except Exception as exc:
        with session_factory() as db:
            reminder = db.scalar(select(Reminder).where(Reminder.id == claim.reminder_id).with_for_update())
            if reminder is None or reminder.status != ReminderStatus.PENDING or reminder.claim_token != claim.claim_token:
                db.rollback()
                return "claim_lost"
            if not isinstance(exc, RetryableProcessingError) and not isinstance(exc, PermanentProcessingError):
                retryable = isinstance(exc, (TimeoutError, ConnectionError, OSError))
            else:
                retryable = isinstance(exc, RetryableProcessingError)
            reminder.last_error = _safe_error(exc)
            _clear_claim(reminder)
            if retryable and reminder.attempt_count < config.max_attempts:
                delay = min(config.retry_base_seconds * (2 ** (reminder.attempt_count - 1)), config.retry_max_seconds)
                reminder.next_attempt_at = instant + timedelta(seconds=delay)
                db.commit()
                logger.warning(
                    "Reminder processing will retry attempt=%d error_type=%s",
                    reminder.attempt_count,
                    type(exc).__name__ if type(exc).__name__ in {"TimeoutError", "ConnectionError", "OSError", "RetryableProcessingError"} else "ProcessingError",
                )
                return "retry"
            reminder.status = ReminderStatus.FAILED
            reminder.next_attempt_at = None
            db.commit()
            logger.error(
                "Reminder processing exhausted retries attempt=%d error_type=%s",
                reminder.attempt_count,
                type(exc).__name__ if type(exc).__name__ in {"TimeoutError", "ConnectionError", "OSError", "RetryableProcessingError", "PermanentProcessingError"} else "ProcessingError",
            )
            return "failed"

    with session_factory() as db:
        reminder = db.scalar(select(Reminder).where(Reminder.id == claim.reminder_id).with_for_update())
        if reminder is None or reminder.status != ReminderStatus.PENDING or reminder.claim_token != claim.claim_token:
            db.rollback()
            return "claim_lost"
        # A schedule may have been edited while the handler ran. Never finalize stale work.
        if not _is_current(db, reminder, instant):
            reminder.status = ReminderStatus.CANCELLED
            _clear_claim(reminder)
            reminder.next_attempt_at = None
            db.commit()
            return "cancelled"
        reminder.status = ReminderStatus.SENT
        reminder.sent_at = instant
        reminder.last_error = None
        reminder.next_attempt_at = None
        _clear_claim(reminder)
        db.commit()
        return "sent"


def run_worker(
    session_factory: sessionmaker[Session],
    handler: ReminderHandler,
    *,
    settings: WorkerSettings | None = None,
    stop: Callable[[], bool] | None = None,
) -> None:
    config = settings or WorkerSettings()
    worker_id = f"worker-{uuid.uuid4()}"
    should_stop = stop or (lambda: False)
    logger.info("Reminder worker starting poll_seconds=%s batch_size=%d", config.poll_seconds, config.batch_size)
    try:
        with session_factory() as db:
            db.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error("Reminder worker database connection failed error_type=%s", type(exc).__name__)
        raise
    logger.info("Reminder worker connected to database")
    logger.info("Reminder worker polling for due reminders")
    while not should_stop():
        try:
            claims = claim_due_reminders(
                session_factory,
                worker_id=worker_id,
                lease_seconds=config.lease_seconds,
                limit=config.batch_size,
                max_attempts=config.max_attempts,
            )
        except Exception as exc:
            logger.error("Reminder worker polling error error_type=%s", type(exc).__name__)
            raise
        for claim in claims:
            if should_stop():
                break
            try:
                process_claim(session_factory, claim, handler, settings=config)
            except Exception as exc:
                logger.error("Reminder worker processing error error_type=%s", type(exc).__name__)
        if not claims:
            time.sleep(config.poll_seconds)


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    poll = float(os.getenv("REMINDER_WORKER_POLL_SECONDS", "2"))
    from push_service import PushConfigurationError, WebPushDelivery, validate_push_configuration

    try:
        validate_push_configuration()
    except PushConfigurationError as exc:
        logger.error("Reminder worker push configuration invalid: %s", exc)
        raise SystemExit(2) from exc

    factory = get_session_factory()
    run_worker(factory, WebPushDelivery(factory), settings=WorkerSettings(poll_seconds=poll))


if __name__ == "__main__":
    main()
