from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient

from main import app
from routers.schedules import get_routing_service
from routers.schedules import get_weather_service
from routing_service import RoutingProviderError, TomTomRoutingService
from schemas import LocationSelection, TravelEstimate, WeatherEstimate
from test_schedule_api import api_db, bearer, payload, signing_key


def place(name: str, latitude: float, longitude: float) -> dict[str, object]:
    return LocationSelection(name=name, latitude=latitude, longitude=longitude).model_dump()


class StubRouting:
    def __init__(self, result: TravelEstimate | Exception | list[TravelEstimate | Exception]) -> None:
        self.result = result
        self.calls: list[tuple[LocationSelection, LocationSelection, dict[str, datetime]]] = []

    def estimate(self, origin: LocationSelection, destination: LocationSelection, **route_times: datetime) -> TravelEstimate:
        self.calls.append((origin, destination, route_times))
        current = self.result.pop(0) if isinstance(self.result, list) else self.result
        if isinstance(current, Exception):
            raise current
        basis = "scheduled_arrival" if "arrive_at" in route_times else "scheduled_departure" if "depart_at" in route_times else "current"
        return current.model_copy(update={"route_time_basis": basis})


class StubWeather:
    def __init__(self, results: list[WeatherEstimate] | None = None) -> None:
        self.results = results or [
            WeatherEstimate(status="available", summary="Heavy rain near Campus", buffer_minutes=10, retrieved_at="2026-10-13T00:00:00Z", forecast_at="2026-10-13T00:00:00Z", conditions=["Heavy rain near Campus"])
        ]
        self.calls: list[tuple[datetime, datetime]] = []

    def assess(self, *args: object) -> WeatherEstimate:
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


@pytest.mark.parametrize(
    ("intent", "expected_departure", "expected_arrival"),
    [
        ("arrival", "2026-10-10T23:20:00Z", "2026-10-11T00:00:00Z"),
        ("departure", "2026-10-11T00:00:00Z", "2026-10-11T00:40:00Z"),
    ],
)
def test_weather_buffer_preserves_departure_intent_and_adjusts_arrival_intent(
    api_db: None, signing_key: str, intent: str, expected_departure: str, expected_arrival: str,
) -> None:
    weather = StubWeather()
    app.dependency_overrides[get_weather_service] = lambda: weather
    client = TestClient(app)
    created = client.post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent=intent,
        target_datetime="2026-10-11T00:00:00Z",
        travel_duration_minutes=30,
    ))
    assert created.status_code == 201
    body = created.json()
    assert body["calculated_departure_time"] == expected_departure
    assert body["calculated_arrival_time"] == expected_arrival
    assert body["weather_estimate"]["buffer_minutes"] == 10
    assert len(weather.calls) == 2
    if intent == "arrival":
        assert weather.calls[0] == (datetime(2026, 10, 10, 23, 30, tzinfo=timezone.utc), datetime(2026, 10, 11, 0, tzinfo=timezone.utc))
        assert weather.calls[1] == (datetime(2026, 10, 10, 23, 20, tzinfo=timezone.utc), datetime(2026, 10, 11, 0, tzinfo=timezone.utc))
        assert body["weather_estimate"]["origin_forecast_at"] == "2026-10-10T23:00:00Z"
        assert body["weather_estimate"]["destination_forecast_at"] == "2026-10-11T00:00:00Z"
    else:
        assert weather.calls[0] == (datetime(2026, 10, 11, 0, tzinfo=timezone.utc), datetime(2026, 10, 11, 0, 30, tzinfo=timezone.utc))
        assert weather.calls[1] == (datetime(2026, 10, 11, 0, tzinfo=timezone.utc), datetime(2026, 10, 11, 0, 40, tzinfo=timezone.utc))
        assert body["calculated_departure_time"] == "2026-10-11T00:00:00Z"
        assert body["weather_estimate"]["destination_forecast_at"] == "2026-10-11T00:00:00Z"
    app.dependency_overrides.pop(get_weather_service, None)


def test_second_pass_stronger_weather_is_applied_once_and_is_bounded(api_db: None, signing_key: str) -> None:
    first = WeatherEstimate(status="available", summary="Rain", buffer_minutes=5, retrieved_at="2026-10-13T00:00:00Z", conditions=["Rain"])
    second = WeatherEstimate(status="available", summary="Snow", buffer_minutes=15, retrieved_at="2026-10-13T00:05:00Z", conditions=["Snow"])
    weather = StubWeather([first, second])
    app.dependency_overrides[get_weather_service] = lambda: weather
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent="arrival", target_datetime="2026-10-11T00:00:00Z", travel_duration_minutes=30,
    ))
    body = response.json()
    assert response.status_code == 201
    assert body["calculated_departure_time"] == "2026-10-10T23:15:00Z"
    assert body["weather_estimate"]["buffer_minutes"] == 15
    assert body["weather_estimate"]["timing_note"] is not None
    assert len(weather.calls) == 2
    assert weather.calls[1] == (datetime(2026, 10, 10, 23, 25, tzinfo=timezone.utc), datetime(2026, 10, 11, 0, tzinfo=timezone.utc))
    app.dependency_overrides.pop(get_weather_service, None)


def test_failed_second_weather_pass_falls_back_to_base_calculation(api_db: None, signing_key: str) -> None:
    first = WeatherEstimate(status="available", summary="Rain", buffer_minutes=10, retrieved_at="2026-10-13T00:00:00Z", conditions=["Rain"])
    unavailable = WeatherEstimate(status="unavailable", summary="Forecast unavailable; no weather buffer applied.", buffer_minutes=0, retrieved_at=None)
    weather = StubWeather([first, unavailable])
    app.dependency_overrides[get_weather_service] = lambda: weather
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent="arrival", target_datetime="2026-10-11T00:00:00Z", travel_duration_minutes=30,
    ))
    body = response.json()
    assert response.status_code == 201
    assert body["calculated_departure_time"] == "2026-10-10T23:30:00Z"
    assert body["weather_estimate"]["status"] == "unavailable"
    assert body["weather_estimate"]["buffer_minutes"] == 0
    assert len(weather.calls) == 2
    app.dependency_overrides.pop(get_weather_service, None)


def test_zero_weather_buffer_does_not_make_a_second_assessment(api_db: None, signing_key: str) -> None:
    clear = WeatherEstimate(status="available", summary="Clear", buffer_minutes=0, retrieved_at="2026-10-13T00:00:00Z", conditions=[])
    weather = StubWeather([clear])
    app.dependency_overrides[get_weather_service] = lambda: weather
    response = TestClient(app).post("/schedules", headers=bearer(signing_key), json=route_payload(
        time_intent="arrival", target_datetime="2026-10-11T00:00:00Z", travel_duration_minutes=30,
    ))
    body = response.json()
    assert response.status_code == 201
    assert body["calculated_departure_time"] == "2026-10-10T23:30:00Z"
    assert len(weather.calls) == 1
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
            return {"routes": [{"summary": {"travelTimeInSeconds": 161, "trafficDelayInSeconds": 15, "noTrafficTravelTimeInSeconds": 120, "historicTrafficTravelTimeInSeconds": 157, "liveTrafficIncidentsTravelTimeInSeconds": 161}, "sections": [{"sectionType": "TRAFFIC", "delayInSeconds": 301}, {"sectionType": "TRAFFIC", "delayInSeconds": 900}, {"sectionType": "COUNTRY", "delayInSeconds": 999}]}]}

    def fake_get(url: str, *, params: dict[str, object], timeout: float) -> Response:
        assert url.endswith("/14.5,121.0:14.6,121.1/json")
        assert params["key"] == "test-server-key"
        assert params["traffic"] == "true"
        assert params["computeTravelTimeFor"] == "all"
        assert params["sectionType"] == "traffic"
        assert "departAt" not in params and "arriveAt" not in params
        assert timeout <= 10
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
    assert before_request <= result.retrieved_at <= datetime.now(timezone.utc)


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
    def fail(*args: object, **kwargs: object) -> None: raise httpx.ReadTimeout("secret")
    monkeypatch.setattr("routing_service.httpx.get", fail)
    with pytest.raises(RoutingProviderError):
        TomTomRoutingService(api_key="test-server-key").estimate(LocationSelection(name="A", latitude=1, longitude=2), LocationSelection(name="B", latitude=3, longitude=4))
