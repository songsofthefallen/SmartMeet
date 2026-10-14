from datetime import datetime, timedelta, timezone

import httpx
import pytest

from schemas import LocationSelection, WeatherEstimate
from weather_service import OpenMeteoWeatherService


class MockWeatherClient:
    def __init__(self, payload: object | Exception):
        self.payload = payload
        self.calls = 0

    def get(self, url: str, *, params: dict[str, object], timeout: float):
        self.calls += 1
        if isinstance(self.payload, Exception):
            raise self.payload
        return httpx.Response(200, json=self.payload, request=httpx.Request("GET", url))


def forecast(when: datetime, *, rain: float = 0, snow: float = 0, wind: float = 0, code: int = 3) -> dict[str, object]:
    hour = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return {"hourly": {
        "time": [hour.strftime("%Y-%m-%dT%H:00")],
        "precipitation": [rain], "snowfall": [snow],
        "wind_speed_10m": [wind], "weather_code": [code],
    }}


def test_weather_thresholds_use_strongest_single_buffer() -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    client = MockWeatherClient(forecast(when, rain=8, snow=2, wind=55, code=95))
    point = LocationSelection(name="Home", latitude=14, longitude=121)
    result = OpenMeteoWeatherService(client).assess(point, point, when, when)
    assert result.status == "available"
    assert result.buffer_minutes == 20
    assert "Heavy rain" in result.summary and "Thunderstorm" in result.summary
    assert client.calls == 2


@pytest.mark.parametrize(
    ("scenario", "values", "expected_minutes"),
    [
        pytest.param("clear", {"rain": 0, "snow": 0, "wind": 0, "code": 0}, 0, id="clear-weather"),
        pytest.param("rain-3mm-h", {"rain": 3}, 5, id="rain-3mm-h"),
        pytest.param("heavy-rain-8mm-h", {"rain": 8}, 10, id="heavy-rain-8mm-h"),
        pytest.param("snow-1cm-h", {"snow": 1}, 15, id="snow-1cm-h"),
        pytest.param("wind-55km-h", {"wind": 55}, 10, id="wind-55km-h"),
        pytest.param("wmo-95", {"code": 95}, 20, id="thunderstorm-code-95"),
        pytest.param("wmo-96", {"code": 96}, 20, id="thunderstorm-code-96"),
        pytest.param("wmo-99", {"code": 99}, 20, id="thunderstorm-code-99"),
        pytest.param("stacked-weather", {"rain": 8, "snow": 1, "wind": 55, "code": 96}, 20, id="multiple-use-strongest-only"),
    ],
)
def test_named_weather_scenarios(scenario: str, values: dict[str, object], expected_minutes: int) -> None:
    """Run with `pytest tests/test_weather.py -k <scenario-id>` for a focused scenario."""
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    response = forecast(when, **values)  # type: ignore[arg-type]
    point = LocationSelection(name="Test point", latitude=14, longitude=121)
    estimate = OpenMeteoWeatherService(MockWeatherClient(response)).assess(point, point, when, when)
    assert estimate.status == "available"
    assert estimate.buffer_minutes == expected_minutes


def test_weather_no_threshold_conditions_apply_no_buffer() -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    client = MockWeatherClient(forecast(when, rain=2.49, snow=0.99, wind=49.9, code=3))
    point = LocationSelection(name="Campus", latitude=14, longitude=121)
    result = OpenMeteoWeatherService(client).assess(point, point, when, when)
    assert result.status == "available"
    assert result.buffer_minutes == 0
    assert result.conditions == []


def test_weather_timeout_and_invalid_shape_are_unavailable() -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    point = LocationSelection(name="Home", latitude=14, longitude=121)
    timeout = OpenMeteoWeatherService(MockWeatherClient(httpx.TimeoutException("timeout"))).assess(point, point, when, when)
    invalid = OpenMeteoWeatherService(MockWeatherClient({"hourly": {"time": []}})).assess(point, point, when, when)
    for result in (timeout, invalid):
        assert result.status == "unavailable"
        assert result.buffer_minutes == 0
        assert result.retrieved_at is None


@pytest.mark.parametrize(
    "hourly_changes",
    [
        {"snowfall": None},
        {"precipitation": [-1]},
        {"wind_speed_10m": [True]},
        {"weather_code": [95.5]},
    ],
    ids=["missing-snowfall", "negative-rain", "boolean-wind", "fractional-weather-code"],
)
def test_missing_or_invalid_weather_values_never_apply_a_buffer(hourly_changes: dict[str, object]) -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    hourly = forecast(when)["hourly"]
    assert isinstance(hourly, dict)
    for key, value in hourly_changes.items():
        if value is None:
            hourly.pop(key)
        else:
            hourly[key] = value
    point = LocationSelection(name="Test point", latitude=14, longitude=121)
    estimate = OpenMeteoWeatherService(MockWeatherClient({"hourly": hourly})).assess(point, point, when, when)
    assert estimate.status == "unavailable"
    assert estimate.buffer_minutes == 0
    assert estimate.retrieved_at is None


def test_weather_outside_hourly_coverage_is_unavailable() -> None:
    when = datetime.now(timezone.utc) + timedelta(days=20)
    point = LocationSelection(name="Home", latitude=14, longitude=121)
    client = MockWeatherClient(forecast(when))
    result = OpenMeteoWeatherService(client).assess(point, point, when, when)
    assert result.status == "unavailable"
    assert result.buffer_minutes == 0
    assert client.calls == 0
