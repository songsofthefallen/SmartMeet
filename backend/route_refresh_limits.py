"""Database-backed route refresh limits shared by application workers."""

from datetime import datetime, timedelta, timezone
from math import ceil
from threading import Lock

from sqlalchemy import delete, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from models import RouteRefreshAttempt, RouteRefreshUserLock

PER_SCHEDULE_COOLDOWN = timedelta(seconds=60)
USER_WINDOW = timedelta(minutes=15)
USER_LIMIT = 10
IN_PROGRESS_LEASE = timedelta(seconds=30)

_locks_guard = Lock()
_user_locks: dict[str, Lock] = {}


class RouteRefreshRateLimited(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = max(1, retry_after)


def _retry_seconds(until: datetime, now: datetime) -> int:
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return max(1, ceil((until - now).total_seconds()))


def _process_lock(user_id: str) -> Lock:
    with _locks_guard:
        return _user_locks.setdefault(user_id, Lock())


def reserve_attempt(db: Session, user_id: str, schedule_id: int, now: datetime | None = None) -> RouteRefreshAttempt:
    """Atomically count and reserve an attempt before calling the route provider."""
    now = now or datetime.now(timezone.utc)
    with _process_lock(user_id):
        try:
            # The per-user row lock serializes the rolling-window count across workers.
            values = {"clerk_user_id": user_id}
            if db.bind is not None and db.bind.dialect.name == "mysql":
                statement = mysql_insert(RouteRefreshUserLock).values(**values).prefix_with("IGNORE")
            else:
                statement = sqlite_insert(RouteRefreshUserLock).values(**values).on_conflict_do_nothing()
            db.execute(statement)
            db.flush()
            db.scalar(
                select(RouteRefreshUserLock)
                .where(RouteRefreshUserLock.clerk_user_id == user_id)
                .with_for_update()
            )

            window_start = now - USER_WINDOW
            db.execute(delete(RouteRefreshAttempt).where(
                RouteRefreshAttempt.clerk_user_id == user_id,
                RouteRefreshAttempt.attempted_at < window_start,
            ))
            attempts = list(db.scalars(select(RouteRefreshAttempt).where(
                RouteRefreshAttempt.clerk_user_id == user_id,
                RouteRefreshAttempt.attempted_at >= window_start,
            )).all())
            if len(attempts) >= USER_LIMIT:
                oldest = min(attempt.attempted_at for attempt in attempts)
                if oldest.tzinfo is None:
                    oldest = oldest.replace(tzinfo=timezone.utc)
                raise RouteRefreshRateLimited(
                    "You have reached the limit of 10 route refresh attempts in 15 minutes.",
                    _retry_seconds(oldest + USER_WINDOW, now),
                )

            schedule_attempts = [item for item in attempts if item.schedule_id == schedule_id]
            latest = max(schedule_attempts, key=lambda item: item.attempted_at, default=None)
            if latest is not None:
                attempted_at = latest.attempted_at
                if attempted_at.tzinfo is None:
                    attempted_at = attempted_at.replace(tzinfo=timezone.utc)
                available_at = attempted_at + PER_SCHEDULE_COOLDOWN
                if now < available_at:
                    raise RouteRefreshRateLimited(
                        "This schedule can be refreshed once every 60 seconds.",
                        _retry_seconds(available_at, now),
                    )
            active = next((item for item in reversed(schedule_attempts) if item.state == "in_progress"), None)
            if active is not None:
                attempted_at = active.attempted_at
                if attempted_at.tzinfo is None:
                    attempted_at = attempted_at.replace(tzinfo=timezone.utc)
                lease_end = attempted_at + IN_PROGRESS_LEASE
                if now < lease_end:
                    raise RouteRefreshRateLimited(
                        "A route refresh for this schedule is already running.",
                        _retry_seconds(lease_end, now),
                    )
                active.state = "failed"

            attempt = RouteRefreshAttempt(
                clerk_user_id=user_id,
                schedule_id=schedule_id,
                attempted_at=now,
                state="in_progress",
            )
            db.add(attempt)
            db.commit()
            db.refresh(attempt)
            return attempt
        except RouteRefreshRateLimited:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise


def finish_attempt(db: Session, attempt_id: int, state: str) -> bool:
    attempt = db.get(RouteRefreshAttempt, attempt_id)
    if attempt is None or attempt.state != "in_progress":
        return False
    attempt.state = state
    db.commit()
    return True
