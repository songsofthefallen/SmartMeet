"""Authenticated schedule extraction endpoint."""

from collections.abc import Generator
from datetime import datetime, timezone
import logging
from time import perf_counter
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ai_provider import AIConfigurationError, OpenRouterClient
from extraction_schemas import ScheduleExtractionRequest, ScheduleExtractionReview
from extraction_service import ScheduleExtractionError, ScheduleExtractionService
from database import get_db
from models import SavedPlace
from main import verify_clerk_token


router = APIRouter(prefix="/schedules", tags=["schedule extraction"])
logger = logging.getLogger(__name__)
CurrentUser = Annotated[str, Depends(verify_clerk_token)]
DbSession = Annotated[Session, Depends(get_db)]


def get_extraction_service() -> Generator[ScheduleExtractionService, None, None]:
    started = perf_counter()
    try:
        client = OpenRouterClient()
    except AIConfigurationError as exc:
        logger.error(
            "Schedule extraction configuration failure exception_class=%s category=configuration elapsed_ms=%d upstream_http_status=none",
            type(exc).__name__,
            round((perf_counter() - started) * 1000),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is not configured",
        ) from exc
    parsed_url = urlsplit(client.settings.base_url)
    safe_host = parsed_url.hostname or "invalid"
    try:
        if parsed_url.port is not None:
            safe_host = f"{safe_host}:{parsed_url.port}"
    except ValueError:
        safe_host = "invalid"
    safe_base_url = f"{parsed_url.scheme}://{safe_host}"
    logger.info(
        "AI extraction client configured provider=%s model=%s base_url=%s api_key_configured=%s",
        client.settings.provider,
        client.settings.model,
        safe_base_url,
        bool(client.settings.api_key),
    )
    try:
        yield ScheduleExtractionService(client)
    finally:
        client.close()


@router.post("/extract", response_model=ScheduleExtractionReview)
def extract_schedule(
    payload: ScheduleExtractionRequest,
    user_id: CurrentUser,
    db: DbSession,
    service: Annotated[ScheduleExtractionService, Depends(get_extraction_service)],
) -> ScheduleExtractionReview:
    try:
        saved_places = list(db.scalars(
            select(SavedPlace).where(SavedPlace.clerk_user_id == user_id)
            .order_by(SavedPlace.alias, SavedPlace.id)
        ))
        return service.extract(
            payload.text,
            reference_datetime=datetime.now(timezone.utc),
            user_timezone=payload.timezone,
            saved_places=saved_places,
        )
    except ScheduleExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is temporarily unavailable",
        ) from exc
