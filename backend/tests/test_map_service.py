import httpx
import pytest

from map_service import MapProviderError, TomTomMapService


def test_static_image_uses_server_key_and_bounded_map_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOMTOM_API_KEY", "server-secret")
    captured: dict[str, object] = {}

    class Response:
        headers = {"content-type": "image/png"}
        content = b"image-bytes"

        def raise_for_status(self) -> None:
            return None

    def fake_get(url: str, *, params: dict[str, object], timeout: float) -> Response:
        captured.update(url=url, params=params, timeout=timeout)
        return Response()

    monkeypatch.setattr("map_service.httpx.get", fake_get)
    image, media_type = TomTomMapService().static_image((-123.1, 37.0, -122.0, 38.0))
    assert image == b"image-bytes"
    assert media_type == "image/png"
    assert captured["url"] == "https://api.tomtom.com/map/1/staticimage"
    assert captured["timeout"] == 8.0
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["key"] == "server-secret"
    assert params["center"].startswith("-122.55,")
    assert params["layer"] == "basic"
    assert params["width"] == 960
    assert params["zoom"] == 8


def test_static_image_at_uses_fixed_interactive_viewport_and_rejects_invalid_coordinates(monkeypatch: pytest.MonkeyPatch) -> None:
    service = TomTomMapService(api_key="server-secret")
    captured: dict[str, object] = {}

    class Response:
        headers = {"content-type": "image/png"}
        content = b"image-bytes"
        def raise_for_status(self) -> None: pass

    def fake_get(_url: str, *, params: dict[str, object], timeout: float) -> Response:
        captured.update(params=params, timeout=timeout)
        return Response()

    monkeypatch.setattr("map_service.httpx.get", fake_get)
    assert service.static_image_at(14.6, 121.0, 16) == (b"image-bytes", "image/png")
    params = captured["params"]
    assert isinstance(params, dict) and params["center"] == "121.0,14.6" and params["zoom"] == 16
    with pytest.raises(ValueError):
        service.static_image_at(90, 0, 16)


def test_static_image_maps_provider_failures_safely(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOMTOM_API_KEY", "server-secret")

    def fail(*args: object, **kwargs: object) -> None:
        raise httpx.TimeoutException("private provider details")

    monkeypatch.setattr("map_service.httpx.get", fail)
    with pytest.raises(MapProviderError, match="Map image request timed out") as error:
        TomTomMapService().static_image((-123.1, 37.0, -122.0, 38.0))
    assert error.value.reason == "timeout"


@pytest.mark.parametrize(("status", "reason"), [(403, "credentials"), (429, "rate_limit"), (500, "provider_error")])
def test_static_image_classifies_provider_status_without_exposing_response(
    monkeypatch: pytest.MonkeyPatch, status: int, reason: str,
) -> None:
    monkeypatch.setenv("TOMTOM_API_KEY", "server-secret")
    response = httpx.Response(status, request=httpx.Request("GET", "https://api.tomtom.com/map/1/staticimage"), text="provider detail")
    monkeypatch.setattr("map_service.httpx.get", lambda *args, **kwargs: response)
    with pytest.raises(MapProviderError) as error:
        TomTomMapService().static_image((-123.1, 37.0, -122.0, 38.0))
    assert error.value.reason == reason
    assert error.value.provider_status == status
    assert "provider detail" not in str(error.value)


def test_static_image_rejects_non_image_provider_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOMTOM_API_KEY", "server-secret")

    class Response:
        headers = {"content-type": "text/plain"}
        content = b"provider error"

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr("map_service.httpx.get", lambda *args, **kwargs: Response())
    with pytest.raises(MapProviderError, match="Map image response was invalid"):
        TomTomMapService().static_image((-123.1, 37.0, -122.0, 38.0))
