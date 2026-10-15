from datetime import datetime, timedelta, timezone
from threading import Lock

import httpx
import pytest

from schemas import LocationSelection, WeatherAssessmentDiagnostic, WeatherEstimate
import weather_service
from weather_service import OpenMeteoWeatherService, condition_for_weather_code


class MockWeatherClient:
    def __init__(self, payload: object | Exception):
        self.payload = payload
        self.calls = 0

    def get(self, url: str, *, params: dict[str, object], timeout: float):
        self.calls += 1
        if isinstance(self.payload, Exception):
            raise self.payload
        return httpx.Response(200, json=self.payload, request=httpx.Request("GET", url))


class EndpointTimeoutClient:
    """Mock per-endpoint outcomes while recording the configured timeout."""

    def __init__(self, origin_hour: datetime, destination_hour: datetime, *, failing_latitude: float, fail_once: bool = False):
        self.responses = {
            14.0: forecast(origin_hour, rain=8),
            15.0: forecast(destination_hour),
        }
        self.failing_latitude = failing_latitude
        self.fail_once = fail_once
        self.failure_used = False
        self.calls: list[tuple[float, float]] = []
        self.lock = Lock()

    def get(self, url: str, *, params: dict[str, object], timeout: float):
        latitude = float(params["latitude"])
        with self.lock:
            self.calls.append((latitude, timeout))
            should_fail = latitude == self.failing_latitude and (not self.fail_once or not self.failure_used)
            if should_fail:
                self.failure_used = True
        if should_fail:
            raise httpx.ReadTimeout("mock provider timeout", request=httpx.Request("GET", url))
        return httpx.Response(200, json=self.responses[latitude], request=httpx.Request("GET", url))


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
    assert any("Heavy rain" in item for item in result.conditions)
    assert any("Thunderstorm" in item for item in result.conditions)
    assert client.calls == 2
    assert result.origin_weather is not None and result.destination_weather is not None
    assert result.origin_weather.condition == "Thunderstorm"
    assert result.origin_weather.wind_speed_kmh == 55


@pytest.mark.parametrize(
    ("code", "condition"),
    [
        (0, "Clear sky"), (1, "Mainly clear"), (2, "Partly cloudy"), (3, "Cloudy"),
        (45, "Fog"), (48, "Depositing rime fog"), (51, "Light drizzle"), (53, "Moderate drizzle"),
        (55, "Dense drizzle"), (56, "Light freezing drizzle"), (57, "Dense freezing drizzle"),
        (61, "Light rain"), (63, "Moderate rain"), (65, "Heavy rain"),
        (66, "Light freezing rain"), (67, "Heavy freezing rain"),
        (71, "Light snow"), (73, "Moderate snow"), (75, "Heavy snow"), (77, "Snow grains"),
        (80, "Light rain showers"), (81, "Moderate rain showers"), (82, "Heavy rain showers"),
        (85, "Light snow showers"), (86, "Heavy snow showers"),
        (95, "Thunderstorm"), (96, "Thunderstorm with slight hail"), (99, "Thunderstorm with heavy hail"),
    ],
)
def test_open_meteo_wmo_weather_code_labels(code: int, condition: str) -> None:
    assert condition_for_weather_code(code) == condition


def test_unsupported_wmo_code_is_not_misreported_as_clear() -> None:
    assert condition_for_weather_code(999) is None


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
    expected_condition = condition_for_weather_code(int(values.get("code", 3)))
    assert estimate.origin_weather is not None
    assert estimate.origin_weather.condition == expected_condition
    if expected_minutes == 0:
        assert estimate.summary == "No extra time needed based on the forecast at your origin and destination."
    else:
        assert estimate.summary == "Forecast conditions may affect travel time."
        assert estimate.conditions


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
    assert timeout._diagnostic is not None and timeout._diagnostic.reason == "provider_timeout"
    assert invalid._diagnostic is not None and invalid._diagnostic.reason == "invalid_response_values"
    assert result.origin_weather is None and result.destination_weather is None


@pytest.mark.parametrize(
    ("failing_latitude", "failed_point"),
    [(14.0, "origin"), (15.0, "destination")],
    ids=["origin-timeout", "destination-timeout"],
)
def test_endpoint_timeout_is_unavailable_and_never_applies_unverified_buffer(
    failing_latitude: float, failed_point: str,
) -> None:
    origin_time = datetime.now(timezone.utc) + timedelta(hours=3)
    destination_time = origin_time + timedelta(hours=1)
    client = EndpointTimeoutClient(origin_time, destination_time, failing_latitude=failing_latitude)
    origin = LocationSelection(name="Origin", latitude=14, longitude=121)
    destination = LocationSelection(name="Destination", latitude=15, longitude=120)

    result = OpenMeteoWeatherService(client).assess(origin, destination, origin_time, destination_time)

    assert result.status == "unavailable"
    assert result.buffer_minutes == 0
    assert result.retrieved_at is None
    assert result.origin_weather is None and result.destination_weather is None
    assert result._diagnostic is not None
    assert result._diagnostic.reason == "provider_timeout"
    assert result._diagnostic.failed_point == failed_point
    assert len(client.calls) == 2
    assert all(timeout == 4.0 for _, timeout in client.calls)


def test_weather_assessment_can_recover_on_a_later_attempt_without_reusing_failed_data() -> None:
    origin_time = datetime.now(timezone.utc) + timedelta(hours=3)
    destination_time = origin_time + timedelta(hours=1)
    client = EndpointTimeoutClient(origin_time, destination_time, failing_latitude=14.0, fail_once=True)
    origin = LocationSelection(name="Origin", latitude=14, longitude=121)
    destination = LocationSelection(name="Destination", latitude=15, longitude=120)
    service = OpenMeteoWeatherService(client)

    failed = service.assess(origin, destination, origin_time, destination_time, assessment_pass=1)
    recovered = service.assess(origin, destination, origin_time, destination_time, assessment_pass=2)

    assert failed.status == "unavailable"
    assert failed.buffer_minutes == 0
    assert failed._diagnostic is not None and failed._diagnostic.reason == "provider_timeout"
    assert failed._diagnostic.failed_point == "origin"
    assert recovered.status == "available"
    assert recovered.buffer_minutes == 10
    assert recovered.origin_weather is not None and recovered.origin_weather.precipitation_mm == 8
    assert len(client.calls) == 4
    assert all(timeout == 4.0 for _, timeout in client.calls)


def test_weather_request_failure_has_structured_reason() -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    point = LocationSelection(name="Home", latitude=14, longitude=121)
    failure = httpx.ConnectError("private provider detail", request=httpx.Request("GET", "https://example.test"))

    result = OpenMeteoWeatherService(MockWeatherClient(failure)).assess(point, point, when, when, assessment_pass=2)

    assert result.status == "unavailable"
    assert result._diagnostic is not None
    assert result._diagnostic.reason == "provider_request_failure"
    assert result._diagnostic.assessment_pass == 2
    assert "private provider detail" not in str(result._diagnostic)
    assert "_diagnostic" not in result.model_dump(mode="json")


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
    assert estimate._diagnostic is not None
    assert estimate._diagnostic.reason == "invalid_response_values"


def test_weather_outside_hourly_coverage_is_unavailable() -> None:
    when = datetime.now(timezone.utc) + timedelta(days=20)
    point = LocationSelection(name="Home", latitude=14, longitude=121)
    client = MockWeatherClient(forecast(when))
    result = OpenMeteoWeatherService(client).assess(point, point, when, when)
    assert result.status == "unavailable"
    assert result.buffer_minutes == 0
    assert client.calls == 0
    assert result._diagnostic is not None
    assert result._diagnostic.reason == "unsupported_forecast_time"
    assert result._diagnostic.origin_forecast_hour.endswith("Z")


@pytest.mark.parametrize(
    ("departure_offset", "arrival_offset", "expected_reason"),
    [
        (-1, 1, "departure_before_current_hour"),
        (1, 16 * 24, "arrival_beyond_forecast_horizon"),
        (-1, 16 * 24, "departure_before_current_hour_and_arrival_beyond_forecast_horizon"),
    ],
    ids=["departure-before-current-hour", "arrival-beyond-horizon", "both-rejected"],
)
def test_unsupported_forecast_time_has_specific_safe_reason(
    monkeypatch: pytest.MonkeyPatch, departure_offset: int, arrival_offset: int, expected_reason: str,
) -> None:
    fixed_now = datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now.astimezone(tz) if tz else fixed_now.replace(tzinfo=None)

    monkeypatch.setattr(weather_service, "datetime", FrozenDateTime)
    departure = fixed_now + timedelta(hours=departure_offset)
    arrival = fixed_now + timedelta(hours=arrival_offset)
    client = MockWeatherClient(forecast(departure))
    point = LocationSelection(name="Private place", latitude=14, longitude=121)

    result = OpenMeteoWeatherService(client).assess(point, point, departure, arrival, assessment_pass=1)

    diagnostic = result._diagnostic
    assert result.status == "unavailable"
    assert diagnostic is not None
    assert diagnostic.reason == "unsupported_forecast_time"
    assert diagnostic.rejection_reason == expected_reason
    assert diagnostic.current_utc_hour == "2026-10-15T12:00Z"
    assert diagnostic.assessment_pass == 1
    assert diagnostic.failed_point is None
    assert client.calls == 0


@pytest.mark.parametrize(
    "offset",
    [0, 15 * 24],
    ids=["current-hour-boundary", "15-day-horizon-boundary"],
)
def test_supported_forecast_time_boundaries_are_assessed(
    monkeypatch: pytest.MonkeyPatch, offset: int,
) -> None:
    fixed_now = datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now.astimezone(tz) if tz else fixed_now.replace(tzinfo=None)

    monkeypatch.setattr(weather_service, "datetime", FrozenDateTime)
    when = fixed_now + timedelta(hours=offset)
    point = LocationSelection(name="Private place", latitude=14, longitude=121)
    client = MockWeatherClient(forecast(when))

    result = OpenMeteoWeatherService(client).assess(point, point, when, when)

    assert result.status == "available"
    assert result.buffer_minutes == 0
    assert client.calls == 2
    assert result._diagnostic is None


def test_weather_requested_utc_hour_must_exist_in_provider_response() -> None:
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    requested_hour = when.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    missing_hour = requested_hour + timedelta(hours=1)
    response = forecast(missing_hour, rain=8, code=95)
    point = LocationSelection(name="Home", latitude=14, longitude=121)

    result = OpenMeteoWeatherService(MockWeatherClient(response)).assess(point, point, when, when)

    assert result.status == "unavailable"
    assert result.buffer_minutes == 0
    assert result.retrieved_at is None
    assert result.origin_weather is None
    assert result.destination_weather is None
    assert result._diagnostic is not None
    assert result._diagnostic.reason == "missing_hourly_data"
    assert result._diagnostic.origin_forecast_hour == requested_hour.strftime("%Y-%m-%dT%H:00Z")
