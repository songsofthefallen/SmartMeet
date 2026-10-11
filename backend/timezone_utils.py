"""Shared IANA timezone and local wall-clock validation helpers."""

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class InvalidLocalDateTime(ValueError):
    """A local wall-clock time does not exist in the requested timezone."""


class AmbiguousLocalDateTime(ValueError):
    """A local wall-clock time maps to more than one instant."""


def get_iana_timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("timezone must be a valid IANA timezone") from exc


def resolve_local_datetime(target_date: date, target_time: time, timezone_name: str) -> datetime:
    """Resolve a local date/time to UTC, rejecting DST gaps and repeated times."""
    if target_time.utcoffset() is not None:
        raise ValueError("target_time_local must not include a UTC offset")

    zone = get_iana_timezone(timezone_name)
    wall_clock = datetime.combine(target_date, target_time)
    candidates: set[datetime] = set()
    for fold in (0, 1):
        zoned = wall_clock.replace(tzinfo=zone, fold=fold)
        instant = zoned.astimezone(timezone.utc)
        round_trip = instant.astimezone(zone).replace(tzinfo=None)
        if round_trip == wall_clock:
            candidates.add(instant)

    if not candidates:
        raise InvalidLocalDateTime("local date and time do not exist in this timezone")
    if len(candidates) > 1:
        raise AmbiguousLocalDateTime("local date and time occur twice in this timezone")
    return next(iter(candidates))
