from __future__ import annotations

import json
import sys
import types
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
from models import Base, PushSubscription
from push_service import WebPushDelivery, register_subscription, remove_subscription
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
    return {"endpoint": endpoint, "keys": {"p256dh": "B" * 65, "auth": "A" * 24}}


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
    with push_db() as db:
        register_subscription(db, "user_alpha", subscription())
        register_subscription(db, "user_beta", subscription("https://push.example.net/send/other"))
        db.commit()
    sent = []

    def fake_webpush(**kwargs):
        sent.append(kwargs)
        return types.SimpleNamespace(status_code=201)

    monkeypatch.setitem(sys.modules, "pywebpush", types.SimpleNamespace(webpush=fake_webpush, WebPushException=type("WebPushException", (Exception,), {})))
    response = TestClient(app).post("/push/test")
    assert response.status_code == 200
    assert response.json() == {"accepted": True}
    assert len(sent) == 1
    assert json.loads(sent[0]["data"])["title"] == "Deadline Notifier test"


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
    response = TestClient(app).post("/push/test")
    assert response.status_code == 409


def test_subscription_endpoint_validates_https_and_rejects_local_addresses(push_db) -> None:
    with push_db() as db:
        with pytest.raises(ValueError):
            register_subscription(db, "user_alpha", subscription("http://push.example.net/x"))
        with pytest.raises(ValueError):
            register_subscription(db, "user_alpha", subscription("https://127.0.0.1/x"))


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
    assert sent["title"] == "Wake-up time"
    assert sent["tag"] == "reminder-7"
    assert captured["vapid_claims"] == {"sub": "mailto:ops@example.net"}
    assert captured["timeout"] == 10


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
