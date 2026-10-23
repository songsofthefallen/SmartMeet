"""Open-Meteo forecast adapter and deterministic route weather assessment."""

import math
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Literal

import httpx
from pydantic import ValidationError

from observability import log_provider_event
from schemas import LocationSelection, WeatherAdvisory, WeatherAssessmentDiagnostic, WeatherEstimate

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_TIMEOUT = httpx.Timeout(connect=2.0, read=4.0, write=2.0, pool=2.0)
logger = logging.getLogger(__name__)
WMO_WEATHER_CONDITIONS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Moderate rain showers",
    82: "Heavy rain showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def condition_for_weather_code(code: int) -> str | None:
    """Return the documented Open-Meteo/WMO label, or None for unsupported codes."""
    return WMO_WEATHER_CONDITIONS.get(code)


class WeatherProviderError(Exception):
    """Forecast unavailable or invalid."""

    def __init__(self, reason: Literal["missing_hourly_data", "invalid_response_values", "provider_timeout", "provider_request_failure"], forecast_hour: str, point: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.forecast_hour = forecast_hour
        self.point = point


def _hour_string(when: datetime) -> str:
    return when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00Z")


def _unavailable(
    reason: str,
    assessment_pass: int,
    departure: datetime,
    arrival: datetime,
    *,
    failed_point: str | None = None,
    rejection_reason: str | None = None,
    current_utc_hour: datetime | None = None,
) -> WeatherEstimate:
    estimate = WeatherEstimate(
        status="unavailable",
        summary="Weather information is temporarily unavailable.",
        retrieved_at=None,
    )
    estimate._diagnostic = WeatherAssessmentDiagnostic(
        reason=reason,
        assessment_pass=assessment_pass,
        origin_forecast_hour=_hour_string(departure),
        destination_forecast_hour=_hour_string(arrival),
        failed_point=failed_point,
        rejection_reason=rejection_reason,
        current_utc_hour=_hour_string(current_utc_hour) if current_utc_hour else None,
    )
    return estimate


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return float(value)


class OpenMeteoWeatherService:
    def __init__(self, client: object | None = None) -> None:
        self.client = client

    def _forecast(self, location: LocationSelection, when: datetime, point: str) -> dict[str, object]:
        requested_hour = _hour_string(when)
        params = {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "hourly": "precipitation,snowfall,wind_speed_10m,weather_code",
            "forecast_days": 16,
            "timezone": "UTC",
        }
        started = perf_counter()
        try:
            response = self.client.get(OPEN_METEO_URL, params=params, timeout=OPEN_METEO_TIMEOUT) if self.client else httpx.get(OPEN_METEO_URL, params=params, timeout=OPEN_METEO_TIMEOUT)
        except httpx.TimeoutException as exc:
            log_provider_event(logger, provider="open-meteo", operation="forecast", elapsed_ms=round((perf_counter() - started) * 1000), category="timeout", exception_class=type(exc).__name__, level=logging.WARNING)
            raise WeatherProviderError("provider_timeout", requested_hour, point) from exc
        except httpx.HTTPError as exc:
            log_provider_event(logger, provider="open-meteo", operation="forecast", elapsed_ms=round((perf_counter() - started) * 1000), category="transport_error", exception_class=type(exc).__name__, level=logging.WARNING)
            raise WeatherProviderError("provider_request_failure", requested_hour, point) from exc
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            log_provider_event(logger, provider="open-meteo", operation="forecast", elapsed_ms=round((perf_counter() - started) * 1000), category="provider_error", upstream_status=getattr(response, "status_code", None), exception_class=type(exc).__name__, level=logging.WARNING)
            raise WeatherProviderError("provider_request_failure", requested_hour, point) from exc
        try:
            body = response.json()
        except (ValueError, TypeError) as exc:
            raise WeatherProviderError("invalid_response_values", requested_hour, point) from exc
        try:
            hourly = body["hourly"]
            times = hourly["time"]
            if not isinstance(times, list) or not times:
                raise ValueError
            target = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
            try:
                index = times.index(target.strftime("%Y-%m-%dT%H:00"))
            except ValueError as exc:
                raise WeatherProviderError("missing_hourly_data", requested_hour, point) from exc
            if target > datetime.now(timezone.utc) and (target - datetime.now(timezone.utc)).days >= 16:
                raise ValueError
            vals: dict[str, object] = {}
            for key in ("precipitation", "snowfall", "wind_speed_10m", "weather_code"):
                data = hourly[key]
                if not isinstance(data, list) or len(data) != len(times):
                    raise ValueError
                vals[key] = data[index]
            return vals
        except WeatherProviderError:
            raise
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise WeatherProviderError("invalid_response_values", requested_hour, point) from exc

    def assess(self, origin: LocationSelection | None, destination: LocationSelection | None, departure: datetime, arrival: datetime, *, assessment_pass: int = 1) -> WeatherEstimate:
        now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        requested = [("origin", origin, departure), ("destination", destination, arrival)]
        statuses: dict[str, str | None] = {"origin": None, "destination": None}
        messages: dict[str, str | None] = {"origin": None, "destination": None}
        samples: dict[str, dict[str, object]] = {}
        failures: list[WeatherProviderError] = []
        invalid_points: list[str] = []
        rejected_points: list[tuple[str, str]] = []
        pending: list[tuple[str, object, datetime]] = []
        for point, location, when in requested:
            if location is None:
                continue
            hour = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
            if hour < now_hour or hour > now_hour + timedelta(days=15):
                statuses[point] = "unavailable"
                messages[point] = (
                    "Past weather data is unavailable for this time."
                    if hour < now_hour
                    else "This date is beyond the 15-day forecast window."
                )
                rejected_points.append((point, "departure_before_current_hour" if hour < now_hour else "arrival_beyond_forecast_horizon"))
            else:
                pending.append((point, location, when))

        with ThreadPoolExecutor(max_workers=max(1, len(pending))) as pool:
            futures = [(point, pool.submit(self._forecast, location, when, point)) for point, location, when in pending]
            for point, future in futures:
                try:
                    samples[point] = future.result()
                except WeatherProviderError as exc:
                    statuses[point] = "unavailable"
                    messages[point] = "We could not retrieve this weather forecast right now. You can try again."
                    failures.append(exc)
                except Exception:
                    statuses[point] = "unavailable"
                    messages[point] = "We could not retrieve this weather forecast right now. You can try again."

        point_forecasts: dict[str, dict[str, object]] = {}
        conditions: list[str] = []
        advisories: list[WeatherAdvisory] = []
        for point, values in samples.items():
            rain = _number(values.get("precipitation"))
            snow = _number(values.get("snowfall"))
            wind = _number(values.get("wind_speed_10m"))
            code = _number(values.get("weather_code"))
            condition = condition_for_weather_code(int(code)) if code is not None and code.is_integer() else None
            if rain is None or snow is None or wind is None or code is None or condition is None:
                statuses[point] = "unavailable"
                messages[point] = "We could not retrieve this weather forecast right now. You can try again."
                invalid_points.append(point)
                continue
            statuses[point] = "available"
            point_forecasts[point] = {
                "condition": condition,
                "weather_code": int(code),
                "precipitation_mm": rain,
                "snowfall_cm": snow,
                "wind_speed_kmh": wind,
            }
            when = departure if point == "origin" else arrival
            endpoint_conditions: list[str] = []
            if rain >= 7.5:
                endpoint_conditions.append("Heavy rain")
            elif rain >= 2.5:
                endpoint_conditions.append("Rain")
            if snow >= 1:
                endpoint_conditions.append("Snow")
            if wind >= 50:
                endpoint_conditions.append("Strong winds")
            if int(code) in {95, 96, 99}:
                endpoint_conditions.append("Thunderstorm")
            for advisory in endpoint_conditions:
                conditions.append(f"{advisory} near {point}")
                advisories.append(WeatherAdvisory(
                    condition=advisory,
                    endpoint=point,
                    forecast_at=when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0),
                ))

        available_points = [point for point, status in statuses.items() if status == "available"]
        requested_points = [point for point, location, _ in requested if location is not None]
        if not requested_points:
            return _unavailable("no_location", assessment_pass, departure, arrival)
        all_available = len(available_points) == len(requested_points)
        overall_status = "available" if available_points else "unavailable"
        if advisories:
            summary = "Forecast conditions at a selected route endpoint may affect your trip."
        elif not available_points:
            summary = "We could not retrieve this weather forecast right now. You can try again."
        elif not all_available:
            summary = "Some selected location forecasts are unavailable."
        else:
            summary = "No significant weather concerns detected at the selected route endpoints."
        origin_hour = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        destination_hour = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        result = WeatherEstimate(
            status=overall_status,
            summary=summary,
            retrieved_at=datetime.now(timezone.utc) if available_points else None,
            forecast_at=origin_hour if origin is not None else destination_hour,
            origin_forecast_at=origin_hour if origin is not None else None,
            destination_forecast_at=destination_hour if destination is not None else None,
            origin_weather=point_forecasts.get("origin"),
            destination_weather=point_forecasts.get("destination"),
            origin_status=statuses["origin"],
            destination_status=statuses["destination"],
            origin_message=messages["origin"],
            destination_message=messages["destination"],
            conditions=conditions,
            advisories=advisories,
        )
        if failures:
            first = failures[0]
            result._diagnostic = WeatherAssessmentDiagnostic(
                reason=first.reason,
                assessment_pass=assessment_pass,
                origin_forecast_hour=_hour_string(departure),
                destination_forecast_hour=_hour_string(arrival),
                failed_point=first.point,
            )
        elif rejected_points and len(rejected_points) == len(requested_points):
            reasons = {reason for _, reason in rejected_points}
            rejection_reason = (
                "departure_before_current_hour_and_arrival_beyond_forecast_horizon"
                if reasons == {"departure_before_current_hour", "arrival_beyond_forecast_horizon"}
                else next(iter(reasons))
            )
            result._diagnostic = WeatherAssessmentDiagnostic(
                reason="unsupported_forecast_time",
                assessment_pass=assessment_pass,
                origin_forecast_hour=_hour_string(departure),
                destination_forecast_hour=_hour_string(arrival),
                failed_point=None,
                rejection_reason=rejection_reason,
                current_utc_hour=_hour_string(now_hour),
            )
        elif invalid_points and not available_points:
            result._diagnostic = WeatherAssessmentDiagnostic(
                reason="invalid_response_values",
                assessment_pass=assessment_pass,
                origin_forecast_hour=_hour_string(departure),
                destination_forecast_hour=_hour_string(arrival),
                failed_point=invalid_points[0],
            )
        return result
