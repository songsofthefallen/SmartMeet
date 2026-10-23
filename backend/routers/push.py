"""Authenticated Web Push subscription lifecycle endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from database import get_db
from main import verify_clerk_token
from models import Schedule, ScheduleStatus
from push_service import PushConfigurationError, WebPushDelivery, register_subscription, remove_subscription
from reminder_worker import PermanentProcessingError, RetryableProcessingError
from schemas import PushSubscriptionCreate, PushSubscriptionDelete, PushTestRequest

router = APIRouter(prefix="/push", tags=["push"])


@router.post("/test")
def send_test_push(
    user_id: Annotated[str, Depends(verify_clerk_token)],
    db: Annotated[Session, Depends(get_db)],
    payload: PushTestRequest | None = None,
) -> dict[str, bool]:
    schedule_id = payload.schedule_id if payload is not None else None
    if schedule_id is not None:
        owned_schedule_id = db.scalar(select(Schedule.id).where(
            Schedule.id == schedule_id,
            Schedule.clerk_user_id == user_id,
            Schedule.status == ScheduleStatus.ACTIVE,
        ))
        if owned_schedule_id is None:
            raise HTTPException(status_code=404, detail="Schedule not found")
    factory = sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
    try:
        WebPushDelivery(factory).send_test(user_id, schedule_id)
    except PushConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Push delivery is not configured correctly") from exc
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
