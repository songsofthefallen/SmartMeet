"""Authenticated Web Push subscription lifecycle endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session, sessionmaker

from database import get_db
from main import verify_clerk_token
from push_service import WebPushDelivery, register_subscription, remove_subscription
from reminder_worker import PermanentProcessingError, RetryableProcessingError
from schemas import PushSubscriptionCreate, PushSubscriptionDelete

router = APIRouter(prefix="/push", tags=["push"])


@router.post("/test")
def send_test_push(
    user_id: Annotated[str, Depends(verify_clerk_token)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, bool]:
    factory = sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
    try:
        WebPushDelivery(factory).send_test(user_id)
    except RetryableProcessingError as exc:
        raise HTTPException(status_code=503, detail="Push service is temporarily unavailable") from exc
    except PermanentProcessingError as exc:
        raise HTTPException(status_code=409, detail="No valid push subscription is available") from exc
    return {"accepted": True}


@router.post("/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def create_push_subscription(
    payload: PushSubscriptionCreate,
    user_id: Annotated[str, Depends(verify_clerk_token)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        register_subscription(db, user_id, payload.model_dump())
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Push subscription storage is not configured") from exc
    except Exception:
        db.rollback()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def delete_push_subscription(
    payload: PushSubscriptionDelete,
    user_id: Annotated[str, Depends(verify_clerk_token)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    remove_subscription(db, user_id, payload.endpoint)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
