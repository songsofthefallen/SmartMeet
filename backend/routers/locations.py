"""Authenticated location search endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response

from location_service import (
    LocationProviderConfigurationError,
    LocationProviderError,
    TomTomSearchService,
)
from main import verify_clerk_token
from map_service import MapProviderError, TomTomMapService
from routing_service import _reverse_geocode_location
from schemas import LocationSearchRequest, LocationSearchResponse, MapImageRequest, ReverseGeocodeResponse, TrafficCoordinate


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


@router.post("/map-image")
def get_location_map(payload: MapImageRequest, _user_id: CurrentUser) -> Response:
    try:
        image, content_type = TomTomMapService().static_image_at(payload.latitude, payload.longitude, payload.zoom)
    except MapProviderError as exc:
        if exc.reason == "configuration":
            raise HTTPException(status_code=503, detail="TomTom Maps is not configured") from exc
        if exc.reason == "credentials":
            raise HTTPException(status_code=503, detail="TomTom Maps is unavailable for the configured API key") from exc
        if exc.reason == "rate_limit":
            raise HTTPException(status_code=429, detail="Map request limit reached. Try again later") from exc
        if exc.reason == "timeout":
            raise HTTPException(status_code=504, detail="Map request timed out. Retry or continue without an address") from exc
        raise HTTPException(status_code=502, detail="Map preview is temporarily unavailable") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Map center or zoom is invalid") from exc
    return Response(content=image, media_type=content_type, headers={"Cache-Control": "private, max-age=300"})


@router.post("/reverse-geocode", response_model=ReverseGeocodeResponse)
def reverse_geocode(payload: TrafficCoordinate, _user_id: CurrentUser) -> ReverseGeocodeResponse:
    try:
        service = TomTomSearchService()
    except LocationProviderConfigurationError:
        return ReverseGeocodeResponse(address=None)
    return ReverseGeocodeResponse(address=_reverse_geocode_location(payload, service.api_key))
