"""Replaceable TomTom place search adapter."""

import os
import threading
import time
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError

from schemas import LocationSelection, RouteLandmark, TrafficCoordinate


BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search"
TOMTOM_ALONG_ROUTE_URL = "https://api.tomtom.com/search/2/searchAlongRoute/.json"
_LANDMARK_CACHE_TTL_SECONDS = 6 * 60 * 60
_LANDMARK_CACHE_MAX_ENTRIES = 200
_landmark_cache: dict[tuple[tuple[float, float], ...], tuple[float, list[RouteLandmark]]] = {}
_landmark_cache_lock = threading.Lock()


class LocationProviderConfigurationError(Exception):
    """The server-side location provider is not configured."""


class LocationProviderError(Exception):
    """The geocoding provider could not return a usable response."""


class TomTomSearchService:
    """Use TomTom Fuzzy Search for full POI/address matches and typeahead."""

    def __init__(self, api_key: str | None = None) -> None:
        load_dotenv(dotenv_path=BACKEND_ENV_PATH, override=False)
        self.api_key = (api_key if api_key is not None else os.getenv("TOMTOM_API_KEY", "")).strip()
        if not self.api_key:
            raise LocationProviderConfigurationError

    def search(self, query: str) -> list[LocationSelection]:
        query = query.strip()
        if not query:
            return []

        try:
            response = httpx.get(
                f"{TOMTOM_SEARCH_URL}/{quote(query, safe='')}.json",
                params={
                    "key": self.api_key,
                    "typeahead": "true",
                    "limit": 10,
                    "language": "en-US",
                    "timeZone": "iana",
                },
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise LocationProviderError from exc

        if not isinstance(payload, dict):
            raise LocationProviderError("Invalid TomTom response")
        raw_results = payload.get("results", [])
        if not isinstance(raw_results, list):
            raise LocationProviderError("Invalid TomTom response")

        results: list[LocationSelection] = []
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            poi = item.get("poi") if isinstance(item.get("poi"), dict) else {}
            address = item.get("address") if isinstance(item.get("address"), dict) else {}
            position = item.get("position") if isinstance(item.get("position"), dict) else {}
            time_zone = item.get("timeZone") if isinstance(item.get("timeZone"), dict) else {}
            try:
                results.append(LocationSelection.model_validate({
                    "name": poi.get("name") or address.get("freeformAddress"),
                    "locality": address.get("municipality") or address.get("localName"),
                    "region": address.get("countrySubdivisionName") or address.get("countrySubdivision"),
                    "country": address.get("country"),
                    "latitude": position.get("lat"),
                    "longitude": position.get("lon"),
                    "timezone": time_zone.get("ianaId"),
                }))
            except ValidationError:
                # Do not expose provider records that cannot be safely selected.
                continue
        return results

    def landmarks_along_route(self, route_points: list[TrafficCoordinate]) -> list[RouteLandmark]:
        if len(route_points) < 2:
            return []
        cache_key = tuple((round(point.latitude, 5), round(point.longitude, 5)) for point in route_points)
        now = time.monotonic()
        with _landmark_cache_lock:
            cached = _landmark_cache.get(cache_key)
            if cached and cached[0] > now:
                return list(cached[1])
            if cached:
                _landmark_cache.pop(cache_key, None)

        payload_points = [
            {"lat": point.latitude, "lon": point.longitude}
            for point in _sample_landmark_route(route_points)
        ]
        try:
            response = httpx.post(
                TOMTOM_ALONG_ROUTE_URL,
                params={
                    "key": self.api_key,
                    "maxDetourTime": 300,
                    "limit": 20,
                    "categorySet": "7321,7372",
                    "sortBy": "detourTime",
                },
                json={"route": {"points": payload_points}},
                timeout=5.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise LocationProviderError("Route landmarks are unavailable") from exc

        raw_results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(raw_results, list):
            raise LocationProviderError("Invalid TomTom landmark response")
        landmarks: list[RouteLandmark] = []
        seen: set[tuple[str, str]] = set()
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            poi = item.get("poi") if isinstance(item.get("poi"), dict) else {}
            position = item.get("position") if isinstance(item.get("position"), dict) else {}
            name = poi.get("name")
            categories = poi.get("categorySet")
            category_ids = {
                entry.get("id") for entry in categories
                if isinstance(entry, dict) and isinstance(entry.get("id"), int)
            } if isinstance(categories, list) else set()
            category = "hospital" if 7321 in category_ids else "school" if 7372 in category_ids else None
            if not isinstance(name, str) or category is None:
                continue
            try:
                landmark = RouteLandmark(
                    name=" ".join(name.split())[:160],
                    category=category,
                    latitude=position.get("lat"),
                    longitude=position.get("lon"),
                )
            except (ValueError, TypeError):
                continue
            identity = (category, landmark.name.casefold())
            if identity not in seen:
                landmarks.append(landmark)
                seen.add(identity)
            if len(landmarks) == 20:
                break

        with _landmark_cache_lock:
            if len(_landmark_cache) >= _LANDMARK_CACHE_MAX_ENTRIES:
                oldest_key = min(_landmark_cache, key=lambda key: _landmark_cache[key][0])
                _landmark_cache.pop(oldest_key, None)
            _landmark_cache[cache_key] = (time.monotonic() + _LANDMARK_CACHE_TTL_SECONDS, landmarks)
        return landmarks


def _sample_landmark_route(points: list[TrafficCoordinate], maximum: int = 100) -> list[TrafficCoordinate]:
    if len(points) <= maximum:
        return points
    return [points[round(index * (len(points) - 1) / (maximum - 1))] for index in range(maximum)]
