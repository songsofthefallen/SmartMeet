"""Replaceable travel-time routing adapter, currently using TomTom Routing API v1."""

import math
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import httpx
from dotenv import load_dotenv
from pydantic import ValidationError

from observability import log_provider_event
from schemas import LocationSelection, RouteAlternative, TrafficCoordinate, TrafficSection, TravelEstimate

logger = logging.getLogger(__name__)
TOMTOM_REVERSE_GEOCODE_URL = "https://api.tomtom.com/search/2/reverseGeocode"
TOMTOM_ROUTE_TIMEOUT_SECONDS = 35.0
TOMTOM_ROUTE_TIMEOUT = httpx.Timeout(connect=3.0, read=TOMTOM_ROUTE_TIMEOUT_SECONDS, write=5.0, pool=5.0)
TOMTOM_REVERSE_GEOCODE_TIMEOUT = httpx.Timeout(connect=1.0, read=2.0, write=1.0, pool=2.0)
_REVERSE_GEOCODE_CACHE_TTL_SECONDS = 6 * 60 * 60
_REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 500
_REVERSE_GEOCODE_REQUEST_LIMIT_PER_ROUTE = 3
_DEFAULT_MAX_ROUTE_DETOUR_RATIO = 8.0
_DEFAULT_MIN_ROUTE_DISTANCE_FOR_DETOUR_CHECK_METERS = 250_000.0
_DEFAULT_MAX_DRIVING_SPEED_KMH = 200.0
_reverse_geocode_cache: dict[tuple[float, float], tuple[float, str | None]] = {}
_reverse_geocode_cache_lock = threading.Lock()


def _optional_seconds(summary: dict[str, object], key: str) -> int | None:
    value = summary.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 2_147_483_647 or not math.isfinite(value):
        return None
    return int(math.ceil(value))


def _route_sanity_limits() -> tuple[float, float]:
    """Read conservative route sanity thresholds; values can be tuned per deployment."""
    try:
        ratio = float(os.getenv("ROUTE_MAX_DETOUR_RATIO", str(_DEFAULT_MAX_ROUTE_DETOUR_RATIO)))
        minimum_distance = float(os.getenv(
            "ROUTE_MIN_DISTANCE_FOR_DETOUR_CHECK_METERS",
            str(_DEFAULT_MIN_ROUTE_DISTANCE_FOR_DETOUR_CHECK_METERS),
        ))
        if math.isfinite(ratio) and ratio >= 1 and math.isfinite(minimum_distance) and minimum_distance > 0:
            return ratio, minimum_distance
    except (TypeError, ValueError):
        pass
    return _DEFAULT_MAX_ROUTE_DETOUR_RATIO, _DEFAULT_MIN_ROUTE_DISTANCE_FOR_DETOUR_CHECK_METERS


def _max_driving_speed_kmh() -> float:
    try:
        speed = float(os.getenv("ROUTE_MAX_AVERAGE_SPEED_KMH", str(_DEFAULT_MAX_DRIVING_SPEED_KMH)))
        if math.isfinite(speed) and speed > 0:
            return speed
    except (TypeError, ValueError):
        pass
    return _DEFAULT_MAX_DRIVING_SPEED_KMH


def _great_circle_distance_meters(origin: LocationSelection, destination: LocationSelection) -> float:
    earth_radius_meters = 6_371_008.8
    lat1, lat2 = math.radians(origin.latitude), math.radians(destination.latitude)
    delta_lat = lat2 - lat1
    delta_lon = math.radians(destination.longitude - origin.longitude)
    haversine = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 2 * earth_radius_meters * math.asin(math.sqrt(min(1.0, max(0.0, haversine))))


def _route_suspicion(
    *, distance_meters: float, duration_seconds: float, traffic_delay_seconds: float | None,
    origin: LocationSelection, destination: LocationSelection,
) -> str | None:
    if not math.isfinite(distance_meters) or distance_meters <= 0:
        return "invalid_distance"
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        return "invalid_duration"
    if traffic_delay_seconds is not None and (
        not math.isfinite(traffic_delay_seconds) or traffic_delay_seconds < 0
    ):
        return "invalid_traffic_delay"
    if distance_meters / duration_seconds * 3.6 > _max_driving_speed_kmh():
        return "excessive_average_driving_speed"
    straight_distance = _great_circle_distance_meters(origin, destination)
    ratio_limit, minimum_distance = _route_sanity_limits()
    if straight_distance > 1 and distance_meters >= minimum_distance:
        if distance_meters < straight_distance * 0.98:
            return "route_shorter_than_straight_line"
        if distance_meters / straight_distance > ratio_limit:
            return "excessive_driving_detour_ratio"
    return None


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
    started = perf_counter()
    try:
        response = httpx.get(
            f"{TOMTOM_REVERSE_GEOCODE_URL}/{coordinate.latitude},{coordinate.longitude}.json",
            params={"key": api_key, "radius": "50", "returnMatchType": "true"},
            timeout=TOMTOM_REVERSE_GEOCODE_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
        addresses = payload.get("addresses") if isinstance(payload, dict) else None
        if isinstance(addresses, list) and addresses and isinstance(addresses[0], dict):
            address = addresses[0].get("address")
            if isinstance(address, dict):
                candidate = address.get("freeformAddress") or address.get("streetName")
                if isinstance(candidate, str):
                    result = " ".join(candidate.split())[:500] or None
    except httpx.TimeoutException as exc:
        log_provider_event(logger, provider="tomtom", operation="reverse_geocode", elapsed_ms=round((perf_counter() - started) * 1000), category="timeout", exception_class=type(exc).__name__, level=logging.WARNING)
        result = None
    except httpx.HTTPError as exc:
        log_provider_event(logger, provider="tomtom", operation="reverse_geocode", elapsed_ms=round((perf_counter() - started) * 1000), category="provider_error", upstream_status=getattr(getattr(exc, "response", None), "status_code", None), exception_class=type(exc).__name__, level=logging.WARNING)
        result = None
    except (ValueError, TypeError) as exc:
        log_provider_event(logger, provider="tomtom", operation="reverse_geocode", elapsed_ms=round((perf_counter() - started) * 1000), category="invalid_response", exception_class=type(exc).__name__, level=logging.WARNING)
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

    def __init__(self, *args: object, reason: str = "provider_error", diagnostic: str | None = None, endpoint: str | None = None) -> None:
        super().__init__(*args)
        self.reason = reason
        self.diagnostic = diagnostic
        self.endpoint = endpoint


_TOMTOM_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")


def _safe_tomtom_error(response: httpx.Response, *, secret: str | None = None) -> tuple[str, str | None, str | None]:
    """Return a classified error and bounded diagnostic from untrusted provider data."""
    # Transport/server failures, authentication problems, and throttling say
    # nothing about whether a drivable route exists.
    status_code = getattr(response, "status_code", None)
    if status_code in {401, 403}:
        return "auth_error", None, None
    if status_code == 429:
        return "rate_limited", None, None
    if isinstance(status_code, int) and status_code >= 500:
        return "upstream_error", None, None
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return "provider_error", None, None
    detailed = payload.get("detailedError") if isinstance(payload, dict) else None
    code = detailed.get("code") if isinstance(detailed, dict) else None
    message = detailed.get("message") if isinstance(detailed, dict) else None
    safe_code = code if isinstance(code, str) and _TOMTOM_ERROR_CODE.fullmatch(code) else None
    safe_message = None
    if isinstance(message, str):
        # Provider text is diagnostic only. Strip control characters, URLs,
        # coordinate pairs and common credential/query-string forms.
        cleaned = " ".join(message.split())
        if secret:
            cleaned = cleaned.replace(secret, "[redacted]")
        cleaned = re.sub(r"https?://\S+|\b(?:key|api[_-]?key|subscription[_-]?key)=\S+", "[redacted]", cleaned, flags=re.I)
        cleaned = re.sub(r"\b(?:api\s+key|subscription\s+key|key)\s*[:=]\s*\S+", "[redacted]", cleaned, flags=re.I)
        cleaned = re.sub(r"(?<![A-Za-z0-9])[-+]?\d{1,3}\.\d{3,}(?:\s*[,; ]\s*[-+]?\d{1,3}\.\d{3,})?(?![A-Za-z0-9])", "[location]", cleaned)
        cleaned = "".join(char for char in cleaned if char.isprintable())
        safe_message = cleaned[:240] or None
    diagnostic = f"provider_code={safe_code or 'unknown'}" + (f" provider_message={safe_message}" if safe_message else "")
    endpoint = None
    if code == "MAP_MATCHING_FAILURE" and isinstance(message, str):
        if re.search(r"\b(origin|start(?:ing)? point|waypoint\s*0|location\s*0)\b", message, re.I):
            endpoint = "origin"
        elif re.search(r"\b(destination|end point|waypoint\s*1|location\s*1)\b", message, re.I):
            endpoint = "destination"
    if code == "COMPUTE_TIME_LIMIT_EXCEEDED":
        return "compute_limit", diagnostic, endpoint
    if code == "NO_ROUTE_FOUND":
        return "no_route", diagnostic, endpoint
    if code == "MAP_MATCHING_FAILURE":
        return "map_matching_failure", diagnostic, endpoint
    if code == "BAD_INPUT":
        return "invalid_request", diagnostic, endpoint
    return "provider_error", diagnostic, endpoint


def _tomtom_error_reason(response: httpx.Response) -> str:
    """Compatibility helper for callers/tests needing only the error category."""
    return _safe_tomtom_error(response)[0]


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
        started = perf_counter()
        try:
            response = httpx.get(
                f"{TOMTOM_ROUTE_URL}/{coordinates}/json",
                params=params,
                timeout=TOMTOM_ROUTE_TIMEOUT,
            )
        except httpx.TimeoutException as exc:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="timeout", exception_class=type(exc).__name__, level=logging.WARNING)
            raise RoutingProviderError(reason="timeout") from exc
        except httpx.HTTPError as exc:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="provider_error", upstream_status=getattr(getattr(exc, "response", None), "status_code", None), exception_class=type(exc).__name__, level=logging.WARNING)
            raise RoutingProviderError from exc
        except ValueError as exc:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="invalid_response", exception_class=type(exc).__name__, level=logging.WARNING)
            raise RoutingProviderError from exc
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            reason, diagnostic, endpoint = _safe_tomtom_error(response, secret=self.api_key)
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category=reason, upstream_status=getattr(response, "status_code", getattr(exc.response, "status_code", None)), exception_class=type(exc).__name__, diagnostic=diagnostic, level=logging.WARNING)
            raise RoutingProviderError(reason=reason, diagnostic=diagnostic, endpoint=endpoint) from exc
        retrieved_at = datetime.now(timezone.utc)
        try:
            payload = response.json()
        except (ValueError, TypeError) as exc:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="invalid_response", upstream_status=response.status_code, exception_class=type(exc).__name__, level=logging.WARNING)
            raise RoutingProviderError(reason="invalid_response") from exc
        if isinstance(payload, dict) and payload.get("routes") == []:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="no_route", upstream_status=getattr(response, "status_code", None), diagnostic="route_count=0")
            raise RoutingProviderError(reason="no_route")
        try:
            routes = payload["routes"]
            if not isinstance(routes, list):
                raise ValueError
            alternatives: list[RouteAlternative] = []
            route_payloads: dict[str, dict[str, object]] = {}
            suspicious_routes: list[str] = []
            for index, candidate in enumerate(routes[:6]):
                if not isinstance(candidate, dict) or not isinstance(candidate.get("summary"), dict):
                    continue
                summary = candidate["summary"]
                seconds = summary.get("travelTimeInSeconds")
                if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not math.isfinite(seconds) or seconds <= 0 or seconds > 2_147_483_647 * 60:
                    suspicious_routes.append(f"{index}:invalid_duration")
                    continue
                distance = summary.get("lengthInMeters")
                if isinstance(distance, bool) or not isinstance(distance, (int, float)) or distance <= 0 or not math.isfinite(distance):
                    suspicious_routes.append(f"{index}:invalid_distance")
                    continue
                raw_traffic_delay = summary.get("trafficDelayInSeconds")
                if raw_traffic_delay is not None and (
                    isinstance(raw_traffic_delay, bool)
                    or not isinstance(raw_traffic_delay, (int, float))
                    or not math.isfinite(raw_traffic_delay)
                    or raw_traffic_delay < 0
                    or raw_traffic_delay > 2_147_483_647
                ):
                    suspicious_routes.append(f"{index}:invalid_traffic_delay")
                    continue
                suspicion = _route_suspicion(
                    distance_meters=distance,
                    duration_seconds=seconds,
                    traffic_delay_seconds=raw_traffic_delay,
                    origin=origin,
                    destination=destination,
                )
                if suspicion:
                    suspicious_routes.append(f"{index}:{suspicion}")
                    continue
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
            if suspicious_routes:
                diagnostic = "suspicious_routes=" + ",".join(suspicious_routes[:6])
                log_provider_event(
                    logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000),
                    category="suspicious_response", upstream_status=getattr(response, "status_code", None),
                    diagnostic=diagnostic, level=logging.WARNING,
                )
                raise RoutingProviderError(reason="suspicious_route")
            if not alternatives:
                raise ValueError
            primary = alternatives[0]
            route = route_payloads[primary.route_id]
            log_provider_event(
                logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000),
                category="success", upstream_status=getattr(response, "status_code", None),
                diagnostic=f"route_count={len(alternatives)}",
            )
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
        except RoutingProviderError:
            raise
        except (KeyError, IndexError, TypeError, ValueError, ValidationError) as exc:
            log_provider_event(logger, provider="tomtom", operation="route", elapsed_ms=round((perf_counter() - started) * 1000), category="invalid_response", upstream_status=getattr(response, "status_code", None), exception_class=type(exc).__name__, level=logging.WARNING)
            raise RoutingProviderError from exc


def _tomtom_datetime(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("route time must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
