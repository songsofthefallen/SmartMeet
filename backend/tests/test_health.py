from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_allows_local_frontend_origin() -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:3000"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_schedule_preflight_allows_only_required_methods_headers_and_origin() -> None:
    allowed = client.options(
        "/schedules",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "PATCH" in allowed.headers["access-control-allow-methods"]
    assert "POST" in allowed.headers["access-control-allow-methods"]
    assert "authorization" in allowed.headers["access-control-allow-headers"].lower()
    assert "content-type" in allowed.headers["access-control-allow-headers"].lower()

    denied = client.options(
        "/schedules",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers
