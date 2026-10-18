"""Replaceable travel-time routing adapter, currently using TomTom Routing API v1."""

import math
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError

from schemas import LocationSelection, RouteAlternative, TrafficCoordinate, TrafficSection, TravelEstimate

logger = logging.getLogger(__name__)
TOMTOM_REVERSE_GEOCODE_URL = "https://api.tomtom.com/search/2/reverseGeocode"
TOMTOM_ROUTE_TIMEOUT_SECONDS = 35.0
_REVERSE_GEOCODE_CACHE_TTL_SECONDS = 6 * 60 * 60
_REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 500
_REVERSE_GEOCODE_REQUEST_LIMIT_PER_ROUTE = 3
_reverse_geocode_cache: dict[tuple[float, float], tuple[float, str | None]] = {}
_reverse_geocode_cache_lock = threading.Lock()


def _optional_seconds(summary: dict[str, object], key: str) -> int | None:
    value = summary.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 2_147_483_647 or not math.isfinite(value):
        return None
    return int(math.ceil(value))


def _section_index(section: dict[str, object], key: str) -> int | None:
    value = section.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _section_text(section: dict[str, object], key: str) -> str | None:
    field = section.get(key)
    if not isinstance(field, dict):
        return None
    value = field.get("text")
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value[:200] or None


def _road_labels(section: dict[str, object]) -> tuple[list[str], list[str]]:
    names = [name] if (name := _section_text(section, "streetName")) else []
    numbers: list[str] = []
    road_numbers_raw = section.get("roadNumbers")
    if isinstance(road_numbers_raw, list):
        for road_number in road_numbers_raw:
            if isinstance(road_number, dict):
                value = road_number.get("text")
                if isinstance(value, str):
                    value = " ".join(value.split())[:40]
                    if value and value not in numbers:
                        numbers.append(value)
    return names, numbers


def _road_details(
    traffic_section: dict[str, object], sections: list[object],
) -> tuple[list[str], list[str]]:
    names, numbers, _ = _road_match_details(traffic_section, sections)
    return names, numbers


def _road_match_details(
    traffic_section: dict[str, object], sections: list[object],
) -> tuple[list[str], list[str], bool]:
    traffic_start = _section_index(traffic_section, "startPointIndex")
    traffic_end = _section_index(traffic_section, "endPointIndex")
    if traffic_start is None or traffic_end is None or traffic_end < traffic_start:
        return [], [], False

    names: list[str] = []
    numbers: list[str] = []
    overlapping_names: set[str] = set()
    for candidate in sections:
        if not isinstance(candidate, dict) or candidate.get("sectionType") != "IMPORTANT_ROAD_STRETCH":
            continue
        road_start = _section_index(candidate, "startPointIndex")
        road_end = _section_index(candidate, "endPointIndex")
        # TomTom section indexes include both endpoints. A shared endpoint is
        # provider-confirmed overlap even when the sections share no full edge.
        if road_start is None or road_end is None or road_end < road_start:
            continue
        if max(traffic_start, road_start) > min(traffic_end, road_end):
            continue
        candidate_names, candidate_numbers = _road_labels(candidate)
        overlapping_names.update(name.casefold() for name in candidate_names)
        names.extend(name for name in candidate_names if name not in names)
        numbers.extend(number for number in candidate_numbers if number not in numbers)
        if len(names) >= 10 and len(numbers) >= 10:
            break
    if len(overlapping_names) > 1:
        return [], [], True
    return names[:10], numbers[:10], False


def _reverse_geocode_location(coordinate: TrafficCoordinate, api_key: str) -> str | None:
    """Return a nearby street label; callers must present it as approximate."""
    cache_key = (round(coordinate.latitude, 5), round(coordinate.longitude, 5))
    now = time.monotonic()
    with _reverse_geocode_cache_lock:
        cached = _reverse_geocode_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]
        if cached:
            _reverse_geocode_cache.pop(cache_key, None)

    result: str | None = None
    try:
        response = httpx.get(
            f"{TOMTOM_REVERSE_GEOCODE_URL}/{coordinate.latitude},{coordinate.longitude}.json",
            params={"key": api_key, "radius": "50", "returnMatchType": "true"},
            timeout=2.0,
        )
        response.raise_for_status()
        payload = response.json()
        addresses = payload.get("addresses") if isinstance(payload, dict) else None
        if isinstance(addresses, list) and addresses and isinstance(addresses[0], dict):
            address = addresses[0].get("address")
            if isinstance(address, dict) and isinstance(address.get("streetName"), str):
                result = " ".join(address["streetName"].split())[:180] or None
    except (httpx.HTTPError, ValueError, TypeError):
        # The auxiliary lookup must never turn a valid route into a failure.
        result = None

    with _reverse_geocode_cache_lock:
        if len(_reverse_geocode_cache) >= _REVERSE_GEOCODE_CACHE_MAX_ENTRIES:
            oldest = min(_reverse_geocode_cache, key=lambda key: _reverse_geocode_cache[key][0])
            _reverse_geocode_cache.pop(oldest, None)
        _reverse_geocode_cache[cache_key] = (time.monotonic() + _REVERSE_GEOCODE_CACHE_TTL_SECONDS, result)
    return result


def _nearby_road_metadata(
    traffic_section: dict[str, object], sections: list[object],
) -> list[dict[str, object]]:
    traffic_start = _section_index(traffic_section, "startPointIndex")
    traffic_end = _section_index(traffic_section, "endPointIndex")
    if traffic_start is None or traffic_end is None:
        return []
    candidates: list[dict[str, object]] = []
    for candidate in sections:
        if not isinstance(candidate, dict) or candidate.get("sectionType") != "IMPORTANT_ROAD_STRETCH":
            continue
        road_start = _section_index(candidate, "startPointIndex")
        road_end = _section_index(candidate, "endPointIndex")
        if road_start is None or road_end is None or road_end < road_start:
            continue
        index_gap = max(0, road_start - traffic_end, traffic_start - road_end)
        names, numbers = _road_labels(candidate)
        candidates.append({
            "start_index": road_start,
            "end_index": road_end,
            "road_names": names,
            "road_numbers": numbers,
            "index_gap": index_gap,
            "matching_decision": "inclusive_index_overlap" if index_gap == 0 else "nearby_no_overlap",
        })
    candidates.sort(key=lambda item: (item["index_gap"], item["start_index"]))
    return candidates[:20]


def _log_unnamed_traffic_section(
    traffic_section: dict[str, object], sections: list[object],
) -> None:
    start_index = _section_index(traffic_section, "startPointIndex")
    end_index = _section_index(traffic_section, "endPointIndex")
    candidates = _nearby_road_metadata(traffic_section, sections)
    overlapping = [item for item in candidates if item["matching_decision"] == "inclusive_index_overlap"]
    if not candidates:
        decision = "no_important_road_stretch_sections_returned"
    elif not overlapping:
        decision = "nearest_road_metadata_does_not_overlap"
    elif len(overlapping) > 1:
        decision = "multiple_overlapping_road_stretches"
    else:
        decision = "overlapping_metadata_has_no_road_identifier"
    # This is temporary diagnostic logging for manual refresh only. It records
    # indexes and provider road labels, never coordinates or raw provider data.
    logger.info(
        "tomtom_traffic_road_diagnostic traffic_indexes=%s-%s decision=%s road_candidates=%s",
        start_index,
        end_index,
        decision,
        candidates,
    )


def _route_point(legs: object, index: int | None) -> TrafficCoordinate | None:
    if index is None or not isinstance(legs, list) or not legs or not isinstance(legs[0], dict):
        return None
    points = legs[0].get("points")
    if not isinstance(points, list) or index >= len(points):
        return None
    point = points[index]
    if not isinstance(point, dict):
        return None
    try:
        return TrafficCoordinate(latitude=point.get("latitude"), longitude=point.get("longitude"))
    except (ValueError, TypeError):
        return None


def _sample_route_geometry(raw_points: object, *, maximum: int = 500) -> list[TrafficCoordinate]:
    """Retain route endpoints while reducing detailed provider geometry to a bounded size."""
    if not isinstance(raw_points, list) or not raw_points or maximum < 2:
        return []
    count = len(raw_points)
    indices = range(count) if count <= maximum else (round(index * (count - 1) / (maximum - 1)) for index in range(maximum))
    geometry: list[TrafficCoordinate] = []
    for index in indices:
        point = raw_points[index]
        if not isinstance(point, dict):
            continue
        try:
            geometry.append(TrafficCoordinate(latitude=point.get("latitude"), longitude=point.get("longitude")))
        except (ValueError, TypeError):
            continue
    return geometry


def _traffic_sections(
    route: dict[str, object], *, diagnose_unnamed: bool = False,
    geocode: object | None = None,
    request_limit: int = _REVERSE_GEOCODE_REQUEST_LIMIT_PER_ROUTE,
) -> list[TrafficSection]:
    sections = route.get("sections", [])
    if not isinstance(sections, list):
        return []
    legs = route.get("legs")
    result: list[TrafficSection] = []
    geocode_requests = 0
    for section in sections:
        if not isinstance(section, dict) or section.get("sectionType") != "TRAFFIC":
            continue
        delay = _optional_seconds(section, "delayInSeconds")
        if delay is None:
            severity = None
        elif delay <= 120:
            severity = "little_or_no_delay"
        elif delay >= 600:
            severity = "significant_delay"
        else:
            severity = "some_delay"
        start_index = _section_index(section, "startPointIndex")
        end_index = _section_index(section, "endPointIndex")
        road_names, road_numbers, _ambiguous = _road_match_details(section, sections)
        if diagnose_unnamed and not road_names and not road_numbers:
            _log_unnamed_traffic_section(section, sections)
        incident_type = section.get("simpleCategory")
        if incident_type not in {"JAM", "ROAD_WORK", "ROAD_CLOSURE", "OTHER"}:
            incident_type = None
        start_coordinates = _route_point(legs, start_index)
        end_coordinates = _route_point(legs, end_index)
        fallback_coordinate = start_coordinates
        if start_index is not None and end_index is not None and end_index >= start_index:
            fallback_coordinate = _route_point(legs, start_index + (end_index - start_index) // 2) or fallback_coordinate
        approximate_location = None
        if (not road_names or _ambiguous) and fallback_coordinate is not None and callable(geocode) and geocode_requests < request_limit:
            geocode_requests += 1
            try:
                candidate = geocode(fallback_coordinate)
                if isinstance(candidate, str) and candidate.strip():
                    approximate_location = " ".join(candidate.split())[:200]
            except Exception:  # noqa: BLE001 - fallback failures must not affect route estimates
                approximate_location = None
        location_source = "reverse_geocoding" if approximate_location else "verified_route_metadata" if road_names or road_numbers else "unavailable"
        result.append(TrafficSection(
            severity=severity,
            delay_seconds=delay,
            start_point_index=start_index,
            end_point_index=end_index,
            road_names=road_names,
            road_numbers=road_numbers,
            approximate_location=approximate_location,
            location_source=location_source,
            incident_type=incident_type,
            start_coordinates=start_coordinates,
            end_coordinates=end_coordinates,
        ))
    return result

BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
TOMTOM_ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute"


class RoutingProviderConfigurationError(Exception):
    """Routing provider credentials are unavailable."""


class RoutingProviderError(Exception):
    """A route could not be obtained or validated."""

    def __init__(self, *args: object, reason: str = "provider_error") -> None:
        super().__init__(*args)
        self.reason = reason


def _tomtom_error_reason(response: httpx.Response) -> str:
    """Classify allowlisted provider codes without retaining raw response text."""
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return "provider_error"
    detailed = payload.get("detailedError") if isinstance(payload, dict) else None
    code = detailed.get("code") if isinstance(detailed, dict) else None
    if code == "COMPUTE_TIME_LIMIT_EXCEEDED":
        return "compute_limit"
    if isinstance(code, str) and code in {"NO_ROUTE_FOUND", "ROUTE_NOT_FOUND"}:
        return "no_route"
    return "provider_error"


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
        diagnose_unnamed_traffic_sections: bool = False,
    ) -> TravelEstimate:
        if depart_at is not None and arrive_at is not None:
            raise ValueError("provide at most one route time")
        coordinates = f"{origin.latitude},{origin.longitude}:{destination.latitude},{destination.longitude}"
        params: dict[str, str | list[str]] = {
            "key": self.api_key,
            "traffic": "true",
            "computeTravelTimeFor": "all",
            "sectionType": ["traffic", "importantRoadStretch"],
            "routeRepresentation": "polyline",
            "maxAlternatives": "5",
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
                timeout=TOMTOM_ROUTE_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise RoutingProviderError(reason="timeout") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise RoutingProviderError from exc
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RoutingProviderError(reason=_tomtom_error_reason(response)) from exc
        retrieved_at = datetime.now(timezone.utc)
        try:
            payload = response.json()
        except (ValueError, TypeError) as exc:
            raise RoutingProviderError(reason="invalid_response") from exc
        if isinstance(payload, dict) and payload.get("routes") == []:
            raise RoutingProviderError(reason="no_route")
        try:
            routes = payload["routes"]
            if not isinstance(routes, list):
                raise ValueError
            alternatives: list[RouteAlternative] = []
            route_payloads: dict[str, dict[str, object]] = {}
            for index, candidate in enumerate(routes[:6]):
                if not isinstance(candidate, dict) or not isinstance(candidate.get("summary"), dict):
                    continue
                summary = candidate["summary"]
                seconds = summary.get("travelTimeInSeconds")
                if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds < 0 or seconds > 2_147_483_647 * 60:
                    continue
                distance = summary.get("lengthInMeters")
                if isinstance(distance, bool) or not isinstance(distance, (int, float)) or distance < 0 or not math.isfinite(distance):
                    distance = None
                sections = candidate.get("sections")
                road_names: list[str] = []
                if isinstance(sections, list):
                    for section in sections:
                        if isinstance(section, dict) and section.get("sectionType") == "IMPORTANT_ROAD_STRETCH":
                            name = _section_text(section, "streetName")
                            if name and name not in road_names:
                                road_names.append(name)
                legs = candidate.get("legs")
                raw_points = legs[0].get("points") if isinstance(legs, list) and legs and isinstance(legs[0], dict) else []
                geometry = _sample_route_geometry(raw_points)
                route_id = str(index)
                alternative = RouteAlternative(
                    route_id=route_id, duration_seconds=int(math.ceil(seconds)),
                    duration_minutes=int(math.ceil(seconds / 60)),
                    distance_meters=int(math.ceil(distance)) if distance is not None else None,
                    traffic_delay_seconds=_optional_seconds(summary, "trafficDelayInSeconds"),
                    no_traffic_travel_time_seconds=_optional_seconds(summary, "noTrafficTravelTimeInSeconds"),
                    historic_traffic_travel_time_seconds=_optional_seconds(summary, "historicTrafficTravelTimeInSeconds"),
                    live_traffic_incidents_travel_time_seconds=_optional_seconds(summary, "liveTrafficIncidentsTravelTimeInSeconds"),
                    traffic_sections=_traffic_sections(
                        candidate, diagnose_unnamed=diagnose_unnamed_traffic_sections,
                        geocode=lambda coordinate: _reverse_geocode_location(coordinate, self.api_key),
                    ),
                    road_names=road_names[:10],
                    geometry=geometry,
                )
                alternatives.append(alternative)
                route_payloads[route_id] = candidate
            if not alternatives:
                raise ValueError
            primary = alternatives[0]
            route = route_payloads[primary.route_id]
            return TravelEstimate(
                duration_seconds=primary.duration_seconds,
                duration_minutes=primary.duration_minutes,
                provider="tomtom",
                retrieved_at=retrieved_at,
                traffic_included=True,
                route_time_basis=time_basis,
                traffic_delay_seconds=primary.traffic_delay_seconds,
                no_traffic_travel_time_seconds=primary.no_traffic_travel_time_seconds,
                historic_traffic_travel_time_seconds=primary.historic_traffic_travel_time_seconds,
                live_traffic_incidents_travel_time_seconds=primary.live_traffic_incidents_travel_time_seconds,
                traffic_sections=primary.traffic_sections,
                selected_route_id=primary.route_id,
                alternatives=alternatives,
            )
        except (KeyError, IndexError, TypeError, ValueError, ValidationError) as exc:
            raise RoutingProviderError from exc


def _tomtom_datetime(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("route time must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
