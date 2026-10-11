"""Authenticated schedule extraction endpoint."""

from collections.abc import Generator
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from ai_provider import AIConfigurationError, OpenRouterClient
from extraction_schemas import ScheduleExtractionRequest, ScheduleExtractionReview
from extraction_service import ScheduleExtractionError, ScheduleExtractionService
from main import verify_clerk_token


router = APIRouter(prefix="/schedules", tags=["schedule extraction"])
CurrentUser = Annotated[str, Depends(verify_clerk_token)]


def get_extraction_service() -> Generator[ScheduleExtractionService, None, None]:
    try:
        client = OpenRouterClient()
    except AIConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is not configured",
        ) from exc
    try:
        yield ScheduleExtractionService(client)
    finally:
        client.close()


@router.post("/extract", response_model=ScheduleExtractionReview)
def extract_schedule(
    payload: ScheduleExtractionRequest,
    _user_id: CurrentUser,
    service: Annotated[ScheduleExtractionService, Depends(get_extraction_service)],
) -> ScheduleExtractionReview:
    try:
        return service.extract(
            payload.text,
            reference_datetime=datetime.now(timezone.utc),
            user_timezone=payload.timezone,
        )
    except ScheduleExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Schedule extraction is temporarily unavailable",
        ) from exc
