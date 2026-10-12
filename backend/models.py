"""SQLAlchemy models for persisted application data."""

from datetime import datetime
from enum import Enum

from sqlalchemy import CheckConstraint, DateTime, Enum as SqlEnum, Index, Integer, String, Text, UniqueConstraint, func
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
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
