import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from location_service import (
    LocationProviderConfigurationError,
    LocationProviderError,
    TomTomSearchService,
    _landmark_cache,
    _landmark_cache_lock,
)
from main import app
from schemas import LocationSelection, RouteLandmark, TrafficCoordinate
from routers.locations import get_location_service
from routers.schedules import get_route_landmark_service
from test_schedule_api import api_db, bearer, signing_key


class StubLocationService:
    def __init__(self, result: list[LocationSelection] | Exception) -> None:
        self.result = result
        self.queries: list[str] = []

    def search(self, query: str) -> list[LocationSelection]:
        self.queries.append(query)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class StubLandmarkService:
    def landmarks_along_route(self, route_points: object) -> list[RouteLandmark]:
        assert len(route_points) >= 2
        return [RouteLandmark(name="Central Hospital", category="hospital", latitude=14.6, longitude=121.0)]


def sample_location() -> LocationSelection:
    return LocationSelection(
        name="Central School", locality="Manila", region="Metro Manila",
        country="Philippines", latitude=14.5995, longitude=120.9842,
        timezone="Asia/Manila",
    )


def test_location_schema_rejects_out_of_range_and_nan_coordinates() -> None:
    with pytest.raises(ValidationError):
        LocationSelection(name="Bad", latitude=91, longitude=0)
    with pytest.raises(ValidationError):
        LocationSelection(name="Bad", latitude=float("nan"), longitude=0)


def test_location_search_requires_authentication() -> None:
    assert TestClient(app).post("/locations/search", json={"query": "Central School"}).status_code == 401


def test_location_search_validates_query_and_returns_multiple_candidates(
    signing_key: str,
) -> None:
    service = StubLocationService([sample_location(), sample_location().model_copy(update={"name": "Central School Annex"})])
    app.dependency_overrides[get_location_service] = lambda: service
    response = TestClient(app).post(
        "/locations/search", headers=bearer(signing_key), json={"query": "Central School"}
    )
    assert response.status_code == 200
    assert len(response.json()["results"]) == 2
    assert service.queries == ["Central School"]
    invalid = TestClient(app).post("/locations/search", headers=bearer(signing_key), json={"query": " "})
    assert invalid.status_code == 422
    app.dependency_overrides.pop(get_location_service, None)


def test_location_search_returns_empty_results_without_selecting_a_match(signing_key: str) -> None:
    app.dependency_overrides[get_location_service] = lambda: StubLocationService([])
    response = TestClient(app).post(
        "/locations/search", headers=bearer(signing_key), json={"query": "No matching place"}
    )
    assert response.status_code == 200
    assert response.json() == {"results": []}
    app.dependency_overrides.pop(get_location_service, None)


def test_location_provider_failure_is_safe_and_reported_as_bad_gateway(signing_key: str) -> None:
    app.dependency_overrides[get_location_service] = lambda: StubLocationService(LocationProviderError())
    response = TestClient(app).post(
        "/locations/search", headers=bearer(signing_key), json={"query": "Central School"}
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Location search is temporarily unavailable"
    app.dependency_overrides.pop(get_location_service, None)


def test_tomtom_service_uses_fuzzy_typeahead_and_validates_results(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"results": [
                {"poi": {"name": "Central School"}, "address": {"municipality": "Manila", "countrySubdivisionName": "Metro Manila", "country": "Philippines"}, "position": {"lat": 14.6, "lon": 121.0}, "timeZone": {"ianaId": "Asia/Manila"}},
                {"poi": {"name": "Invalid"}, "position": {"lat": 999, "lon": 0}},
            ]}

    def fake_get(url: str, *, params: dict[str, object], timeout: httpx.Timeout) -> Response:
        assert url == "https://api.tomtom.com/search/2/search/Central%20School.json"
        assert params["key"] == "server-test-key"
        assert params["typeahead"] == "true"
        assert params["timeZone"] == "iana"
        assert timeout.connect == 2.0 and timeout.read == 5.0 and timeout.write == 2.0 and timeout.pool == 2.0
        return Response()

    monkeypatch.setattr("location_service.httpx.get", fake_get)
    results = TomTomSearchService(api_key="server-test-key").search("Central School")
    assert len(results) == 1
    assert results[0].locality == "Manila"
    assert results[0].latitude == 14.6


def test_tomtom_service_maps_network_timeouts_to_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(*args: object, **kwargs: object) -> None:
        raise httpx.ReadTimeout("timeout")

    monkeypatch.setattr("location_service.httpx.get", timeout)
    with pytest.raises(LocationProviderError):
        TomTomSearchService(api_key="server-test-key").search("School")


def test_tomtom_service_returns_no_results_for_empty_query(monkeypatch: pytest.MonkeyPatch) -> None:
    def should_not_call(*args: object, **kwargs: object) -> None:
        raise AssertionError("empty search should not call TomTom")

    monkeypatch.setattr("location_service.httpx.get", should_not_call)
    assert TomTomSearchService(api_key="server-test-key").search("  ") == []


def test_tomtom_service_requires_server_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TOMTOM_API_KEY", raising=False)
    monkeypatch.setattr("location_service.load_dotenv", lambda **kwargs: None)
    with pytest.raises(LocationProviderConfigurationError):
        TomTomSearchService()


def test_route_landmarks_are_authenticated_and_validated(signing_key: str) -> None:
    client = TestClient(app)
    request = {"route_points": [
        {"latitude": 14.5, "longitude": 120.9},
        {"latitude": 14.6, "longitude": 121.0},
    ]}
    assert client.post("/schedules/route-landmarks", json=request).status_code == 401
    app.dependency_overrides[get_route_landmark_service] = lambda: StubLandmarkService()
    response = client.post("/schedules/route-landmarks", headers=bearer(signing_key), json=request)
    assert response.status_code == 200
    assert response.json()[0]["category"] == "hospital"
    assert client.post("/schedules/route-landmarks", headers=bearer(signing_key), json={"route_points": [{"latitude": 91, "longitude": 0}]}).status_code == 422
    app.dependency_overrides.pop(get_route_landmark_service, None)


def test_tomtom_landmark_search_is_bounded_validated_and_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    with _landmark_cache_lock:
        _landmark_cache.clear()
    calls = 0

    class Response:
        def raise_for_status(self) -> None: pass
        def json(self) -> dict[str, object]:
            return {"results": [
                {"poi": {"name": "Central Hospital", "categorySet": [{"id": 7321}]}, "position": {"lat": 14.6, "lon": 121.0}},
                {"poi": {"name": "City School", "categorySet": [{"id": 7372}]}, "position": {"lat": 14.61, "lon": 121.01}},
                {"poi": {"name": "Bad coordinate", "categorySet": [{"id": 7372}]}, "position": {"lat": 999, "lon": 121}},
                {"poi": {"name": "Unrequested type", "categorySet": [{"id": 1234}]}, "position": {"lat": 14.6, "lon": 121}},
            ]}

    def fake_post(url: str, *, params: dict[str, object], json: dict[str, object], timeout: httpx.Timeout) -> Response:
        nonlocal calls
        calls += 1
        assert url == "https://api.tomtom.com/search/2/searchAlongRoute/.json"
        assert params["key"] == "server-test-key"
        assert params["categorySet"] == "7321,7372"
        assert params["limit"] == 20
        assert params["maxDetourTime"] == 300
        assert len(json["route"]["points"]) == 100
        assert timeout.connect == 2.0 and timeout.read == 5.0 and timeout.write == 2.0 and timeout.pool == 2.0
        return Response()

    monkeypatch.setattr("location_service.httpx.post", fake_post)
    points = [TrafficCoordinate(latitude=14.5 + index / 10000, longitude=120.9 + index / 10000) for index in range(150)]
    service = TomTomSearchService(api_key="server-test-key")
    results = service.landmarks_along_route(points)
    assert [item.category for item in results] == ["hospital", "school"]
    assert results[0].name == "Central Hospital"
    assert service.landmarks_along_route(points) == results
    assert calls == 1


def test_selected_location_persists_with_schedule(api_db: None, signing_key: str) -> None:
    payload = {
        "title": "Class", "description": None, "time_intent": "arrival",
        "target_datetime": "2026-10-11T07:00:00+08:00", "timezone": "Asia/Manila",
        "preparation_duration_minutes": None, "travel_duration_minutes": None,
        "location": sample_location().model_dump(),
    }
    client = TestClient(app)
    headers = bearer(signing_key)
    created = client.post("/schedules", headers=headers, json=payload)
    assert created.status_code == 201
    assert created.json()["location"]["latitude"] == 14.5995
    reloaded = client.get(f"/schedules/{created.json()['id']}", headers=headers)
    assert reloaded.json()["location"] == created.json()["location"]

    updated = client.patch(
        f"/schedules/{created.json()['id']}", headers=headers,
        json={"title": "Renamed class"},
    )
    assert updated.status_code == 200
    assert updated.json()["location"] == created.json()["location"]

    replacement = sample_location().model_copy(update={"name": "Central School Annex", "latitude": 14.61})
    changed = client.patch(
        f"/schedules/{created.json()['id']}", headers=headers,
        json={"location": replacement.model_dump(mode="json")},
    )
    assert changed.status_code == 200
    assert changed.json()["location"]["name"] == "Central School Annex"
    assert changed.json()["location"]["latitude"] == 14.61
