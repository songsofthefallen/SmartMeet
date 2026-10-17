from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app
from routers.schedules import get_routing_service
from routers.schedules import get_weather_service
from routing_service import RoutingProviderError, TomTomRoutingService, _reverse_geocode_cache, _reverse_geocode_cache_lock, _reverse_geocode_location, _traffic_sections
from schemas import LocationSelection, TrafficCoordinate, TrafficSection, TravelEstimate, WeatherAdvisory, WeatherAssessmentDiagnostic, WeatherEstimate
from test_schedule_api import api_db, bearer, payload, signing_key


@pytest.fixture(autouse=True)
def freeze_schedule_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    import routers.schedules as schedule_routes

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz: object = None) -> datetime:
            fixed = datetime(2026, 10, 10, tzinfo=timezone.utc)
            return fixed.astimezone(tz) if tz is not None else fixed.replace(tzinfo=None)

    monkeypatch.setattr(schedule_routes, "datetime", FrozenDateTime)


def place(name: str, latitude: float, longitude: float) -> dict[str, object]:
    return LocationSelection(name=name, latitude=latitude, longitude=longitude).model_dump()


class StubRouting:
    def __init__(self, result: TravelEstimate | Exception | list[TravelEstimate | Exception]) -> None:
        self.result = result
        self.calls: list[tuple[LocationSelection, LocationSelection, dict[str, datetime]]] = []

    def estimate(self, origin: LocationSelection, destination: LocationSelection, **route_times: object) -> TravelEstimate:
        self.calls.append((origin, destination, route_times))
        current = self.result.pop(0) if isinstance(self.result, list) else self.result
        if isinstance(current, Exception):
            raise current
        basis = "scheduled_arrival" if "arrive_at" in route_times else "scheduled_departure" if "depart_at" in route_times else "current"
        return current.model_copy(update={"route_time_basis": basis})


class StubWeather:
    def __init__(self, results: list[WeatherEstimate] | None = None) -> None:
        self.results = results or [
            WeatherEstimate(status="available", summary="Forecast conditions at a selected route endpoint may affect your trip.", retrieved_at="2026-10-13T00:00:00Z", forecast_at="2026-10-13T00:00:00Z", conditions=["Heavy rain near destination"], advisories=[WeatherAdvisory(condition="Heavy rain", endpoint="destination", forecast_at="2026-10-13T00:00:00Z")])
        ]
        self.calls: list[tuple[datetime, datetime]] = []

    def assess(self, *args: object, **kwargs: object) -> WeatherEstimate:
        departure, arrival = args[2], args[3]
        assert isinstance(departure, datetime) and isinstance(arrival, datetime)
        self.calls.append((departure, arrival))
        if len(self.results) > 1:
            result = self.results.pop(0)
        else:
            result = self.results[0]
        origin_hour = departure.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        destination_hour = arrival.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        return result.model_copy(update={
            "forecast_at": origin_hour,
            "origin_forecast_at": origin_hour,
            "destination_forecast_at": destination_hour,
            "advisories": [
                item.model_copy(update={"forecast_at": origin_hour if item.endpoint == "origin" else destination_hour})
                for item in result.advisories
            ],
        })


def estimate(minutes: int = 37) -> TravelEstimate:
    return TravelEstimate(duration_seconds=minutes * 60, duration_minutes=minutes, provider="tomtom", retrieved_at="2026-10-13T00:00:00Z", traffic_included=True)


def route_payload(**changes: object) -> dict[str, object]:
    return payload(
        origin_location=place("Home", 14.5, 121.0),
        location=place("Campus", 14.6, 121.1),
        travel_duration_minutes=None,
    ) | changes


def test_schedule_routes_with_selected_origin_and_destination_and_recalculates(api_db: None, signing_key: str) -> None:
    service = StubRouting(estimate(37))
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    assert created.status_code == 201
    body = created.json()
    assert body["origin_location"]["name"] == "Home"
    assert body["location"]["name"] == "Campus"
    assert body["travel_duration_minutes"] == 37
    assert body["travel_estimate"]["traffic_included"] is True
    assert body["travel_estimate"]["provider"] == "tomtom"
    assert body["calculated_departure_time"] == "2026-10-10T22:23:00Z"
    assert body["target_datetime"] == "2026-10-10T23:00:00Z"
    assert body["route_warning"] is not None
    # Preparation edits only recalculate deterministic times and do not call routing again.
    prep_updated = client.patch(f"/schedules/{body['id']}", headers=headers, json={"preparation_duration_minutes": 10})
    assert prep_updated.json()["target_datetime"] == body["target_datetime"]
    assert prep_updated.json()["calculated_wake_time"] == "2026-10-10T22:13:00Z"
    assert len(service.calls) == 1
    # Clearing the saved estimate triggers a route retry; the response is the persisted result.
    cleared = client.patch(f"/schedules/{body['id']}", headers=headers, json={"travel_duration_minutes": None})
    assert cleared.json()["travel_duration_minutes"] == 37
    assert cleared.json()["calculated_departure_time"] == "2026-10-10T22:23:00Z"
    updated = client.patch(f"/schedules/{body['id']}", headers=headers, json={"location": place("New campus", 14.7, 121.2)})
    assert updated.status_code == 200
    assert updated.json()["travel_duration_minutes"] == 37
    assert len(service.calls) == 3
    assert service.calls[0][0].name == "Home"
    app.dependency_overrides.pop(get_routing_service, None)


def test_initial_no_route_requires_confirmation_before_saving(api_db: None, signing_key: str) -> None:
    service = StubRouting(RoutingProviderError(reason="no_route"))
    weather = StubWeather()
    app.dependency_overrides[get_routing_service] = lambda: service
    app.dependency_overrides[get_weather_service] = lambda: weather
    client = TestClient(app)
    headers = bearer(signing_key)
    request = route_payload(idempotency_key="route-confirmation-0001")

    needs_confirmation = client.post("/schedules", headers=headers, json=request)
    assert needs_confirmation.status_code == 409
    assert needs_confirmation.json()["detail"]["code"] == "route_unavailable_confirmation"
    assert "weather can be assessed separately" in needs_confirmation.json()["detail"]["message"]
    assert client.get("/schedules", headers=headers).json() == []
    assert weather.calls == []

    saved = client.post("/schedules", headers=headers, json=request | {"continue_without_route": True})
    assert saved.status_code == 201
    assert saved.json()["travel_estimate"] is None
    assert saved.json()["travel_duration_minutes"] is None
    assert saved.json()["weather_estimate"]["status"] == "available"
    target = datetime.fromisoformat(saved.json()["target_datetime"].replace("Z", "+00:00"))
    assert weather.calls == [(target, target)]
    assert len(service.calls) == 1
    weather_refreshed = client.post(f"/schedules/{saved.json()['id']}/weather-estimate/refresh", headers=headers)
    assert weather_refreshed.status_code == 200
    assert len(weather.calls) == 2
    assert weather.calls[-1] == (target, target)
    app.dependency_overrides.pop(get_routing_service, None)
    app.dependency_overrides.pop(get_weather_service, None)


def test_weather_forecast_does_not_require_a_traffic_route_when_duration_is_known(api_db: None, signing_key: str) -> None:
    routing = StubRouting(estimate(37))
    weather = StubWeather()
    app.dependency_overrides[get_routing_service] = lambda: routing
    app.dependency_overrides[get_weather_service] = lambda: weather
    created = TestClient(app).post(
        "/schedules", headers=bearer(signing_key),
        json=route_payload(travel_duration_minutes=30),
    )
    assert created.status_code == 201
    assert routing.calls == []
    assert len(weather.calls) == 1
    assert created.json()["weather_estimate"]["status"] == "available"
    app.dependency_overrides.pop(get_routing_service, None)
    app.dependency_overrides.pop(get_weather_service, None)


def test_past_schedule_skips_route_and_weather_and_can_be_edited_to_future(api_db: None, signing_key: str) -> None:
    route = StubRouting(estimate(37))
    weather = StubWeather()
    app.dependency_overrides[get_routing_service] = lambda: route
    app.dependency_overrides[get_weather_service] = lambda: weather
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload(
        target_datetime="2000-01-01T09:00:00+08:00", travel_duration_minutes=None,
    ))
    assert created.status_code == 201
    past = created.json()
    assert past["is_past"] is True
    assert past["travel_estimate"] is None
    assert past["weather_estimate"] is None
    assert route.calls == []
    assert weather.calls == []
    schedule_id = past["id"]
    refresh = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert refresh.status_code == 409
    assert route.calls == []

    updated = client.patch(f"/schedules/{schedule_id}", headers=headers, json={
        "target_datetime": "2099-01-01T09:00:00+08:00",
    })
    assert updated.status_code == 200
    assert updated.json()["is_past"] is False
    assert updated.json()["travel_estimate"] is not None
    assert len(route.calls) == 1
    assert len(weather.calls) == 1
    # The same persisted row and user-entered fields survive the time edits.
    assert updated.json()["id"] == schedule_id
    assert updated.json()["title"] == past["title"]
    app.dependency_overrides.pop(get_routing_service, None)
    app.dependency_overrides.pop(get_weather_service, None)


def test_arrival_schedule_is_past_when_calculated_departure_has_passed(api_db: None, signing_key: str) -> None:
    route = StubRouting(estimate(37))
    weather = StubWeather()
    app.dependency_overrides[get_routing_service] = lambda: route
    app.dependency_overrides[get_weather_service] = lambda: weather
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent="arrival", target_datetime="2026-10-10T00:10:00Z", travel_duration_minutes=30,
    ))
    assert response.status_code == 201
    assert response.json()["calculated_departure_time"] == "2026-10-09T23:40:00Z"
    assert response.json()["is_past"] is True
    assert route.calls == []
    assert weather.calls == []
    app.dependency_overrides.pop(get_routing_service, None)
    app.dependency_overrides.pop(get_weather_service, None)


def test_past_edit_preserves_historical_route_and_weather_estimates(api_db: None, signing_key: str) -> None:
    route = StubRouting(estimate(37))
    weather = StubWeather()
    app.dependency_overrides[get_routing_service] = lambda: route
    app.dependency_overrides[get_weather_service] = lambda: weather
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload(
        target_datetime="2099-01-01T09:00:00+08:00", travel_duration_minutes=None,
    ))
    assert created.status_code == 201
    original_route = created.json()["travel_estimate"]
    original_weather = created.json()["weather_estimate"]
    updated = client.patch(f"/schedules/{created.json()['id']}", headers=headers, json={
        "target_datetime": "2000-01-01T09:00:00+08:00",
    })
    assert updated.status_code == 200
    assert updated.json()["is_past"] is True
    assert updated.json()["travel_estimate"] == original_route
    assert updated.json()["weather_estimate"] == original_weather
    assert len(route.calls) == 1
    assert len(weather.calls) == 1
    app.dependency_overrides.pop(get_routing_service, None)
    app.dependency_overrides.pop(get_weather_service, None)


@pytest.mark.parametrize(
    ("intent", "expected_departure", "expected_arrival", "expected_wake"),
    [
        ("arrival", "2026-10-10T23:30:00Z", "2026-10-11T00:00:00Z", "2026-10-10T23:00:00Z"),
        ("departure", "2026-10-11T00:00:00Z", "2026-10-11T00:30:00Z", "2026-10-10T23:30:00Z"),
    ],
)
def test_weather_advisory_never_changes_schedule_calculations(
    api_db: None, signing_key: str, intent: str, expected_departure: str, expected_arrival: str, expected_wake: str,
) -> None:
    weather = StubWeather()
    app.dependency_overrides[get_weather_service] = lambda: weather
    created = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent=intent, target_datetime="2026-10-11T00:00:00Z", travel_duration_minutes=30,
    ))
    assert created.status_code == 201
    body = created.json()
    assert body["calculated_departure_time"] == expected_departure
    assert body["calculated_arrival_time"] == expected_arrival
    assert body["calculated_wake_time"] == expected_wake
    assert "buffer_minutes" not in body["weather_estimate"]
    assert body["weather_estimate"]["advisories"][0]["condition"] == "Heavy rain"
    assert body["weather_estimate"]["advisories"][0]["endpoint"] == "destination"
    expected_forecast_hour = datetime.fromisoformat(expected_arrival.replace("Z", "+00:00")).replace(minute=0)
    assert body["weather_estimate"]["advisories"][0]["forecast_at"] == expected_forecast_hour.isoformat().replace("+00:00", "Z")
    assert len(weather.calls) == 1
    assert weather.calls[0] == (datetime.fromisoformat(expected_departure.replace("Z", "+00:00")), datetime.fromisoformat(expected_arrival.replace("Z", "+00:00")))
    app.dependency_overrides.pop(get_weather_service, None)


def test_unavailable_weather_keeps_times_and_logs_safe_failure(api_db: None, signing_key: str, caplog: pytest.LogCaptureFixture) -> None:
    unavailable = WeatherEstimate(status="unavailable", summary="Weather information is temporarily unavailable.", retrieved_at=None)
    unavailable._diagnostic = WeatherAssessmentDiagnostic(
        reason="provider_timeout", assessment_pass=1,
        origin_forecast_hour="2026-10-10T23:00Z", destination_forecast_hour="2026-10-11T00:00Z",
        failed_point="origin",
    )
    weather = StubWeather([unavailable])
    app.dependency_overrides[get_weather_service] = lambda: weather
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent="arrival", target_datetime="2026-10-11T00:00:00Z", travel_duration_minutes=30,
    ))
    body = response.json()
    assert response.status_code == 201
    assert body["calculated_departure_time"] == "2026-10-10T23:30:00Z"
    assert body["weather_estimate"]["status"] == "unavailable"
    assert body["weather_estimate"]["summary"] == "Weather information is temporarily unavailable."
    assert len(weather.calls) == 1
    failure_log = next(record for record in caplog.records if getattr(record, "weather_event", None) == "assessment_unavailable")
    assert failure_log.weather_reason == "provider_timeout"
    assert 'weather_reason="provider_timeout"' in failure_log.getMessage()
    assert "14.5" not in failure_log.getMessage()
    assert "test-server-key" not in failure_log.getMessage()
    assert "_diagnostic" not in body["weather_estimate"]
    app.dependency_overrides.pop(get_weather_service, None)


def test_routing_failure_leaves_schedule_saved_with_unknown_travel(api_db: None, signing_key: str) -> None:
    app.dependency_overrides[get_routing_service] = lambda: StubRouting(RoutingProviderError("secret detail"))
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload())
    assert response.status_code == 201
    assert response.json()["travel_duration_minutes"] is None
    assert response.json()["travel_estimate"] is None
    assert response.json()["calculated_departure_time"] is None
    assert "secret detail" not in response.text
    app.dependency_overrides.pop(get_routing_service, None)


def test_manual_route_refresh_success_updates_estimate_and_calculations(api_db: None, signing_key: str) -> None:
    service = StubRouting([estimate(37), estimate(42)])
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    refreshed = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert refreshed.status_code == 200
    assert refreshed.json()["travel_duration_minutes"] == 42
    assert refreshed.json()["calculated_departure_time"] == "2026-10-10T22:18:00Z"
    assert refreshed.json()["travel_estimate"]["duration_minutes"] == 42
    assert "diagnose_unnamed_traffic_sections" not in service.calls[0][2]
    assert service.calls[1][2]["diagnose_unnamed_traffic_sections"] is True
    app.dependency_overrides.pop(get_routing_service, None)


def test_manual_route_refresh_failure_preserves_estimate_and_counts_attempt(api_db: None, signing_key: str) -> None:
    service = StubRouting([estimate(37), RoutingProviderError("private provider error")])
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    before = created.json()
    failed = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert failed.status_code == 502
    assert "private provider error" not in failed.text
    saved = client.get(f"/schedules/{schedule_id}", headers=headers).json()
    assert saved["travel_estimate"] == before["travel_estimate"]
    assert saved["travel_duration_minutes"] == before["travel_duration_minutes"]
    limited = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0
    assert len(service.calls) == 2
    app.dependency_overrides.pop(get_routing_service, None)


def test_no_route_refresh_returns_a_coded_user_actionable_result(api_db: None, signing_key: str) -> None:
    service = StubRouting([estimate(37), RoutingProviderError(reason="no_route")])
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    failed = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert failed.status_code == 422
    assert failed.json()["detail"]["code"] == "no_drivable_route"
    assert "Traffic was not updated" in failed.json()["detail"]["message"]
    app.dependency_overrides.pop(get_routing_service, None)


@pytest.mark.parametrize(
    ("reason", "expected_status", "expected_text"),
    [
        ("timeout", 504, "took too long"),
        ("compute_limit", 504, "calculation limit"),
        ("no_route", 422, "drivable route"),
    ],
)
def test_manual_route_refresh_explains_recoverable_provider_failures_and_keeps_estimate(
    api_db: None, signing_key: str, reason: str, expected_status: int, expected_text: str,
) -> None:
    service = StubRouting([estimate(37), RoutingProviderError(reason=reason)])
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    original_estimate = created.json()["travel_estimate"]
    failed = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert failed.status_code == expected_status
    detail = failed.json()["detail"]
    message = detail["message"] if isinstance(detail, dict) else detail
    assert expected_text in message
    saved = client.get(f"/schedules/{schedule_id}", headers=headers).json()
    assert saved["travel_estimate"] == original_estimate
    app.dependency_overrides.pop(get_routing_service, None)


def test_manual_route_refresh_per_schedule_cooldown_and_ownership(api_db: None, signing_key: str) -> None:
    service = StubRouting(estimate(37))
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    assert client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers).status_code == 200
    second = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
    assert second.status_code == 429
    assert second.json()["detail"] == "This schedule can be refreshed once every 60 seconds."
    assert 1 <= int(second.headers["Retry-After"]) <= 60
    assert client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=bearer(signing_key, "user_beta")).status_code == 404
    app.dependency_overrides.pop(get_routing_service, None)


def test_manual_route_refresh_user_rolling_window_limit(api_db: None, signing_key: str) -> None:
    service = StubRouting(estimate(37))
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    schedule_ids = []
    for index in range(11):
        created = client.post("/schedules", headers=headers, json=route_payload(title=f"Trip {index}"))
        schedule_ids.append(created.json()["id"])
    for schedule_id in schedule_ids[:10]:
        response = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
        assert response.status_code == 200
    limited = client.post(f"/schedules/{schedule_ids[10]}/travel-estimate/refresh", headers=headers)
    assert limited.status_code == 429
    assert "10 route refresh attempts" in limited.json()["detail"]
    assert int(limited.headers["Retry-After"]) > 0
    assert len(service.calls) == 21  # 11 automatic create requests plus 10 refreshes.
    app.dependency_overrides.pop(get_routing_service, None)


def test_concurrent_manual_route_refresh_is_rejected(api_db: None, signing_key: str) -> None:
    entered = Event()
    release = Event()

    class SlowRouting(StubRouting):
        def estimate(self, origin: LocationSelection, destination: LocationSelection, **route_times: datetime) -> TravelEstimate:
            self.calls.append((origin, destination, route_times))
            entered.set()
            release.wait(timeout=5)
            return estimate(42)

    client = TestClient(app)
    headers = bearer(signing_key)
    app.dependency_overrides[get_routing_service] = lambda: StubRouting(estimate(37))
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    service = SlowRouting(estimate(37))
    app.dependency_overrides[get_routing_service] = lambda: service
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(client.post, f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
            assert entered.wait(timeout=2)
            second = client.post(f"/schedules/{schedule_id}/travel-estimate/refresh", headers=headers)
            assert second.status_code == 429
            release.set()
            assert first.result(timeout=5).status_code == 200
            assert len(service.calls) == 1
    finally:
        release.set()
        app.dependency_overrides.pop(get_routing_service, None)


def test_edit_route_failure_persists_unknown_duration_and_refreshed_times(api_db: None, signing_key: str) -> None:
    service = StubRouting([estimate(20), RoutingProviderError("private provider response")])
    app.dependency_overrides[get_routing_service] = lambda: service
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=route_payload())
    schedule_id = created.json()["id"]
    failed_update = client.patch(f"/schedules/{schedule_id}", headers=headers, json={"travel_duration_minutes": None})
    assert failed_update.status_code == 200
    assert failed_update.json()["travel_duration_minutes"] is None
    assert failed_update.json()["travel_estimate"] is None
    assert failed_update.json()["calculated_departure_time"] is None
    assert failed_update.json()["departure_unavailable_reason"] == "Travel duration is unknown."
    app.dependency_overrides.pop(get_routing_service, None)


def test_departure_intent_unknown_travel_keeps_target_and_wake_but_no_arrival(api_db: None, signing_key: str) -> None:
    service = StubRouting(RoutingProviderError())
    app.dependency_overrides[get_routing_service] = lambda: service
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(time_intent="departure", preparation_duration_minutes=30))
    data = response.json()
    assert response.status_code == 201
    assert data["calculated_departure_time"] == data["target_datetime"]
    assert data["calculated_arrival_time"] is None
    assert data["arrival_unavailable_reason"] == "Travel duration is unknown."
    assert data["calculated_wake_time"] == "2026-10-10T22:30:00Z"
    app.dependency_overrides.pop(get_routing_service, None)


@pytest.mark.parametrize("origin,destination", [(None, place("Campus", 14.6, 121.1)), (place("Home", 14.5, 121.0), None)])
def test_missing_endpoint_does_not_request_route_and_preserves_manual_duration(api_db: None, signing_key: str, origin: dict[str, object] | None, destination: dict[str, object] | None) -> None:
    service = StubRouting(estimate())
    app.dependency_overrides[get_routing_service] = lambda: service
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=payload(origin_location=origin, location=destination, travel_duration_minutes=25))
    assert response.status_code == 201
    assert service.calls == []
    assert response.json()["travel_duration_minutes"] == 25
    assert response.json()["calculated_departure_time"] == "2026-10-10T22:35:00Z"
    app.dependency_overrides.pop(get_routing_service, None)


def test_tomtom_routing_requests_traffic_and_validates_response(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{"summary": {"travelTimeInSeconds": 161, "trafficDelayInSeconds": 15, "noTrafficTravelTimeInSeconds": 120, "historicTrafficTravelTimeInSeconds": 157, "liveTrafficIncidentsTravelTimeInSeconds": 161}, "legs": [{"points": [{"latitude": 14.5, "longitude": 121.0}, {"latitude": 14.55, "longitude": 121.05}, {"latitude": 14.6, "longitude": 121.1}]}], "sections": [{"sectionType": "TRAFFIC", "delayInSeconds": 301, "startPointIndex": 0, "endPointIndex": 2, "simpleCategory": "JAM"}, {"sectionType": "TRAFFIC", "delayInSeconds": 900, "startPointIndex": 3, "endPointIndex": 4}, {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 1, "endPointIndex": 2, "streetName": {"text": "Verified Road"}, "roadNumbers": [{"text": "A10"}]}, {"sectionType": "COUNTRY", "delayInSeconds": 999}]}]}

    def fake_get(url: str, *, params: dict[str, object], timeout: float) -> Response:
        assert url.endswith("/14.5,121.0:14.6,121.1/json")
        assert params["key"] == "test-server-key"
        assert params["traffic"] == "true"
        assert params["computeTravelTimeFor"] == "all"
        assert params["sectionType"] == ["traffic", "importantRoadStretch"]
        assert params["routeRepresentation"] == "polyline"
        assert "departAt" not in params and "arriveAt" not in params
        assert timeout == 35.0
        return Response()

    monkeypatch.setattr("routing_service.httpx.get", fake_get)
    before_request = datetime.now(timezone.utc)
    result = TomTomRoutingService(api_key="test-server-key").estimate(
        LocationSelection(name="Home", latitude=14.5, longitude=121.0),
        LocationSelection(name="Campus", latitude=14.6, longitude=121.1),
    )
    assert result.duration_seconds == 161
    assert result.duration_minutes == 3
    assert result.traffic_included is True
    assert result.traffic_delay_minutes == 1
    assert result.traffic_status == "some_delay"
    assert result.traffic_data_source == "live_and_historical_available"
    assert [item.delay_seconds for item in result.traffic_sections] == [301, 900]
    assert result.traffic_sections[0].road_names == ["Verified Road"]
    assert result.traffic_sections[0].road_numbers == ["A10"]
    assert result.traffic_sections[0].incident_type == "JAM"
    assert result.traffic_sections[0].start_coordinates.latitude == 14.5
    assert result.traffic_sections[0].end_coordinates.longitude == 121.1
    assert result.traffic_sections[1].road_names == []
    assert result.traffic_sections[1].end_coordinates is None
    assert before_request <= result.retrieved_at <= datetime.now(timezone.utc)


def test_route_delay_and_incident_delays_remain_independent_provider_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{
                "summary": {
                    "travelTimeInSeconds": 79 * 60,
                    "trafficDelayInSeconds": 17 * 60,
                    "noTrafficTravelTimeInSeconds": 63 * 60,
                },
                "sections": [
                    {"sectionType": "TRAFFIC", "delayInSeconds": 299},
                    {"sectionType": "TRAFFIC", "delayInSeconds": 600},
                    {"sectionType": "TRAFFIC", "delayInSeconds": 61},
                ],
            }]}

    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(
        LocationSelection(name="A", latitude=1, longitude=2),
        LocationSelection(name="B", latitude=3, longitude=4),
    )

    assert result.duration_seconds == 79 * 60
    assert result.traffic_delay_seconds == 17 * 60
    assert result.traffic_delay_minutes == 17
    assert [section.delay_seconds for section in result.traffic_sections] == [299, 600, 61]
    assert sum(section.delay_seconds for section in result.traffic_sections) != result.traffic_delay_seconds


def test_traffic_sections_match_inclusive_boundary_and_keep_missing_data_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{"summary": {"travelTimeInSeconds": 600}, "sections": [
                {"sectionType": "TRAFFIC", "simpleCategory": "ROAD_WORK", "startPointIndex": 1, "endPointIndex": 2},
                {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 2, "endPointIndex": 4, "streetName": {"text": "Boundary road"}},
                {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 3, "endPointIndex": 4, "streetName": {"text": "Unrelated road"}},
            ]}]}

    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(
        LocationSelection(name="A", latitude=1, longitude=2),
        LocationSelection(name="B", latitude=3, longitude=4),
    )
    assert len(result.traffic_sections) == 1
    section = result.traffic_sections[0]
    assert section.delay_seconds is None and section.severity is None
    assert section.road_names == ["Boundary road"]
    assert section.start_coordinates is None and section.end_coordinates is None
    assert section.incident_type == "ROAD_WORK"


def test_traffic_section_without_a_matching_road_keeps_coordinates_internally(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{"summary": {"travelTimeInSeconds": 600}, "legs": [{"points": [
                {"latitude": 14.582, "longitude": 121.0579},
                {"latitude": 14.5791, "longitude": 121.0562},
                {"latitude": 14.57, "longitude": 121.05},
            ]}], "sections": [
                {"sectionType": "TRAFFIC", "startPointIndex": 0, "endPointIndex": 1, "delayInSeconds": 61},
                {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 2, "endPointIndex": 2, "streetName": {"text": "Unrelated road"}},
            ]}]}

    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(
        LocationSelection(name="A", latitude=1, longitude=2),
        LocationSelection(name="B", latitude=3, longitude=4),
    )
    section = result.traffic_sections[0]
    assert section.road_names == []
    assert section.start_coordinates.latitude == 14.582
    assert section.end_coordinates.longitude == 121.0562


def test_reverse_geocode_only_fills_missing_or_ambiguous_roads_and_keeps_fallback_separate() -> None:
    route = {
        "legs": [{"points": [
            {"latitude": 14.50, "longitude": 121.00},
            {"latitude": 14.51, "longitude": 121.01},
            {"latitude": 14.52, "longitude": 121.02},
        ]}],
        "sections": [
            {"sectionType": "TRAFFIC", "startPointIndex": 0, "endPointIndex": 0, "simpleCategory": "JAM"},
            {"sectionType": "TRAFFIC", "startPointIndex": 1, "endPointIndex": 1, "simpleCategory": "ROAD_WORK"},
            {"sectionType": "TRAFFIC", "startPointIndex": 2, "endPointIndex": 2, "simpleCategory": "JAM"},
            {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 2, "endPointIndex": 2, "streetName": {"text": "Verified Road"}},
            {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 1, "endPointIndex": 1, "streetName": {"text": "First candidate"}},
            {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 1, "endPointIndex": 1, "streetName": {"text": "Second candidate"}},
        ],
    }
    requested: list[tuple[float, float]] = []

    def lookup(coordinate: object) -> str:
        requested.append((coordinate.latitude, coordinate.longitude))
        return "Nearby Street"

    traffic = _traffic_sections(route, geocode=lookup)
    assert requested == [(14.50, 121.00), (14.51, 121.01)]
    assert traffic[0].road_names == []
    assert traffic[0].approximate_location == "Nearby Street"
    assert traffic[0].location_source == "reverse_geocoding"
    assert traffic[1].road_names == [] and traffic[1].road_numbers == []
    assert traffic[1].approximate_location == "Nearby Street"
    assert traffic[1].location_source == "reverse_geocoding"
    assert traffic[2].road_names == ["Verified Road"]
    assert traffic[2].approximate_location is None
    assert traffic[2].location_source == "verified_route_metadata"
    restored = TrafficSection.model_validate(traffic[0].model_dump(mode="json"))
    assert restored.approximate_location == "Nearby Street"
    assert restored.location_source == "reverse_geocoding"


def test_reverse_geocode_uses_traffic_section_midpoint_and_skips_missing_coordinates() -> None:
    route = {
        "legs": [{"points": [
            {"latitude": 14.50, "longitude": 121.00},
            {"latitude": 14.51, "longitude": 121.01},
            {"latitude": 14.52, "longitude": 121.02},
        ]}],
        "sections": [
            {"sectionType": "TRAFFIC", "startPointIndex": 0, "endPointIndex": 2},
            {"sectionType": "TRAFFIC", "startPointIndex": 9, "endPointIndex": 10},
        ],
    }
    points: list[tuple[float, float]] = []

    def lookup(point: TrafficCoordinate) -> str:
        points.append((point.latitude, point.longitude))
        return "Nearby Road"

    sections = _traffic_sections(route, geocode=lookup)
    assert points == [(14.51, 121.01)]
    assert sections[0].approximate_location == "Nearby Road"
    assert sections[1].approximate_location is None
    assert sections[1].location_source == "unavailable"


def test_reverse_geocode_fallback_request_limit_and_empty_or_timeout_results() -> None:
    route = {
        "legs": [{"points": [{"latitude": 14.5 + i / 100, "longitude": 121 + i / 100} for i in range(5)]}],
        "sections": [{"sectionType": "TRAFFIC", "startPointIndex": i, "endPointIndex": i} for i in range(5)],
    }
    calls: list[int] = []

    def lookup(_coordinate: object) -> None:
        calls.append(1)
        if len(calls) == 2:
            raise httpx.ReadTimeout("sanitized test timeout")
        return None

    traffic = _traffic_sections(route, geocode=lookup, request_limit=3)
    assert len(calls) == 3
    assert all(section.approximate_location is None for section in traffic)
    assert all(section.location_source == "unavailable" for section in traffic)


def test_reverse_geocoder_uses_server_key_short_timeout_and_caches_results(monkeypatch: pytest.MonkeyPatch) -> None:
    with _reverse_geocode_cache_lock:
        _reverse_geocode_cache.clear()


def test_reverse_geocoder_caches_empty_results_and_timeouts_without_raising(monkeypatch: pytest.MonkeyPatch) -> None:
    with _reverse_geocode_cache_lock:
        _reverse_geocode_cache.clear()
    calls = 0

    class EmptyResponse:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]: return {"addresses": []}

    def fake_get(url: str, **kwargs: object) -> EmptyResponse:
        nonlocal calls
        calls += 1
        if ",121.01.json" in url:
            raise httpx.ReadTimeout("test timeout")
        return EmptyResponse()

    monkeypatch.setattr("routing_service.httpx.get", fake_get)
    from schemas import TrafficCoordinate
    empty_point = TrafficCoordinate(latitude=14.5, longitude=121.0)
    timeout_point = TrafficCoordinate(latitude=14.51, longitude=121.01)
    assert _reverse_geocode_location(empty_point, "test-server-key") is None
    assert _reverse_geocode_location(empty_point, "test-server-key") is None
    assert _reverse_geocode_location(timeout_point, "test-server-key") is None
    assert _reverse_geocode_location(timeout_point, "test-server-key") is None
    assert calls == 2
    with _reverse_geocode_cache_lock:
        _reverse_geocode_cache.clear()
    calls: list[tuple[str, dict[str, object], float]] = []

    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"addresses": [{"address": {"streetName": "Ortigas Avenue", "streetNumber": "42"}}]}

    def fake_get(url: str, *, params: dict[str, object], timeout: float) -> Response:
        calls.append((url, params, timeout))
        return Response()

    monkeypatch.setattr("routing_service.httpx.get", fake_get)
    coordinate = LocationSelection(name="route point", latitude=14.582, longitude=121.0579)
    from schemas import TrafficCoordinate
    point = TrafficCoordinate(latitude=coordinate.latitude, longitude=coordinate.longitude)
    assert _reverse_geocode_location(point, "test-server-key") == "Ortigas Avenue"
    assert _reverse_geocode_location(point, "test-server-key") == "Ortigas Avenue"
    assert len(calls) == 1
    url, params, timeout = calls[0]
    assert url.endswith("/14.582,121.0579.json")
    assert params["key"] == "test-server-key"
    assert params["radius"] == "50"
    assert timeout <= 2.0
    with _reverse_geocode_cache_lock:
        _reverse_geocode_cache.clear()


def test_manual_refresh_diagnostics_log_sanitized_nearby_road_metadata(caplog: pytest.LogCaptureFixture) -> None:
    route = {"legs": [{"points": [
        {"latitude": 14.582, "longitude": 121.0579},
        {"latitude": 14.5791, "longitude": 121.0562},
    ]}], "sections": [
        {"sectionType": "TRAFFIC", "startPointIndex": 10, "endPointIndex": 12, "delayInSeconds": 61},
        {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 8, "endPointIndex": 9, "streetName": {"text": "Nearby Road"}, "roadNumbers": [{"text": "R7"}]},
        {"sectionType": "IMPORTANT_ROAD_STRETCH", "startPointIndex": 13, "endPointIndex": 14, "streetName": {"text": "Beyond Range"}},
    ]}
    with caplog.at_level("INFO", logger="routing_service"):
        sections = _traffic_sections(route, diagnose_unnamed=True)

    assert sections[0].road_names == []
    diagnostic = " ".join(record.getMessage() for record in caplog.records)
    assert "traffic_indexes=10-12" in diagnostic
    assert "Nearby Road" in diagnostic and "R7" in diagnostic
    assert "nearest_road_metadata_does_not_overlap" in diagnostic
    assert "Beyond Range" in diagnostic
    assert "14.582" not in diagnostic and "121.0579" not in diagnostic


@pytest.mark.parametrize(("summary", "status", "delay"), [
    ({"travelTimeInSeconds": 600}, "unavailable", None),
    ({"travelTimeInSeconds": 600, "trafficDelayInSeconds": 0}, "unavailable", None),
    ({"travelTimeInSeconds": 600, "trafficDelayInSeconds": 0, "noTrafficTravelTimeInSeconds": 600}, "little_or_no_delay", 0),
    # Realistic TomTom response: total best estimate need not equal free-flow + real-time delay,
    # because historical and live comparison times are separate response metrics.
    ({"travelTimeInSeconds": 161, "trafficDelayInSeconds": 15, "noTrafficTravelTimeInSeconds": 120, "historicTrafficTravelTimeInSeconds": 157, "liveTrafficIncidentsTravelTimeInSeconds": 161}, "some_delay", 1),
    ({"travelTimeInSeconds": 1800, "trafficDelayInSeconds": 900, "noTrafficTravelTimeInSeconds": 900}, "significant_delay", 15),
])
def test_traffic_status_requires_valid_comparison_data(monkeypatch: pytest.MonkeyPatch, summary: dict[str, int], status: str, delay: int | None) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]: return {"routes": [{"summary": summary}]}
    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
    assert result.traffic_status == status
    assert result.traffic_delay_minutes == delay


def test_invalid_optional_traffic_fields_do_not_discard_route_duration(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{"summary": {"travelTimeInSeconds": 600, "trafficDelayInSeconds": "bad", "noTrafficTravelTimeInSeconds": -1}}]}
    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
    assert result.duration_minutes == 10
    assert result.traffic_status == "unavailable"
    assert result.traffic_delay_minutes is None


@pytest.mark.parametrize(("field", "expected_status", "expected_delay"), [
    ("trafficDelayInSeconds", "unavailable", None),
    ("noTrafficTravelTimeInSeconds", "unavailable", None),
    ("historicTrafficTravelTimeInSeconds", "little_or_no_delay", 0),
    ("liveTrafficIncidentsTravelTimeInSeconds", "little_or_no_delay", 0),
])
def test_invalid_traffic_fields_are_independently_ignored(monkeypatch: pytest.MonkeyPatch, field: str, expected_status: str, expected_delay: int | None) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"routes": [{"summary": {"travelTimeInSeconds": 600, "trafficDelayInSeconds": 0, "noTrafficTravelTimeInSeconds": 600, "historicTrafficTravelTimeInSeconds": 600, "liveTrafficIncidentsTravelTimeInSeconds": 600, field: -2}}]}
    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    result = TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
    assert result.duration_seconds == 600
    assert result.traffic_status == expected_status
    assert result.traffic_delay_minutes == expected_delay


@pytest.mark.parametrize(("route_time", "parameter"), [("depart_at", "departAt"), ("arrive_at", "arriveAt")])
def test_tomtom_sends_intended_route_time(monkeypatch: pytest.MonkeyPatch, route_time: str, parameter: str) -> None:
    captured: dict[str, object] = {}
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]: return {"routes": [{"summary": {"travelTimeInSeconds": 600}}]}
    def fake_get(url: str, *, params: dict[str, object], timeout: float) -> Response:
        captured.update(params)
        return Response()
    monkeypatch.setattr("routing_service.httpx.get", fake_get)
    planned = datetime(2026, 10, 15, 0, 0, tzinfo=timezone.utc)
    result = TomTomRoutingService(api_key="test-server-key").estimate(
        LocationSelection(name="A", latitude=1, longitude=2),
        LocationSelection(name="B", latitude=3, longitude=4),
        **{route_time: planned},
    )
    assert captured[parameter] == "2026-10-15T00:00:00Z"
    assert not ("arriveAt" in captured and "departAt" in captured)
    assert result.route_time_basis == ("scheduled_arrival" if parameter == "arriveAt" else "scheduled_departure")


@pytest.mark.parametrize("intent,expected_param", [("arrival", "arriveAt"), ("departure", "departAt")])
def test_future_schedule_routes_using_scheduled_time(api_db: None, signing_key: str, intent: str, expected_param: str) -> None:
    service = StubRouting(estimate(37))
    app.dependency_overrides[get_routing_service] = lambda: service
    target = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    route_input = route_payload(time_intent=intent, target_datetime=target.isoformat())
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_input)
    assert response.status_code == 201
    assert service.calls[0][2] == {"arrive_at" if expected_param == "arriveAt" else "depart_at": target.replace(microsecond=0)}
    assert response.json()["travel_estimate"]["route_time_basis"] == ("scheduled_arrival" if intent == "arrival" else "scheduled_departure")
    # Arrival routing uses one arriveAt-conditioned route; deterministic calculation consumes it once,
    # without making a second request from its own calculated departure.
    assert len(service.calls) == 1
    app.dependency_overrides.pop(get_routing_service, None)


@pytest.mark.parametrize("body", [{"routes": []}, {"routes": [{"summary": {"travelTimeInSeconds": -1}}]}, {"bad": []}])
def test_tomtom_routing_rejects_invalid_or_missing_routes(monkeypatch: pytest.MonkeyPatch, body: dict[str, object]) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]: return body
    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    service = TomTomRoutingService(api_key="test-server-key")
    with pytest.raises(RoutingProviderError):
        service.estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))


def test_tomtom_routing_maps_timeout_to_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    def fail(*args: object, **kwargs: object) -> None:
        captured.update(kwargs)
        raise httpx.ReadTimeout("secret")
    monkeypatch.setattr("routing_service.httpx.get", fail)
    with pytest.raises(RoutingProviderError) as error:
        TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
    assert error.value.reason == "timeout"
    assert captured["timeout"] == 35.0


@pytest.mark.parametrize(("code", "reason"), [("COMPUTE_TIME_LIMIT_EXCEEDED", "compute_limit"), ("SOME_PRIVATE_CODE", "provider_error")])
def test_tomtom_classifies_allowlisted_computation_errors_without_exposing_payload(
    monkeypatch: pytest.MonkeyPatch, code: str, reason: str,
) -> None:
    class Response:
        def raise_for_status(self) -> None:
            request = httpx.Request("GET", "https://api.tomtom.com/routing/1/calculateRoute")
            response = httpx.Response(400, request=request)
            raise httpx.HTTPStatusError("provider text", request=request, response=response)
        def json(self) -> dict[str, object]:
            return {"detailedError": {"code": code, "message": "private provider response"}}
    monkeypatch.setattr("routing_service.httpx.get", lambda *args, **kwargs: Response())
    with pytest.raises(RoutingProviderError) as error:
        TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
    assert error.value.reason == reason
    assert "private provider response" not in str(error.value)
