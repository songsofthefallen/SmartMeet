"""Authenticated location search endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from location_service import (
    LocationProviderConfigurationError,
    LocationProviderError,
    TomTomSearchService,
)
from main import verify_clerk_token
from schemas import LocationSearchRequest, LocationSearchResponse


router = APIRouter(prefix="/locations", tags=["locations"])
CurrentUser = Annotated[str, Depends(verify_clerk_token)]


def get_location_service() -> TomTomSearchService:
    try:
        return TomTomSearchService()
    except LocationProviderConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Location search is not configured") from exc


@router.post("/search", response_model=LocationSearchResponse)
def search_locations(
    payload: LocationSearchRequest,
    _user_id: CurrentUser,
    service: Annotated[TomTomSearchService, Depends(get_location_service)],
) -> LocationSearchResponse:
    try:
        return LocationSearchResponse(results=service.search(payload.query))
    except LocationProviderError as exc:
        raise HTTPException(status_code=502, detail="Location search is temporarily unavailable") from exc
