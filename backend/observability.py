"""Request correlation and safe provider diagnostics."""

from __future__ import annotations

from contextvars import ContextVar
import logging
import uuid

_request_id: ContextVar[str] = ContextVar("request_id", default="local")


def new_request_id() -> str:
    return uuid.uuid4().hex


def set_request_id(value: str) -> object:
    return _request_id.set(value)


def reset_request_id(token: object) -> None:
    _request_id.reset(token)  # type: ignore[arg-type]


def current_request_id() -> str:
    return _request_id.get()


def log_provider_event(
    logger: logging.Logger,
    *,
    provider: str,
    operation: str,
    elapsed_ms: int,
    category: str,
    upstream_status: int | None = None,
    exception_class: str | None = None,
    diagnostic: str | None = None,
    level: int = logging.INFO,
) -> None:
    """Log fixed, sanitized metadata without provider secrets or request data."""
    fields = {
        "request_id": current_request_id(),
        "provider": provider,
        "operation": operation,
        "elapsed_ms": elapsed_ms,
        "category": category,
        "upstream_status": upstream_status,
        "exception_class": exception_class,
        "diagnostic": diagnostic,
    }
    rendered = " ".join(f"{key}={value!r}" for key, value in fields.items())
    logger.log(level, "provider_request %s", rendered, extra=fields)
