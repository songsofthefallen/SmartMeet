"""Open-Meteo forecast adapter and deterministic route weather assessment."""

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from pydantic import ValidationError

from schemas import LocationSelection, WeatherAdvisory, WeatherAssessmentDiagnostic, WeatherEstimate

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
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
        try:
            response = self.client.get(OPEN_METEO_URL, params=params, timeout=4.0) if self.client else httpx.get(OPEN_METEO_URL, params=params, timeout=4.0)
        except httpx.TimeoutException as exc:
            raise WeatherProviderError("provider_timeout", requested_hour, point) from exc
        except httpx.HTTPError as exc:
            raise WeatherProviderError("provider_request_failure", requested_hour, point) from exc
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
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

    def assess(self, origin: LocationSelection, destination: LocationSelection, departure: datetime, arrival: datetime, *, assessment_pass: int = 1) -> WeatherEstimate:
        now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        departure_hour = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        arrival_hour = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        departure_too_early = departure_hour < now_hour
        arrival_too_late = arrival_hour > now_hour + timedelta(days=15)
        if departure_too_early or arrival_too_late:
            if departure_too_early and arrival_too_late:
                rejection_reason = "departure_before_current_hour_and_arrival_beyond_forecast_horizon"
            elif departure_too_early:
                rejection_reason = "departure_before_current_hour"
            else:
                rejection_reason = "arrival_beyond_forecast_horizon"
            return _unavailable(
                "unsupported_forecast_time", assessment_pass, departure, arrival,
                rejection_reason=rejection_reason, current_utc_hour=now_hour,
            )
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                origin_future = pool.submit(self._forecast, origin, departure, "origin")
                destination_future = pool.submit(self._forecast, destination, arrival, "destination")
                samples = [("origin", origin_future.result()), ("destination", destination_future.result())]
        except WeatherProviderError as exc:
            estimate = _unavailable(exc.reason, assessment_pass, departure, arrival, failed_point=exc.point)
            return estimate
        except Exception:
            return _unavailable("provider_request_failure", assessment_pass, departure, arrival)

        conditions: list[str] = []
        advisories: list[WeatherAdvisory] = []
        point_forecasts: list[dict[str, object]] = []
        for point, values in samples:
            rain = _number(values["precipitation"])
            snow = _number(values["snowfall"])
            wind = _number(values["wind_speed_10m"])
            code = _number(values["weather_code"])
            if rain is None or snow is None or wind is None or code is None or not code.is_integer():
                return _unavailable("invalid_response_values", assessment_pass, departure, arrival, failed_point=point)
            condition = condition_for_weather_code(int(code))
            if condition is None:
                return _unavailable("invalid_response_values", assessment_pass, departure, arrival, failed_point=point)
            point_forecasts.append({
                "condition": condition,
                "weather_code": int(code),
                "precipitation_mm": rain,
                "snowfall_cm": snow,
                "wind_speed_kmh": wind,
            })
            forecast_at = departure if point == "origin" else arrival
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
            for condition in endpoint_conditions:
                conditions.append(f"{condition} near {point}")
                advisories.append(WeatherAdvisory(
                    condition=condition,
                    endpoint=point,
                    forecast_at=forecast_at.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0),
                ))
        summary = (
            "Forecast conditions at a selected route endpoint may affect your trip."
            if advisories
            else "No significant weather concerns detected at the selected route endpoints."
        )
        origin_forecast_at = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        destination_forecast_at = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return WeatherEstimate(
            status="available", summary=summary,
            retrieved_at=datetime.now(timezone.utc), forecast_at=origin_forecast_at,
            origin_forecast_at=origin_forecast_at,
            destination_forecast_at=destination_forecast_at,
            origin_weather=point_forecasts[0],
            destination_weather=point_forecasts[1],
            conditions=conditions,
            advisories=advisories,
        )
