"""Encrypted push subscription storage and Web Push delivery adapter."""

from __future__ import annotations

import hashlib
import base64
import hmac
import json
import os
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from ipaddress import ip_address
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import PushSubscription
from reminder_worker import PermanentProcessingError, ReminderMessage, RetryableProcessingError


def _fernet() -> Fernet:
    key = os.getenv("PUSH_SUBSCRIPTION_ENCRYPTION_KEY", "")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValueError("push subscription encryption is not configured") from exc


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def _vapid_private_key(value: str, public_key: str) -> str:
    """Normalize PEM or base64url DER to py-vapid's encoded DER input and match keys."""
    from py_vapid import Vapid

    if "-----BEGIN" in value:
        private = serialization.load_pem_private_key(value.encode("utf-8"), password=None)
        if not isinstance(private, ec.EllipticCurvePrivateKey) or not isinstance(private.curve, ec.SECP256R1):
            raise ValueError("invalid VAPID key")
        der = private.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        normalized = base64.urlsafe_b64encode(der).decode("ascii").rstrip("=")
    else:
        normalized = value
    vapid = Vapid.from_string(normalized)
    derived = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    derived_public = base64.urlsafe_b64encode(derived).decode("ascii").rstrip("=")
    if not hmac.compare_digest(derived_public, public_key.rstrip("=")):
        raise ValueError("VAPID public and private keys do not match")
    return normalized


def _validate_endpoint(endpoint: str) -> None:
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("invalid push endpoint")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise ValueError("invalid push endpoint")
    try:
        address = ip_address(hostname)
    except ValueError:
        return
    if not address.is_global:
        raise ValueError("invalid push endpoint")


def register_subscription(db: Session, user_id: str, payload: dict) -> None:
    endpoint = payload.get("endpoint", "")
    _validate_endpoint(endpoint)
    serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    encrypted = _fernet().encrypt(serialized.encode("utf-8")).decode("ascii")
    digest = _endpoint_hash(endpoint)
    row = db.scalar(select(PushSubscription).where(PushSubscription.endpoint_hash == digest))
    if row is None:
        db.add(PushSubscription(clerk_user_id=user_id, endpoint_hash=digest, encrypted_subscription=encrypted))
    else:
        # A current registration proves possession of this browser endpoint.
        row.clerk_user_id = user_id
        row.encrypted_subscription = encrypted


def remove_subscription(db: Session, user_id: str, endpoint: str) -> None:
    _validate_endpoint(endpoint)
    row = db.scalar(select(PushSubscription).where(
        PushSubscription.endpoint_hash == _endpoint_hash(endpoint),
        PushSubscription.clerk_user_id == user_id,
    ))
    if row is not None:
        db.delete(row)


def _load_subscription(row: PushSubscription) -> dict:
    try:
        payload = json.loads(_fernet().decrypt(row.encrypted_subscription.encode("ascii")))
    except (InvalidToken, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PermanentProcessingError("stored push subscription is invalid") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("keys"), dict):
        raise PermanentProcessingError("stored push subscription is invalid")
    _validate_endpoint(payload.get("endpoint", ""))
    return payload


def _notification(message: ReminderMessage) -> dict[str, str]:
    local_time = message.scheduled_for.astimezone(ZoneInfo(message.timezone))
    label = "Wake-up time" if message.reminder_type.value == "wake" else "Time to leave"
    clock = local_time.strftime("%-I:%M %p") if os.name != "nt" else local_time.strftime("%I:%M %p").lstrip("0")
    return {
        "title": label,
        "body": f"Your scheduled time is {clock}.",
        "url": "/schedules",
        "tag": f"reminder-{message.id}",
        "reminderId": str(message.id),
    }


class WebPushDelivery:
    """Send to all active user endpoints; provider 2xx means accepted, not delivered."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory

    def __call__(self, message: ReminderMessage) -> bool:
        return self._send(message.clerk_user_id, _notification(message))

    def send_test(self, user_id: str) -> bool:
        """Send a one-off smoke test without creating or changing a reminder."""
        return self._send(user_id, {
            "title": "Deadline Notifier test",
            "body": "Push notifications are set up correctly.",
            "url": "/schedules",
            "tag": "push-test",
        })

    def _send(self, user_id: str, notification: dict[str, str]) -> bool:
        private_key = os.getenv("VAPID_PRIVATE_KEY", "").replace("\\n", "\n")
        public_key = os.getenv("VAPID_PUBLIC_KEY", "")
        subject = os.getenv("VAPID_SUBJECT", "")
        if not private_key or not public_key or not subject:
            raise PermanentProcessingError("VAPID configuration is incomplete")
        try:
            private_key = _vapid_private_key(private_key, public_key)
        except Exception as exc:
            raise PermanentProcessingError("VAPID configuration is invalid") from exc

        with self.session_factory() as db:
            rows = list(db.scalars(select(PushSubscription).where(PushSubscription.clerk_user_id == user_id)))
            subscriptions = [(row.id, _load_subscription(row)) for row in rows]
        if not subscriptions:
            raise PermanentProcessingError("no push subscriptions")

        try:
            from pywebpush import WebPushException, webpush
        except ImportError as exc:
            raise PermanentProcessingError("Web Push dependency is unavailable") from exc

        accepted = 0
        retryable = False
        permanent = False
        expired_ids: list[int] = []
        body = json.dumps(notification, separators=(",", ":"))
        for subscription_id, subscription in subscriptions:
            try:
                webpush(
                    subscription_info=subscription,
                    data=body,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": subject},
                    ttl=60,
                    timeout=10,
                )
                accepted += 1
            except WebPushException as exc:
                code = getattr(exc, "status_code", None)
                if code in (404, 410):
                    expired_ids.append(subscription_id)
                elif code == 429 or (isinstance(code, int) and code >= 500) or code is None:
                    retryable = True
                else:
                    permanent = True
            except (TimeoutError, ConnectionError, OSError):
                retryable = True

        if expired_ids:
            with self.session_factory() as db:
                for row in db.scalars(select(PushSubscription).where(PushSubscription.id.in_(expired_ids))):
                    db.delete(row)
                db.commit()

        # Once at least one endpoint accepted the message, retrying would risk
        # duplicate delivery to that endpoint. Other endpoints may miss this push.
        if accepted:
            return True
        if retryable:
            raise RetryableProcessingError("push provider temporarily unavailable")
        if permanent:
            raise PermanentProcessingError("push provider rejected the request")
        raise PermanentProcessingError("no active push subscriptions")
