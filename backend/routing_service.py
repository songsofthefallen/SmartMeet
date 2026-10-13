"""Replaceable travel-time routing adapter, currently using TomTom Routing API v1."""

import math
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError

from schemas import LocationSelection, TrafficSection, TravelEstimate


def _optional_seconds(summary: dict[str, object], key: str) -> int | None:
    value = summary.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 2_147_483_647 or not math.isfinite(value):
        return None
    return int(math.ceil(value))


def _traffic_sections(route: dict[str, object]) -> list[TrafficSection]:
    sections = route.get("sections", [])
    if not isinstance(sections, list):
        return []
    result: list[TrafficSection] = []
    for section in sections:
        if not isinstance(section, dict) or section.get("sectionType") != "TRAFFIC":
            continue
        delay = section.get("delayInSeconds")
        if isinstance(delay, bool) or not isinstance(delay, int) or delay < 0:
            continue
        if delay <= 120:
            severity = "little_or_no_delay"
        elif delay >= 600:
            severity = "significant_delay"
        else:
            severity = "some_delay"
        result.append(TrafficSection(severity=severity, delay_seconds=delay))
    return result

BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute"


class RoutingProviderConfigurationError(Exception):
    """Routing provider credentials are unavailable."""


class RoutingProviderError(Exception):
    """A route could not be obtained or validated."""


class TomTomRoutingService:
    def __init__(self, api_key: str | None = None) -> None:
        load_dotenv(dotenv_path=BACKEND_ENV_PATH, override=False)
        self.api_key = (api_key if api_key is not None else os.getenv("TOMTOM_API_KEY", "")).strip()
        if not self.api_key:
            raise RoutingProviderConfigurationError

    def estimate(
        self,
        origin: LocationSelection,
        destination: LocationSelection,
        *,
        depart_at: datetime | None = None,
        arrive_at: datetime | None = None,
    ) -> TravelEstimate:
        if depart_at is not None and arrive_at is not None:
            raise ValueError("provide at most one route time")
        coordinates = f"{origin.latitude},{origin.longitude}:{destination.latitude},{destination.longitude}"
        params: dict[str, str] = {
            "key": self.api_key,
            "traffic": "true",
            "computeTravelTimeFor": "all",
            "sectionType": "traffic",
        }
        if depart_at is not None:
            params["departAt"] = _tomtom_datetime(depart_at)
            time_basis = "scheduled_departure"
        elif arrive_at is not None:
            params["arriveAt"] = _tomtom_datetime(arrive_at)
            time_basis = "scheduled_arrival"
        else:
            time_basis = "current"
        try:
            response = httpx.get(
                f"{TOMTOM_ROUTE_URL}/{coordinates}/json",
                params=params,
                timeout=5.0,
            )
            response.raise_for_status()
            retrieved_at = datetime.now(timezone.utc)
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RoutingProviderError from exc
        try:
            routes = payload["routes"]
            route = routes[0]
            summary = route["summary"]
            seconds = summary["travelTimeInSeconds"]
            if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds < 0 or seconds > 2_147_483_647 * 60:
                raise ValueError
            return TravelEstimate(
                duration_seconds=int(math.ceil(seconds)),
                duration_minutes=int(math.ceil(seconds / 60)),
                provider="tomtom",
                retrieved_at=retrieved_at,
                traffic_included=True,
                route_time_basis=time_basis,
                traffic_delay_seconds=_optional_seconds(summary, "trafficDelayInSeconds"),
                no_traffic_travel_time_seconds=_optional_seconds(summary, "noTrafficTravelTimeInSeconds"),
                historic_traffic_travel_time_seconds=_optional_seconds(summary, "historicTrafficTravelTimeInSeconds"),
                live_traffic_incidents_travel_time_seconds=_optional_seconds(summary, "liveTrafficIncidentsTravelTimeInSeconds"),
                traffic_sections=_traffic_sections(route),
            )
        except (KeyError, IndexError, TypeError, ValueError, ValidationError) as exc:
            raise RoutingProviderError from exc


def _tomtom_datetime(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("route time must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
