"""Open-Meteo forecast adapter and deterministic route weather assessment."""

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx
from pydantic import ValidationError

from schemas import LocationSelection, WeatherEstimate

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class WeatherProviderError(Exception):
    """Forecast unavailable or invalid."""


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return float(value)


class OpenMeteoWeatherService:
    def __init__(self, client: object | None = None) -> None:
        self.client = client

    def _forecast(self, location: LocationSelection, when: datetime) -> dict[str, object]:
        params = {
            "latitude": location.latitude,
            "longitude": location.longitude,
            "hourly": "precipitation,snowfall,wind_speed_10m,weather_code",
            "forecast_days": 16,
            "timezone": "UTC",
        }
        try:
            response = self.client.get(OPEN_METEO_URL, params=params, timeout=4.0) if self.client else httpx.get(OPEN_METEO_URL, params=params, timeout=4.0)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise WeatherProviderError from exc
        try:
            hourly = body["hourly"]
            times = hourly["time"]
            if not isinstance(times, list) or not times:
                raise ValueError
            target = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
            index = times.index(target.strftime("%Y-%m-%dT%H:00"))
            if target > datetime.now(timezone.utc) and (target - datetime.now(timezone.utc)).days >= 16:
                raise ValueError
            vals: dict[str, object] = {}
            for key in ("precipitation", "snowfall", "wind_speed_10m", "weather_code"):
                data = hourly[key]
                if not isinstance(data, list) or len(data) != len(times):
                    raise ValueError
                vals[key] = data[index]
            return vals
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise WeatherProviderError from exc

    def assess(self, origin: LocationSelection, destination: LocationSelection, departure: datetime, arrival: datetime) -> WeatherEstimate:
        now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        departure_hour = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        arrival_hour = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        if departure_hour < now_hour or arrival_hour > now_hour + timedelta(days=15):
            return WeatherEstimate(status="unavailable", summary="Forecast unavailable for the planned trip time; no weather buffer applied.", buffer_minutes=0, retrieved_at=None)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                origin_future = pool.submit(self._forecast, origin, departure)
                destination_future = pool.submit(self._forecast, destination, arrival)
                samples = [(origin.name, origin_future.result()), (destination.name, destination_future.result())]
        except (WeatherProviderError, Exception):
            return WeatherEstimate(status="unavailable", summary="Forecast unavailable; no weather buffer applied.", buffer_minutes=0, retrieved_at=None)

        conditions: list[str] = []
        buffer = 0
        for point, values in samples:
            rain = _number(values["precipitation"])
            snow = _number(values["snowfall"])
            wind = _number(values["wind_speed_10m"])
            code = _number(values["weather_code"])
            if rain is None or snow is None or wind is None or code is None or not code.is_integer():
                return WeatherEstimate(status="unavailable", summary="Forecast unavailable; no weather buffer applied.", buffer_minutes=0, retrieved_at=None)
            if rain >= 7.5:
                conditions.append(f"Heavy rain near {point}"); buffer = max(buffer, 10)
            elif rain >= 2.5:
                conditions.append(f"Rain near {point}"); buffer = max(buffer, 5)
            if snow >= 1:
                conditions.append(f"Snow near {point}"); buffer = max(buffer, 15)
            if wind >= 50:
                conditions.append(f"Strong wind near {point}"); buffer = max(buffer, 10)
            if int(code) in {95, 96, 99}:
                conditions.append(f"Thunderstorm near {point}"); buffer = max(buffer, 20)
        summary = "; ".join(conditions) if conditions else "No buffer-triggering conditions forecast at selected route endpoints."
        origin_forecast_at = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        destination_forecast_at = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return WeatherEstimate(
            status="available", summary=summary, buffer_minutes=buffer,
            retrieved_at=datetime.now(timezone.utc), forecast_at=origin_forecast_at,
            origin_forecast_at=origin_forecast_at,
            destination_forecast_at=destination_forecast_at,
            conditions=conditions,
        )
