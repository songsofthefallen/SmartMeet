from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import uuid
import logging

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from models import Base, Reminder, ReminderStatus, ReminderType, Schedule, ScheduleStatus, TimeIntent
from reminder_worker import (
    ClaimedReminder,
    RetryableProcessingError,
    WorkerSettings,
    claim_due_reminders,
    process_claim,
    run_worker,
)


def _setup():
    db_name = uuid.uuid4().hex
    engine = create_engine(f"sqlite:///file:{db_name}?mode=memory&cache=shared&uri=true", connect_args={"timeout": 10})
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def _add_reminder(factory, at: datetime, *, status=ScheduleStatus.ACTIVE) -> int:
    suffix = uuid.uuid4().hex[:10]
    with factory() as db:
        schedule = Schedule(
            clerk_user_id="worker_user", title=f"Worker test {suffix}", normalized_title=f"worker test {suffix}",
            time_intent=TimeIntent.DEPARTURE, target_datetime=at, timezone="Asia/Manila",
            preparation_duration_minutes=10, travel_duration_minutes=20,
            calculated_departure_time=at, calculated_wake_time=at - timedelta(minutes=10), status=status,
        )
        db.add(schedule)
        db.flush()
        reminder = Reminder(
            schedule_id=schedule.id, clerk_user_id=schedule.clerk_user_id,
            reminder_type=ReminderType.DEPARTURE, scheduled_for=at,
            timezone=schedule.timezone, status=ReminderStatus.PENDING,
        )
        db.add(reminder)
        db.commit()
        return reminder.id


def test_claims_due_but_not_future_reminders() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    due_id = _add_reminder(factory, now - timedelta(seconds=1))
    future_id = _add_reminder(factory, now + timedelta(seconds=1))
    claimed = claim_due_reminders(factory, worker_id="worker-a", now=now)
    assert [item.reminder_id for item in claimed] == [due_id]
    with factory() as db:
        future = db.get(Reminder, future_id)
        assert future is not None and future.claim_token is None


def test_claims_are_exclusive_between_concurrent_workers() -> None:
    _, factory = _setup()
    due_id = _add_reminder(factory, datetime.now(timezone.utc) - timedelta(seconds=1))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda worker: claim_due_reminders(factory, worker_id=worker, limit=1),
            ("worker-a", "worker-b"),
        ))
    claims = [claim for batch in results for claim in batch]
    assert sum(claim.reminder_id == due_id for claim in claims) == 1


def test_cancelled_or_obsolete_reminders_are_not_processed() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    cancelled_id = _add_reminder(factory, now - timedelta(minutes=1), status=ScheduleStatus.CANCELLED)
    obsolete_id = _add_reminder(factory, now - timedelta(minutes=1))
    with factory() as db:
        obsolete = db.get(Reminder, obsolete_id)
        assert obsolete is not None
        schedule = db.get(Schedule, obsolete.schedule_id)
        assert schedule is not None
        schedule.calculated_departure_time -= timedelta(minutes=2)
        db.commit()
    claims = claim_due_reminders(factory, worker_id="worker-a", now=now)
    assert {claim.reminder_id for claim in claims} == {cancelled_id, obsolete_id}
    called = []
    for claim in claims:
        assert process_claim(factory, claim, lambda message: called.append(message.id) or True, now=now) == "cancelled"
    assert called == []
    with factory() as db:
        assert db.get(Reminder, cancelled_id).status == ReminderStatus.CANCELLED
        assert db.get(Reminder, obsolete_id).status == ReminderStatus.CANCELLED


def test_expired_lease_is_reclaimed_and_stale_claim_cannot_finish() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    first = claim_due_reminders(factory, worker_id="worker-a", now=now, lease_seconds=5)[0]
    second = claim_due_reminders(factory, worker_id="worker-b", now=now + timedelta(seconds=6), lease_seconds=5)[0]
    assert second.reminder_id == reminder_id and second.claim_token != first.claim_token
    assert process_claim(factory, first, lambda _message: True, now=now + timedelta(seconds=6)) == "claim_lost"
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None and row.status == ReminderStatus.PENDING
        assert row.claim_token == second.claim_token


def test_temporary_failure_retries_then_is_bounded_and_error_is_sanitized() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    config = WorkerSettings(max_attempts=2, retry_base_seconds=3, retry_max_seconds=10)
    first = claim_due_reminders(factory, worker_id="worker-a", now=now)[0]

    def fail(_message):
        raise RetryableProcessingError("sensitive details should not persist")

    assert process_claim(factory, first, fail, now=now, settings=config) == "retry"
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None and row.status == ReminderStatus.PENDING
        assert row.next_attempt_at == (now + timedelta(seconds=3)).replace(tzinfo=None)
        assert "sensitive" not in row.last_error
    assert claim_due_reminders(factory, worker_id="worker-b", now=now + timedelta(seconds=2)) == []
    second = claim_due_reminders(factory, worker_id="worker-b", now=now + timedelta(seconds=3))[0]
    assert process_claim(factory, second, fail, now=now + timedelta(seconds=3), settings=config) == "failed"
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None and row.status == ReminderStatus.FAILED


def test_unconfigured_delivery_handler_retries_with_exponential_backoff_then_fails(caplog) -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    config = WorkerSettings(max_attempts=5, retry_base_seconds=15, retry_max_seconds=600)
    caplog.set_level(logging.WARNING, logger="reminder_worker")
    expected_delays = [15, 30, 60, 120]
    for attempt in range(1, config.max_attempts + 1):
        claim = claim_due_reminders(
            factory, worker_id="worker-default-handler", now=now, max_attempts=config.max_attempts,
        )[0]
        def temporary_provider_failure(_message):
            raise RetryableProcessingError("temporary provider failure")

        result = process_claim(factory, claim, temporary_provider_failure, now=now, settings=config)
        with factory() as db:
            row = db.get(Reminder, reminder_id)
            assert row is not None
            assert row.attempt_count == attempt
            if attempt < config.max_attempts:
                assert result == "retry"
                delay = expected_delays[attempt - 1]
                assert row.next_attempt_at == (now + timedelta(seconds=delay)).replace(tzinfo=None)
                now += timedelta(seconds=delay)
            else:
                assert result == "failed"
                assert row.status == ReminderStatus.FAILED
                assert row.next_attempt_at is None
                assert row.last_error == "RetryableProcessingError:processing_failed"
    assert "error_type=RetryableProcessingError" in caplog.text


def test_crash_after_final_claim_becomes_failed_when_lease_expires() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    max_attempts = 2
    claim_due_reminders(factory, worker_id="worker-one", now=now, lease_seconds=2, max_attempts=max_attempts)
    second = claim_due_reminders(
        factory, worker_id="worker-two", now=now + timedelta(seconds=3), lease_seconds=2,
        max_attempts=max_attempts,
    )
    assert len(second) == 1
    exhausted = claim_due_reminders(
        factory, worker_id="worker-three", now=now + timedelta(seconds=6), lease_seconds=2,
        max_attempts=max_attempts,
    )
    assert exhausted == []
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None
        assert row.status == ReminderStatus.FAILED
        assert row.attempt_count == max_attempts
        assert row.last_error == "RetryLimit:claim_expired"


def test_only_confirmed_handler_marks_sent() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    claim = claim_due_reminders(factory, worker_id="worker-a", now=now)[0]
    assert process_claim(factory, claim, lambda _message: True, now=now) == "sent"
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None and row.status == ReminderStatus.SENT and row.sent_at == now.replace(tzinfo=None)


def test_crash_recovery_reclaims_after_lease_and_attempt_is_counted() -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    reminder_id = _add_reminder(factory, now - timedelta(minutes=1))
    claim_due_reminders(factory, worker_id="worker-crashed", now=now, lease_seconds=2)
    recovered = claim_due_reminders(factory, worker_id="worker-restarted", now=now + timedelta(seconds=3), lease_seconds=2)
    assert len(recovered) == 1 and recovered[0].reminder_id == reminder_id
    with factory() as db:
        row = db.get(Reminder, reminder_id)
        assert row is not None and row.attempt_count == 2


def test_worker_logs_start_database_connection_and_polling(caplog) -> None:
    _, factory = _setup()
    caplog.set_level(logging.INFO, logger="reminder_worker")
    run_worker(factory, lambda _message: True, stop=lambda: True)
    messages = [record.getMessage() for record in caplog.records]
    assert any("Reminder worker starting" in message for message in messages)
    assert "Reminder worker connected to database" in messages
    assert "Reminder worker polling for due reminders" in messages


def test_database_connection_error_is_logged_without_exception_details(caplog) -> None:
    caplog.set_level(logging.ERROR, logger="reminder_worker")

    def unavailable_factory():
        raise RuntimeError("private host and credentials")

    try:
        run_worker(unavailable_factory, lambda _message: True, stop=lambda: True)
    except RuntimeError:
        pass
    else:
        raise AssertionError("database connection failure should propagate")
    assert "error_type=RuntimeError" in caplog.text
    assert "private host and credentials" not in caplog.text


def test_expired_lease_recovery_is_logged(caplog) -> None:
    _, factory = _setup()
    now = datetime(2026, 11, 1, tzinfo=timezone.utc)
    _add_reminder(factory, now - timedelta(minutes=1))
    claim_due_reminders(factory, worker_id="worker-a", now=now, lease_seconds=2)
    caplog.set_level(logging.INFO, logger="reminder_worker")
    claim_due_reminders(factory, worker_id="worker-b", now=now + timedelta(seconds=3), lease_seconds=2)
    assert "Recovered expired reminder claims count=1" in caplog.text


def test_unexpected_handler_errors_are_logged_without_raw_error(caplog, monkeypatch) -> None:
    _, factory = _setup()
    now = datetime.now(timezone.utc)
    _add_reminder(factory, now - timedelta(minutes=1))
    caplog.set_level(logging.ERROR, logger="reminder_worker")

    monkeypatch.setattr("reminder_worker.process_claim", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("private user payload")))
    checks = 0

    def stop_after_one_batch() -> bool:
        nonlocal checks
        checks += 1
        return checks > 2

    run_worker(factory, lambda _message: True, stop=stop_after_one_batch)
    assert "error_type=ValueError" in caplog.text
    assert "private user payload" not in caplog.text


def test_polling_error_is_logged_and_propagated(caplog, monkeypatch) -> None:
    _, factory = _setup()
    caplog.set_level(logging.ERROR, logger="reminder_worker")
    monkeypatch.setattr("reminder_worker.claim_due_reminders", lambda *_args, **_kwargs: (_ for _ in ()).throw(ConnectionError("private DB endpoint")))
    try:
        run_worker(factory, lambda _message: True, stop=lambda: False)
    except ConnectionError:
        pass
    else:
        raise AssertionError("unexpected poll error should propagate")
    assert "Reminder worker polling error error_type=ConnectionError" in caplog.text
    assert "private DB endpoint" not in caplog.text
