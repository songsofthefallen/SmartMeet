"""Authenticated CRUD for user-owned confirmed places."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from main import verify_clerk_token
from models import SavedPlace
from schemas import SavedPlaceCreate, SavedPlaceResponse, SavedPlaceUpdate

router = APIRouter(prefix="/saved-places", tags=["saved-places"])
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[str, Depends(verify_clerk_token)]


def _owned_place(db: Session, place_id: int, user_id: str) -> SavedPlace:
    place = db.scalar(select(SavedPlace).where(SavedPlace.id == place_id, SavedPlace.clerk_user_id == user_id))
    if place is None:
        raise HTTPException(status_code=404, detail="Saved place not found")
    return place


@router.get("", response_model=list[SavedPlaceResponse])
def list_saved_places(user_id: CurrentUser, db: DbSession) -> list[SavedPlace]:
    return list(db.scalars(select(SavedPlace).where(SavedPlace.clerk_user_id == user_id).order_by(SavedPlace.alias, SavedPlace.id)))


@router.post("", response_model=SavedPlaceResponse, status_code=status.HTTP_201_CREATED)
def create_saved_place(payload: SavedPlaceCreate, user_id: CurrentUser, db: DbSession) -> SavedPlace:
    place = SavedPlace(clerk_user_id=user_id, **payload.model_dump())
    db.add(place)
    db.commit()
    db.refresh(place)
    return place


@router.patch("/{place_id}", response_model=SavedPlaceResponse)
def update_saved_place(place_id: int, payload: SavedPlaceUpdate, user_id: CurrentUser, db: DbSession) -> SavedPlace:
    place = _owned_place(db, place_id, user_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(place, field, value)
    db.commit()
    db.refresh(place)
    return place


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_place(place_id: int, user_id: CurrentUser, db: DbSession) -> Response:
    place = _owned_place(db, place_id, user_id)
    db.delete(place)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
