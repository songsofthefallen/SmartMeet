import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def signing_keys(monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    monkeypatch.setenv("CLERK_JWT_KEY", public_pem)
    monkeypatch.setenv("CLERK_ISSUER", "https://issuer.example")
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return private_pem, public_pem


def make_token(private_key: str, **overrides: object) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "sub": "user_test_123",
        "iss": "https://issuer.example",
        "iat": now,
        "exp": now + 60,
        "azp": "http://localhost:3000",
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm="RS256")


def test_auth_me_returns_verified_subject(signing_keys: tuple[str, str]) -> None:
    private_key, _ = signing_keys
    response = TestClient(app).get("/auth/me", headers={"Authorization": f"Bearer {make_token(private_key)}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": "user_test_123"}


@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer "])
def test_auth_me_rejects_missing_or_malformed_authorization(authorization: str | None) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    assert TestClient(app).get("/auth/me", headers=headers).status_code == 401


def test_auth_me_rejects_invalid_signature(signing_keys: tuple[str, str]) -> None:
    private_key, _ = signing_keys
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    response = TestClient(app).get("/auth/me", headers={"Authorization": f"Bearer {make_token(other_pem)}"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 10},
        {"iss": "https://wrong-issuer.example"},
        {"azp": "https://untrusted.example"},
    ],
)
def test_auth_me_rejects_expired_wrong_issuer_or_untrusted_party(
    signing_keys: tuple[str, str], claims: dict[str, object]
) -> None:
    private_key, _ = signing_keys
    response = TestClient(app).get("/auth/me", headers={"Authorization": f"Bearer {make_token(private_key, **claims)}"})
    assert response.status_code == 401


def test_auth_me_returns_service_unavailable_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLERK_JWT_KEY", raising=False)
    monkeypatch.delenv("CLERK_ISSUER", raising=False)
    assert TestClient(app).get("/auth/me", headers={"Authorization": "Bearer token"}).status_code == 503


def test_health_remains_public() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_requests_receive_safe_correlation_id_and_preserve_valid_one() -> None:
    client = TestClient(app)
    generated = client.get("/health")
    assert generated.status_code == 200
    assert generated.headers["X-Request-ID"]
    assert len(generated.headers["X-Request-ID"]) == 32

    supplied = client.get("/health", headers={"X-Request-ID": "test-correlation-1"})
    assert supplied.headers["X-Request-ID"] == "test-correlation-1"

    invalid = client.get("/health", headers={"X-Request-ID": "not safe\nvalue"})
    assert invalid.headers["X-Request-ID"] != "not safe\nvalue"
