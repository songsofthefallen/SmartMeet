from __future__ import annotations

import json
import os
import sys
import types
import base64
from collections.abc import Generator
from datetime import datetime, timezone

import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from database import get_db
from main import app, verify_clerk_token
from models import Base, PushSubscription, Schedule, TimeIntent
from push_service import PushConfigurationError, WebPushDelivery, _notification, register_subscription, remove_subscription, validate_push_configuration
from reminder_worker import PermanentProcessingError, ReminderMessage, ReminderType, RetryableProcessingError


@pytest.fixture
def push_db(monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session], None, None]:
    monkeypatch.setenv("PUSH_SUBSCRIPTION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_clerk_token] = lambda: "user_alpha"
    yield factory
    app.dependency_overrides.clear()
    engine.dispose()


def subscription(endpoint: str = "https://push.example.net/send/opaque-token") -> dict:
    return {
        "endpoint": endpoint,
        "keys": {
            "p256dh": base64.urlsafe_b64encode(b"\x04" + b"\x01" * 64).decode().rstrip("="),
            "auth": base64.urlsafe_b64encode(b"\x02" * 16).decode().rstrip("="),
        },
    }


def configure_vapid(monkeypatch: pytest.MonkeyPatch) -> None:
    private = ec.generate_private_key(ec.SECP256R1())
    private_der = private.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public_raw = private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    import base64
    monkeypatch.setenv("VAPID_PRIVATE_KEY", base64.urlsafe_b64encode(private_der).decode().rstrip("="))
    monkeypatch.setenv("VAPID_PUBLIC_KEY", base64.urlsafe_b64encode(public_raw).decode().rstrip("="))
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:ops@example.net")


def test_subscription_payload_is_encrypted_and_removal_is_owner_scoped(push_db) -> None:
    payload = subscription()
    with push_db() as db:
        register_subscription(db, "user_alpha", payload)
        db.commit()
        row = db.scalar(select(PushSubscription))
        assert row is not None
        assert payload["endpoint"] not in row.encrypted_subscription
        assert payload["keys"]["auth"] not in row.encrypted_subscription

        remove_subscription(db, "user_beta", payload["endpoint"])
        db.commit()
        assert db.scalar(select(PushSubscription)) is not None
        remove_subscription(db, "user_alpha", payload["endpoint"])
        db.commit()
        assert db.scalar(select(PushSubscription)) is None


def test_subscription_registration_route_requires_verified_authentication(monkeypatch: pytest.MonkeyPatch) -> None:
    app.dependency_overrides.clear()
    monkeypatch.setenv("CLERK_JWT_KEY", "configured")
    monkeypatch.setenv("CLERK_ISSUER", "https://issuer.example")
    response = TestClient(app).post("/push/subscriptions", json=subscription())
    assert response.status_code == 401


def test_authenticated_test_push_uses_current_users_subscription(push_db, monkeypatch) -> None:
    configure_vapid(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription())
        register_subscription(db, "user_beta", subscription("https://push.example.net/send/other"))
        db.commit()
    sent = []

    def fake_webpush(**kwargs):
        sent.append(kwargs)
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fake_webpush, WebPushException=type("WebPushException", (Exception,), {})))
    response = TestClient(app).post("/push/test", json={})
    assert response.status_code == 200
    assert response.json() == {"accepted": True}
    assert len(sent) == 1
    assert json.loads(sent[0]["data"])["title"] == "SmartMeet test notification"
    assert json.loads(sent[0]["data"])["body"] == "This is a test notification from your SmartMeet settings."


def test_test_push_schedule_target_is_owner_scoped(push_db, monkeypatch) -> None:
    configure_vapid(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    with push_db() as db:
        for user_id, title in (("user_alpha", "Alpha schedule"), ("user_beta", "Beta schedule")):
            db.add(Schedule(
                clerk_user_id=user_id, title=title, normalized_title=title.casefold(),
                time_intent=TimeIntent.ARRIVAL, target_datetime=datetime(2026, 10, 23, 5, tzinfo=timezone.utc),
                timezone="Asia/Manila",
            ))
        register_subscription(db, "user_alpha", subscription())
        db.commit()
        alpha_id = db.scalar(select(Schedule.id).where(Schedule.clerk_user_id == "user_alpha"))
        beta_id = db.scalar(select(Schedule.id).where(Schedule.clerk_user_id == "user_beta"))
    sent = []

    def fake_webpush(**kwargs):
        sent.append(json.loads(kwargs["data"]))
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fake_webpush, WebPushException=type("WebPushException", (Exception,), {})))
    client = TestClient(app)
    assert client.post("/push/test", json={"schedule_id": beta_id}).status_code == 404
    accepted = client.post("/push/test", json={"schedule_id": alpha_id})
    assert accepted.status_code == 200 and accepted.json() == {"accepted": True}
    assert len(sent) == 1
    assert sent[0]["url"] == f"/schedules?open={alpha_id}"
    assert sent[0]["scheduleId"] == str(alpha_id)


def test_test_push_requires_verified_authentication(push_db, monkeypatch) -> None:
    app.dependency_overrides.clear()
    monkeypatch.setenv("CLERK_JWT_KEY", "configured")
    monkeypatch.setenv("CLERK_ISSUER", "https://issuer.example")
    response = TestClient(app).post("/push/test", json={})
    assert response.status_code == 401


def test_authenticated_routes_register_and_remove_only_the_callers_endpoint(push_db) -> None:
    payload = subscription()
    client = TestClient(app)
    registered = client.post("/push/subscriptions", json=payload)
    assert registered.status_code == 204
    with push_db() as db:
        assert db.scalar(select(PushSubscription)).clerk_user_id == "user_alpha"
    removed = client.request("DELETE", "/push/subscriptions", json={"endpoint": payload["endpoint"]})
    assert removed.status_code == 204
    with push_db() as db:
        assert db.scalar(select(PushSubscription)) is None


def test_authenticated_test_push_without_subscription_returns_conflict(push_db) -> None:
    response = TestClient(app).post("/push/test", json={})
    assert response.status_code == 409


def test_subscription_endpoint_validates_https_and_rejects_local_addresses(push_db) -> None:
    with push_db() as db:
        with pytest.raises(ValueError):
            register_subscription(db, "user_alpha", subscription("http://push.example.net/x"))
        with pytest.raises(ValueError):
            register_subscription(db, "user_alpha", subscription("https://127.0.0.1/x"))


def test_subscription_registration_rejects_malformed_encryption_keys(push_db) -> None:
    payload = subscription()
    payload["keys"]["p256dh"] = "not-a-valid-key-value-!!!!!!!!!!!!!!!!"
    response = TestClient(app).post("/push/subscriptions", json=payload)
    assert response.status_code == 422


def test_corrupt_subscription_does_not_block_a_valid_device(push_db, monkeypatch, caplog) -> None:
    configure_vapid(monkeypatch)
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription("https://push.example.net/send/good"))
        register_subscription(db, "user_alpha", subscription("https://push.example.net/send/corrupt"))
        db.commit()
        corrupt = db.scalar(select(PushSubscription).order_by(PushSubscription.id.desc()))
        assert corrupt is not None
        from cryptography.fernet import Fernet
        encryptor = Fernet(os.environ["PUSH_SUBSCRIPTION_ENCRYPTION_KEY"].encode())
        corrupt.encrypted_subscription = encryptor.encrypt(json.dumps({"endpoint": "https://push.example.net/send/corrupt", "keys": {"p256dh": "broken", "auth": "broken"}}).encode()).decode()
        db.commit()
    sent = []

    def fake_webpush(**kwargs):
        sent.append(kwargs["subscription_info"]["endpoint"])
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fake_webpush, WebPushException=type("WebPushException", (Exception,), {})))
    message = ReminderMessage(10, 2, "user_alpha", ReminderType.DEPARTURE, datetime(2026, 10, 19, 1, tzinfo=timezone.utc), "Asia/Manila", 1)
    assert WebPushDelivery(push_db)(message) is True
    assert sent == ["https://push.example.net/send/good"]
    assert "push_subscription_invalid" in caplog.text


def test_push_configuration_validation_is_safe_and_explicit(monkeypatch) -> None:
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_SUBJECT", raising=False)
    with pytest.raises(PushConfigurationError, match="VAPID_PUBLIC_KEY"):
        validate_push_configuration()


def test_test_push_reports_configuration_error_as_service_unavailable(push_db, monkeypatch) -> None:
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_SUBJECT", raising=False)
    response = TestClient(app).post("/push/test")
    assert response.status_code == 503
    assert response.json()["detail"] == "Push delivery is not configured correctly"


def test_delivery_sends_type_specific_payload_and_returns_on_provider_acceptance(push_db, monkeypatch) -> None:
    configure_vapid(monkeypatch)
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription())
        db.commit()
    captured = {}

    def fake_webpush(**kwargs):
        captured.update(kwargs)
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fake_webpush, WebPushException=type("WebPushException", (Exception,), {})))
    message = ReminderMessage(7, 2, "user_alpha", ReminderType.WAKE, datetime(2026, 10, 19, 1, tzinfo=timezone.utc), "Asia/Manila", 1)
    assert WebPushDelivery(push_db)(message) is True
    sent = json.loads(captured["data"])
    assert sent["title"] == "Get ready: your event"
    assert sent["tag"] == "reminder-7"
    assert captured["vapid_claims"] == {"sub": "mailto:ops@example.net"}
    assert captured["timeout"] == 10


def test_notification_uses_schedule_details_and_formats_event_timezone(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    message = ReminderMessage(
        11, 42, "user_alpha", ReminderType.WAKE,
        datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1,
        title="Team meeting", destination="Makati, Manila",
        target_datetime=datetime(2026, 10, 23, 5, tzinfo=timezone.utc),
        departure_datetime=datetime(2026, 10, 23, 4, 15, tzinfo=timezone.utc),
        time_intent="arrival", preparation_duration_minutes=45, travel_duration_minutes=30,
    )
    payload = _notification(message)
    assert payload["title"] == "Get ready: Team meeting"
    assert payload["body"] == "Leave at 12:15 PM · Makati, Manila"
    assert payload["url"] == "/schedules?open=42"
    assert payload["scheduleId"] == "42" and payload["reminderType"] == "wake"


def test_notification_omits_missing_schedule_values_and_does_not_invent_departure(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    message = ReminderMessage(
        12, 43, "user_alpha", ReminderType.WAKE,
        datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1,
        target_datetime=datetime(2026, 10, 23, 5, tzinfo=timezone.utc),
        time_intent="arrival",
    )
    payload = _notification(message)
    assert payload["body"] == "Arrive by 1:00 PM"
    assert "leave at" not in payload["body"].lower()


def test_departure_reminder_wording_uses_known_duration_and_target(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    message = ReminderMessage(
        13, 44, "user_alpha", ReminderType.DEPARTURE,
        datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1,
        title="School", destination="Quezon City", target_datetime=datetime(2026, 10, 23, 6, tzinfo=timezone.utc),
        time_intent="arrival", travel_duration_minutes=60,
    )
    payload = _notification(message)
    assert payload["title"] == "Leave now: School"
    assert payload["body"] == "Depart at 1:00 PM · Quezon City · 60 min travel"


def test_notification_stays_concise_with_long_event_and_destination_and_missing_times(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    message = ReminderMessage(
        14, 45, "user_alpha", ReminderType.WAKE,
        datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1,
        title="Quarterly planning and cross-functional leadership alignment workshop",
        destination="The exceptionally long conference venue at the eastern international business district campus",
        time_intent="departure",
    )
    payload = _notification(message)
    assert payload["title"] == "Get ready: Quarterly planning and cross-functional…"
    assert payload["body"] == "The exceptionally long conference venue at the…"
    assert len(payload["body"]) < 90
    assert "None" not in payload["body"]


def test_production_schedule_url_requires_explicit_public_https_base(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("PUBLIC_APP_URL", raising=False)
    message = ReminderMessage(14, 45, "user_alpha", ReminderType.WAKE, datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1)
    with pytest.raises(PushConfigurationError, match="PUBLIC_APP_URL"):
        _notification(message)
    monkeypatch.setenv("PUBLIC_APP_URL", "https://smartmeet.example")
    assert _notification(message)["url"] == "https://smartmeet.example/schedules?open=45"


def test_production_schedule_url_rejects_localhost(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://localhost:3000")
    message = ReminderMessage(15, 46, "user_alpha", ReminderType.WAKE, datetime(2026, 10, 23, 5, tzinfo=timezone.utc), "Asia/Manila", 1)
    with pytest.raises(PushConfigurationError, match="public application host"):
        _notification(message)


def test_delivery_confirms_after_one_device_accepts_even_if_another_is_temporarily_unavailable(push_db, monkeypatch) -> None:
    configure_vapid(monkeypatch)
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription("https://push.example.net/send/first"))
        register_subscription(db, "user_alpha", subscription("https://push.example.net/send/second"))
        db.commit()
    calls = []
    retryable_error = type("WebPushException", (Exception,), {"status_code": 503})

    def accept_then_fail(**kwargs):
        calls.append(kwargs["subscription_info"]["endpoint"])
        if calls[-1].endswith("second"):
            raise retryable_error("provider response must not be logged")
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(
        webpush=accept_then_fail,
        WebPushException=retryable_error,
    ))
    message = ReminderMessage(9, 2, "user_alpha", ReminderType.DEPARTURE, datetime(2026, 10, 19, 1, tzinfo=timezone.utc), "Asia/Manila", 1)
    assert WebPushDelivery(push_db)(message) is True
    assert len(calls) == 2


@pytest.mark.parametrize("status_code,expected", [(410, "permanent"), (429, "retry"), (503, "retry"), (403, "permanent")])
def test_delivery_maps_provider_failure_classes(push_db, monkeypatch, status_code: int, expected: str) -> None:
    configure_vapid(monkeypatch)
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription())
        db.commit()
    exception_type = type("WebPushException", (Exception,), {"status_code": status_code})

    def fail(**_kwargs):
        raise exception_type("opaque provider response")

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fail, WebPushException=exception_type))
    message = ReminderMessage(8, 2, "user_alpha", ReminderType.DEPARTURE, datetime(2026, 10, 19, 1, tzinfo=timezone.utc), "Asia/Manila", 1)
    error = RetryableProcessingError if expected == "retry" else PermanentProcessingError
    with pytest.raises(error):
        WebPushDelivery(push_db)(message)
    if status_code == 410:
        with push_db() as db:
            assert db.scalar(select(PushSubscription)) is None
