"""Replaceable TomTom place search adapter."""

import os
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError

from schemas import LocationSelection


BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search"


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
