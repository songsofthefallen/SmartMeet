import time
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from collections.abc import Generator
from datetime import datetime, timezone
import jwt
import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from ai_provider import AISettings, OpenRouterClient
from database import get_db
from extraction_schemas import (
    ExtractionReviewStatus,
    ScheduleExtraction,
    ScheduleExtractionReview,
)
from extraction_service import ScheduleExtractionError, ScheduleExtractionService
from main import app
from models import Base, Schedule
from routers.schedules import create_schedule
from schemas import ScheduleCreate
from routers.extraction import get_extraction_service
from routers.schedules import get_weather_service
from schemas import WeatherEstimate


@pytest.fixture
def api_db(monkeypatch: pytest.MonkeyPatch) -> Generator[Engine, None, None]:
    monkeypatch.setenv("TRAVEL_BUFFER_MINUTES", "0")
    monkeypatch.setenv("PREPARATION_BUFFER_MINUTES", "0")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db() -> Generator[Session, None, None]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_weather_service] = lambda: OfflineWeather()
    yield engine
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def signing_key(monkeypatch: pytest.MonkeyPatch) -> str:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    monkeypatch.setenv("CLERK_JWT_KEY", public_pem)
    monkeypatch.setenv("CLERK_ISSUER", "https://issuer.example")
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return private_pem


def bearer(private_key: str, user_id: str = "user_alpha") -> dict[str, str]:
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": user_id,
            "iss": "https://issuer.example",
            "iat": now,
            "exp": now + 60,
            "azp": "http://localhost:3000",
        },
        private_key,
        algorithm="RS256",
    )
    return {"Authorization": f"Bearer {token}"}


def payload(**changes: object) -> dict[str, object]:
    return {
        "title": "Morning class",
        "description": "At campus",
        "time_intent": "arrival",
        "target_datetime": "2026-10-11T07:00:00+08:00",
        "timezone": "Asia/Manila",
        "preparation_duration_minutes": 30,
        "travel_duration_minutes": 20,
        **changes,
    }


class StubExtractionService:
    def __init__(self, result: ScheduleExtractionReview | Exception) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def extract(self, text: str, **kwargs: object) -> ScheduleExtractionReview:
        self.calls.append({"text": text, **kwargs})
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class OfflineWeather:
    def assess(self, *args: object, **kwargs: object) -> WeatherEstimate:
        return WeatherEstimate(status="unavailable", summary="Weather information is temporarily unavailable.", retrieved_at=None)


def extraction_review(*, missing_intent: bool = False) -> ScheduleExtractionReview:
    extraction = ScheduleExtraction.model_validate_json(
        json.dumps(
            {
                "is_schedule_request": True,
                "time_intent": None if missing_intent else "arrival",
                "target_date_local": "2026-10-12",
                "target_time_local": "07:00:00",
                "timezone": "Asia/Manila",
                "preparation_duration_minutes": None,
                "travel_duration_minutes": None,
                "time_intent_ambiguous": missing_intent,
                "ambiguities": ["Arrival or departure is unclear."] if missing_intent else [],
            }
        )
    )
    if missing_intent:
        return ScheduleExtractionReview(
            status=ExtractionReviewStatus.NEEDS_CLARIFICATION,
            extraction=extraction,
            resolved_target_datetime=None,
            missing_fields=["time_intent"],
            ambiguous_fields=["time_intent", "ambiguities"],
        )
    return ScheduleExtractionReview(
        status=ExtractionReviewStatus.READY_FOR_REVIEW,
        extraction=extraction,
        resolved_target_datetime=datetime(2026, 10, 11, 23, tzinfo=timezone.utc),
    )


def test_schedule_crud_and_cancel(api_db: None, signing_key: str) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)

    created = client.post("/schedules", headers=headers, json=payload())
    assert created.status_code == 201
    schedule_id = created.json()["id"]
    assert created.json()["clerk_user_id"] == "user_alpha"
    assert created.json()["status"] == "active"
    assert created.json()["target_datetime"] == "2026-10-10T23:00:00Z"
    assert created.json()["calculated_departure_time"] == "2026-10-10T22:40:00Z"
    assert created.json()["calculated_wake_time"] == "2026-10-10T22:10:00Z"

    listing = client.get("/schedules", headers=headers)
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [schedule_id]
    assert client.get(f"/schedules/{schedule_id}", headers=headers).status_code == 200

    updated = client.patch(
        f"/schedules/{schedule_id}", headers=headers, json={"title": "Updated class"}
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Updated class"

    recalculated = client.patch(
        f"/schedules/{schedule_id}", headers=headers,
        json={"travel_duration_minutes": 40},
    )
    assert recalculated.json()["calculated_departure_time"] == "2026-10-10T22:20:00Z"

    cancelled = client.post(f"/schedules/{schedule_id}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_default_names_are_sequential_per_user_and_not_reused_after_delete(api_db: Engine, signing_key: str) -> None:
    client = TestClient(app)
    first_payload = payload()
    first_payload.pop("title")
    first = client.post("/schedules", headers=bearer(signing_key), json=first_payload)
    second = client.post("/schedules", headers=bearer(signing_key), json=first_payload)
    other_user = client.post("/schedules", headers=bearer(signing_key, "user_beta"), json=first_payload)
    assert [first.json()["title"], second.json()["title"], other_user.json()["title"]] == [
        "Schedule 1", "Schedule 2", "Schedule 1"
    ]
    with Session(api_db) as db:
        db.delete(db.get(Schedule, second.json()["id"]))
        db.commit()
    third = client.post("/schedules", headers=bearer(signing_key), json=first_payload)
    assert third.status_code == 201
    assert third.json()["title"] == "Schedule 3"


def test_duplicate_names_are_case_insensitive_and_rename_conflicts_are_rejected(api_db: None, signing_key: str) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)
    first = client.post("/schedules", headers=headers, json=payload(title="  Team Plan  "))
    assert first.status_code == 201
    own_rename = client.patch(f"/schedules/{first.json()['id']}", headers=headers, json={"title": "team plan"})
    assert own_rename.status_code == 200
    duplicate = client.post("/schedules", headers=headers, json=payload(title=" TEAM PLAN "))
    assert duplicate.status_code == 409
    second = client.post("/schedules", headers=headers, json=payload(title="Other"))
    conflict = client.patch(f"/schedules/{second.json()['id']}", headers=headers, json={"title": "TEAM PLAN"})
    assert conflict.status_code == 409
    assert "name already exists" in conflict.json()["detail"]
    allowed_for_other_user = client.post(
        "/schedules", headers=bearer(signing_key, "user_beta"), json=payload(title="team plan")
    )
    assert allowed_for_other_user.status_code == 201


def test_idempotent_retry_keeps_generated_name(api_db: None, signing_key: str) -> None:
    client = TestClient(app)
    request = payload(idempotency_key="retry-key-00000001")
    request.pop("title")
    first = client.post("/schedules", headers=bearer(signing_key), json=request)
    retried = client.post("/schedules", headers=bearer(signing_key), json=request)
    assert first.status_code == retried.status_code == 201
    assert first.json()["id"] == retried.json()["id"]
    assert first.json()["title"] == retried.json()["title"] == "Schedule 1"


def test_invalid_creation_does_not_consume_a_default_name(api_db: None, signing_key: str) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)
    invalid = payload()
    invalid.pop("title")
    invalid["timezone"] = "Not/A_Timezone"
    assert client.post("/schedules", headers=headers, json=invalid).status_code == 422
    valid = payload()
    valid.pop("title")
    saved = client.post("/schedules", headers=headers, json=valid)
    assert saved.status_code == 201
    assert saved.json()["title"] == "Schedule 1"


def test_concurrent_default_creations_get_distinct_sequential_names() -> None:
    temp_file = tempfile.NamedTemporaryFile(suffix=".sqlite", dir=Path(__file__).parents[1], delete=False)
    temp_file.close()
    engine = create_engine(f"sqlite:///{Path(temp_file.name).as_posix()}", connect_args={"timeout": 10})
    Base.metadata.create_all(engine)
    request = payload()
    request.pop("title")
    parsed = ScheduleCreate.model_validate(request)
    barrier = Barrier(2)

    def create_one() -> str:
        with Session(engine, autoflush=False, expire_on_commit=False) as db:
            barrier.wait()
            schedule = create_schedule(parsed, db, "user_concurrent", None, OfflineWeather())
            return schedule.title

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            names = sorted(pool.map(lambda _index: create_one(), range(2)))
        assert names == ["Schedule 1", "Schedule 2"]
    finally:
        engine.dispose()
        Path(temp_file.name).unlink(missing_ok=True)


def test_schedule_list_orders_by_creation_time_then_id(api_db: Engine, signing_key: str) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)
    # Target dates deliberately disagree with creation order.
    older = client.post(
        "/schedules", headers=headers,
        json=payload(target_datetime="2027-01-01T07:00:00+08:00"),
    )
    newer = client.post(
        "/schedules", headers=headers,
        json=payload(target_datetime="2026-10-12T07:00:00+08:00", title="Newer"),
    )
    same_time = client.post(
        "/schedules", headers=headers,
        json=payload(target_datetime="2026-09-01T07:00:00+08:00", title="Same time"),
    )
    assert older.status_code == newer.status_code == same_time.status_code == 201

    created_at = datetime(2026, 10, 15, 10, 0, tzinfo=timezone.utc)
    with Session(api_db) as db:
        db.get(Schedule, older.json()["id"]).created_at = created_at
        db.get(Schedule, newer.json()["id"]).created_at = datetime(
            2026, 10, 15, 10, 1, tzinfo=timezone.utc
        )
        db.get(Schedule, same_time.json()["id"]).created_at = created_at
        db.commit()

    listing = client.get("/schedules", headers=headers)
    assert [item["id"] for item in listing.json()] == [
        newer.json()["id"], same_time.json()["id"], older.json()["id"]
    ]


def test_manila_example_returns_utc_instants_that_display_as_630_and_530(
    api_db: None, signing_key: str
) -> None:
    response = TestClient(app).post(
        "/schedules",
        headers=bearer(signing_key),
        json=payload(
            target_datetime="2026-10-12T08:00:00+08:00",
            travel_duration_minutes=90,
            preparation_duration_minutes=60,
        ),
    )
    assert response.status_code == 201
    result = response.json()
    assert result["target_datetime"] == "2026-10-12T00:00:00Z"
    assert result["calculated_departure_time"] == "2026-10-11T22:30:00Z"
    assert result["calculated_wake_time"] == "2026-10-11T21:30:00Z"


def test_schedule_routes_require_verified_authentication(api_db: None) -> None:
    client = TestClient(app)
    for method, path in (
        ("post", "/schedules"),
        ("get", "/schedules"),
        ("get", "/schedules/1"),
        ("patch", "/schedules/1"),
        ("post", "/schedules/1/cancel"),
    ):
        request = {"json": payload()} if method == "post" and path == "/schedules" else {}
        response = getattr(client, method)(path, **request)
        assert response.status_code == 401


def test_extraction_endpoint_requires_verified_clerk_authentication() -> None:
    response = TestClient(app).post(
        "/schedules/extract",
        json={"text": "Class tomorrow at 7", "timezone": "Asia/Manila"},
    )
    assert response.status_code == 401


def test_extraction_endpoint_returns_ready_review_and_uses_verified_user_dependency(
    api_db: None, signing_key: str
) -> None:
    service = StubExtractionService(extraction_review())
    app.dependency_overrides[get_extraction_service] = lambda: service

    response = TestClient(app).post(
        "/schedules/extract",
        headers=bearer(signing_key),
        json={"text": "I need to arrive at class tomorrow at 7", "timezone": "Asia/Manila"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ready_for_review"
    assert response.json()["extraction"]["target_time_local"] == "07:00:00"
    assert response.json()["extraction"]["time_intent"] == "arrival"
    assert response.json()["extraction"]["travel_duration_minutes"] is None
    assert response.json()["resolved_target_datetime"] == "2026-10-11T23:00:00Z"
    assert service.calls[0]["text"] == "I need to arrive at class tomorrow at 7"
    assert service.calls[0]["user_timezone"] == "Asia/Manila"
    assert service.calls[0]["reference_datetime"].tzinfo == timezone.utc


def test_extraction_endpoint_returns_structured_clarification(
    api_db: None, signing_key: str
) -> None:
    service = StubExtractionService(extraction_review(missing_intent=True))
    app.dependency_overrides[get_extraction_service] = lambda: service

    response = TestClient(app).post(
        "/schedules/extract",
        headers=bearer(signing_key),
        json={"text": "I have something at 7", "timezone": "Asia/Manila"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "needs_clarification"
    assert response.json()["missing_fields"] == ["time_intent"]
    assert "time_intent" in response.json()["ambiguous_fields"]


def test_extraction_endpoint_parses_title_free_provider_response(
    api_db: None, signing_key: str
) -> None:
    extracted = {
        "is_schedule_request": True,
        "time_intent": "arrival",
        "target_date_local": "2026-10-20",
        "target_time_local": "07:00:00",
        "timezone": "Asia/Manila",
        "preparation_duration_minutes": None,
        "travel_duration_minutes": None,
        "time_intent_ambiguous": False,
        "ambiguities": [],
    }

    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(extracted)}}]})

    http = httpx.Client(transport=httpx.MockTransport(respond))
    settings = AISettings(
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key="mock-key",
        model="mock-model",
    )
    service = ScheduleExtractionService(OpenRouterClient(settings, http_client=http))
    app.dependency_overrides[get_extraction_service] = lambda: service
    try:
        response = TestClient(app).post(
            "/schedules/extract",
            headers=bearer(signing_key),
            json={"text": "Arrive at school on October 20 at 7 AM", "timezone": "Asia/Manila"},
        )
    finally:
        http.close()

    assert response.status_code == 200
    assert response.json()["status"] == "ready_for_review"
    assert response.json()["extraction"]["target_time_local"] == "07:00:00"
    assert "title" not in response.json()["extraction"]


def test_extraction_endpoint_maps_upstream_timeout_to_safe_503(
    api_db: None, signing_key: str
) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("simulated upstream timeout", request=request)

    http = httpx.Client(transport=httpx.MockTransport(timeout))
    settings = AISettings(
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key="mock-key",
        model="mock-model",
    )
    service = ScheduleExtractionService(OpenRouterClient(settings, http_client=http))
    app.dependency_overrides[get_extraction_service] = lambda: service
    try:
        response = TestClient(app).post(
            "/schedules/extract",
            headers=bearer(signing_key),
            json={"text": "Arrive at school tomorrow at 7 AM", "timezone": "Asia/Manila"},
        )
    finally:
        http.close()

    assert response.status_code == 503
    assert response.json() == {"detail": "Schedule extraction is temporarily unavailable"}
    assert "simulated upstream timeout" not in response.text


def test_extraction_endpoint_maps_service_failure_to_safe_error(
    api_db: None, signing_key: str
) -> None:
    service = StubExtractionService(ScheduleExtractionError("private provider detail"))
    app.dependency_overrides[get_extraction_service] = lambda: service

    response = TestClient(app).post(
        "/schedules/extract",
        headers=bearer(signing_key),
        json={"text": "Class tomorrow at 7", "timezone": "Asia/Manila"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Schedule extraction is temporarily unavailable"
    assert "private provider detail" not in response.text


def test_extraction_endpoint_rejects_invalid_timezone_and_identity_fields(
    api_db: None, signing_key: str
) -> None:
    app.dependency_overrides[get_extraction_service] = lambda: StubExtractionService(
        ScheduleExtractionError("unused mock")
    )
    client = TestClient(app)
    headers = bearer(signing_key)
    assert client.post(
        "/schedules/extract", headers=headers,
        json={"text": "Class tomorrow", "timezone": "Mars/Olympus"},
    ).status_code == 422
    assert client.post(
        "/schedules/extract", headers=headers,
        json={"text": "Class tomorrow", "timezone": "Asia/Manila", "clerk_user_id": "user_victim"},
    ).status_code == 422


def test_create_validation_and_client_owner_id_are_rejected(
    api_db: None, signing_key: str
) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)
    assert client.post("/schedules", headers=headers, json=payload(preparation_duration_minutes=-1)).status_code == 422
    assert client.post("/schedules", headers=headers, json=payload(clerk_user_id="user_victim")).status_code == 422


def test_schedule_creation_retry_with_same_idempotency_key_returns_existing_record(
    api_db: None, signing_key: str
) -> None:
    client = TestClient(app)
    headers = bearer(signing_key)
    request_payload = payload(idempotency_key="schedule-attempt-00000001")

    first = client.post("/schedules", headers=headers, json=request_payload)
    retry = client.post("/schedules", headers=headers, json=request_payload)

    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert len(client.get("/schedules", headers=headers).json()) == 1


@pytest.mark.parametrize("intent", ["arrival", "departure"])
def test_api_persists_intent_and_unknown_durations(
    api_db: None, signing_key: str, intent: str
) -> None:
    response = TestClient(app).post(
        "/schedules",
        headers=bearer(signing_key),
        json=payload(time_intent=intent, preparation_duration_minutes=None, travel_duration_minutes=None),
    )
    assert response.status_code == 201
    assert response.json()["time_intent"] == intent
    assert response.json()["preparation_duration_minutes"] is None
    assert response.json()["travel_duration_minutes"] is None
    if intent == "arrival":
        assert response.json()["calculated_departure_time"] is None
        assert response.json()["departure_unavailable_reason"] == "Travel duration is unknown."
    else:
        assert response.json()["calculated_departure_time"] == "2026-10-10T23:00:00Z"
        assert response.json()["wake_unavailable_reason"] == "Preparation duration is unknown."


@pytest.mark.parametrize("method,path", [("get", "/schedules/987"), ("patch", "/schedules/987"), ("post", "/schedules/987/cancel")])
def test_missing_schedule_returns_404(
    api_db: None, signing_key: str, method: str, path: str
) -> None:
    request = {"json": {"title": "Updated"}} if method == "patch" else {}
    response = getattr(TestClient(app), method)(path, headers=bearer(signing_key), **request)
    assert response.status_code == 404
    assert response.json()["detail"] == "Schedule not found"


def test_cross_user_cannot_read_update_or_cancel(
    api_db: None, signing_key: str
) -> None:
    client = TestClient(app)
    created = client.post("/schedules", headers=bearer(signing_key, "user_alpha"), json=payload())
    schedule_id = created.json()["id"]
    other_headers = bearer(signing_key, "user_beta")

    assert client.get("/schedules", headers=other_headers).json() == []
    assert client.get(f"/schedules/{schedule_id}", headers=other_headers).status_code == 404
    assert client.patch(
        f"/schedules/{schedule_id}", headers=other_headers, json={"title": "Hijack"}
    ).status_code == 404
    assert client.post(f"/schedules/{schedule_id}/cancel", headers=other_headers).status_code == 404
    own_record = client.get(f"/schedules/{schedule_id}", headers=bearer(signing_key, "user_alpha"))
    assert own_record.json()["title"] == "Morning class"
    assert own_record.json()["status"] == "active"


def test_database_commit_failure_rolls_back_and_returns_safe_error(
    api_db: None, signing_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    rolled_back = False

    def fail_commit(self: Session) -> None:
        raise OperationalError("commit", {}, RuntimeError("private database detail"))

    def track_rollback(self: Session) -> None:
        nonlocal rolled_back
        rolled_back = True

    monkeypatch.setattr(Session, "commit", fail_commit)
    monkeypatch.setattr(Session, "rollback", track_rollback)
    response = TestClient(app).post(
        "/schedules", headers=bearer(signing_key), json=payload()
    )
    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to save schedule"
    assert "private database detail" not in response.text
    assert rolled_back
