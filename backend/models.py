"""SQLAlchemy models for persisted application data."""

import hashlib
import json
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, CheckConstraint, DateTime, Enum as SqlEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, event, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base metadata shared by application models and Alembic."""


class TimeIntent(str, Enum):
    ARRIVAL = "arrival"
    DEPARTURE = "departure"


class ScheduleStatus(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class ReminderStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    CANCELLED = "cancelled"
    FAILED = "failed"


class ReminderType(str, Enum):
    WAKE = "wake"
    DEPARTURE = "departure"


class PushSubscription(Base):
    """User-owned Web Push registration; subscription payload is encrypted."""

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint_hash", name="uq_push_subscriptions_endpoint_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    endpoint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_subscription: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp())


class SavedPlace(Base):
    """A confirmed location snapshot saved by a Clerk user."""

    __tablename__ = "saved_places"
    __table_args__ = (
        Index("ix_saved_places_user_alias", "clerk_user_id", "alias"),
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_saved_places_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_saved_places_longitude"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    alias: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    latitude: Mapped[float] = mapped_column(nullable=False)
    longitude: Mapped[float] = mapped_column(nullable=False)
    formatted_address: Mapped[str | None] = mapped_column(String(500))
    locality: Mapped[str | None] = mapped_column(String(120))
    region: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(120))
    timezone: Mapped[str | None] = mapped_column(String(64))
    location_source: Mapped[str] = mapped_column(String(32), nullable=False, default="tomtom_search")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp())


class Schedule(Base):
    """A schedule owned by a Clerk user."""

    __tablename__ = "schedules"
    __table_args__ = (
        CheckConstraint(
            "preparation_duration_minutes IS NULL OR preparation_duration_minutes >= 0",
            name="ck_schedules_preparation_nonnegative",
        ),
        CheckConstraint(
            "travel_duration_minutes IS NULL OR travel_duration_minutes >= 0",
            name="ck_schedules_travel_nonnegative",
        ),
        CheckConstraint("time_intent IN ('arrival', 'departure')", name="timeintent"),
        CheckConstraint(
            "status IN ('active', 'cancelled', 'completed')", name="schedulestatus"
        ),
        Index("ix_schedules_user_status", "clerk_user_id", "status"),
        UniqueConstraint("clerk_user_id", "idempotency_key", name="uq_schedules_user_idempotency"),
        UniqueConstraint("clerk_user_id", "normalized_title", name="uq_schedules_user_normalized_title"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    origin_location: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    travel_estimate: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    weather_estimate: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    route_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    route_location_signature: Mapped[str | None] = mapped_column(String(64), nullable=True)
    time_intent: Mapped[TimeIntent] = mapped_column(
        SqlEnum(
            TimeIntent,
            native_enum=False,
            create_constraint=False,
            length=10,
            values_callable=lambda enum_type: [member.value for member in enum_type],
        ),
    )
    target_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    preparation_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    travel_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calculated_departure_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    calculated_arrival_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    calculated_wake_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[ScheduleStatus] = mapped_column(
        SqlEnum(
            ScheduleStatus,
            native_enum=False,
            create_constraint=False,
            length=10,
            values_callable=lambda enum_type: [member.value for member in enum_type],
        ),
        nullable=False,
        default=ScheduleStatus.ACTIVE,
        server_default=ScheduleStatus.ACTIVE.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    @property
    def route_availability(self) -> str | None:
        if (
            self.route_status == "no_drivable_route"
            and self.route_location_signature == location_pair_signature(self.origin_location, self.location)
        ):
            return "no_drivable_route"
        return None


def location_pair_signature(origin: dict | None, destination: dict | None) -> str | None:
    """Hash the selected pair so a stored no-route result cannot outlive location edits."""
    if not isinstance(origin, dict) or not isinstance(destination, dict):
        return None
    encoded = json.dumps([origin, destination], sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class Reminder(Base):
    """Durable queue entry for scheduled wake and departure notifications."""

    __tablename__ = "reminders"
    __table_args__ = (
        UniqueConstraint("schedule_id", "reminder_type", "scheduled_for", name="uq_reminders_schedule_type_time"),
        Index("ix_reminders_status_scheduled_for", "status", "scheduled_for"),
        CheckConstraint("attempt_count >= 0", name="ck_reminders_attempt_nonnegative"),
        CheckConstraint("status IN ('pending', 'sent', 'cancelled', 'failed')", name="reminderstatus"),
        CheckConstraint("reminder_type IN ('wake', 'departure')", name="remindertype"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    reminder_type: Mapped[ReminderType] = mapped_column(String(16), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[ReminderStatus] = mapped_column(String(16), nullable=False, default=ReminderStatus.PENDING)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    claim_token: Mapped[str | None] = mapped_column(String(36))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp())


class RouteRefreshAttempt(Base):
    __tablename__ = "route_refresh_attempts"
    __table_args__ = (
        Index("ix_route_refresh_user_attempted", "clerk_user_id", "attempted_at"),
        Index("ix_route_refresh_schedule_attempted", "schedule_id", "attempted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    state: Mapped[str] = mapped_column(String(12), nullable=False)


class RouteRefreshUserLock(Base):
    __tablename__ = "route_refresh_user_locks"

    clerk_user_id: Mapped[str] = mapped_column(String(255), primary_key=True)


class ScheduleNameCounter(Base):
    """Transactional per-user sequence for backend-generated schedule names."""

    __tablename__ = "schedule_name_counters"

    clerk_user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    next_number: Mapped[int] = mapped_column(Integer, nullable=False)


@event.listens_for(Schedule, "before_insert")
def _set_normalized_schedule_title(_mapper, _connection, target: Schedule) -> None:
    """Keep ORM-created schedules consistent with the unique name key."""
    normalized = target.title.strip().casefold()
    if len(normalized) > 200:
        raise ValueError("Schedule title is too long after normalization")
    target.normalized_title = normalized
