"""Authenticated schedule extraction endpoint."""

from collections.abc import Generator
from datetime import datetime, timedelta, timezone
import logging
import json
from time import perf_counter
from typing import Annotated
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ai_provider import AIConfigurationError, OpenRouterClient
from extraction_schemas import ScheduleExtraction, ScheduleExtractionClarificationRequest, ScheduleExtractionRequest, ScheduleExtractionReview
from extraction_service import ScheduleExtractionError, ScheduleExtractionService
from database import get_db
from models import ExtractionDraft, SavedPlace
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
        review = service.extract(
            payload.text,
            reference_datetime=datetime.now(timezone.utc),
            user_timezone=payload.timezone,
            saved_places=saved_places,
        )
        if review.status.value == "needs_clarification":
            draft_id = str(uuid4())
            review.draft_id = draft_id
            db.add(ExtractionDraft(
                id=draft_id,
                clerk_user_id=user_id,
                original_text=payload.text,
                timezone=payload.timezone,
                extraction=review.extraction.model_dump(mode="json") if review.extraction else None,
                clarification_field=review.clarification.field if review.clarification else "model_output",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            ))
            db.commit()
        return review
    except ScheduleExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is temporarily unavailable",
        ) from exc


@router.post("/extract/{draft_id}/clarify", response_model=ScheduleExtractionReview)
def continue_extraction(
    draft_id: str,
    payload: ScheduleExtractionClarificationRequest,
    user_id: CurrentUser,
    db: DbSession,
    service: Annotated[ScheduleExtractionService, Depends(get_extraction_service)],
) -> ScheduleExtractionReview:
    draft = db.scalar(select(ExtractionDraft).where(
        ExtractionDraft.id == draft_id,
        ExtractionDraft.clerk_user_id == user_id,
    ))
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Extraction draft not found")
    expires_at = draft.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        db.delete(draft)
        db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Extraction draft expired. Start a new extraction.")
    if not draft.clarification_field:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This extraction draft no longer needs clarification")

    saved_places = list(db.scalars(
        select(SavedPlace).where(SavedPlace.clerk_user_id == user_id)
        .order_by(SavedPlace.alias, SavedPlace.id)
    ))
    existing = ScheduleExtraction.model_validate_json(json.dumps(draft.extraction)) if draft.extraction else None
    try:
        review = service.extract(
            draft.original_text,
            reference_datetime=datetime.now(timezone.utc),
            user_timezone=draft.timezone,
            saved_places=saved_places,
            existing_extraction=existing,
            clarification_field=draft.clarification_field,
            clarification_answer=payload.answer,
        )
    except ScheduleExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is temporarily unavailable",
        ) from exc

    if review.status.value == "needs_clarification":
        draft.extraction = review.extraction.model_dump(mode="json") if review.extraction else None
        draft.clarification_field = review.clarification.field if review.clarification else "model_output"
        if draft.clarification_field != "origin_description" and payload.origin_location is not None:
            draft.origin_location = payload.origin_location.model_dump(mode="json")
        elif draft.clarification_field == "origin_description":
            draft.origin_location = None
        if draft.clarification_field != "destination_description" and payload.destination_location is not None:
            draft.destination_location = payload.destination_location.model_dump(mode="json")
        elif draft.clarification_field == "destination_description":
            draft.destination_location = None
        draft.updated_at = datetime.now(timezone.utc)
        review.draft_id = draft.id
        db.commit()
    else:
        db.delete(draft)
        db.commit()
    return review
