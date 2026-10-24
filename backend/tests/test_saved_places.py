import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import SavedPlace, Schedule
from test_schedule_api import api_db, bearer, signing_key


def body(**changes: object) -> dict[str, object]:
    return {"alias": "Home", "display_name": "Central Library", "latitude": 14.5995,
            "longitude": 120.9842, "formatted_address": "Manila, Philippines",
            "locality": "Manila", "region": "Metro Manila", "country": "Philippines",
            "timezone": "Asia/Manila", **changes}


def test_saved_places_create_list_update_delete_and_derive_owner(api_db, signing_key: str) -> None:
    client = TestClient(app)
    created = client.post("/saved-places", headers=bearer(signing_key), json=body())
    assert created.status_code == 201
    place = created.json()
    assert place["alias"] == "Home"
    assert "clerk_user_id" not in place
    with Session(api_db) as db:
        assert db.get(SavedPlace, place["id"]).clerk_user_id == "user_alpha"
    assert client.get("/saved-places", headers=bearer(signing_key)).json()[0]["id"] == place["id"]
    changed = client.patch(f"/saved-places/{place['id']}", headers=bearer(signing_key), json={"alias": "Work"})
    assert changed.status_code == 200 and changed.json()["alias"] == "Work"
    deleted = client.delete(f"/saved-places/{place['id']}", headers=bearer(signing_key))
    assert deleted.status_code == 204
    assert client.get("/saved-places", headers=bearer(signing_key)).json() == []


def test_saved_places_enforce_owner_for_list_update_and_delete(api_db, signing_key: str) -> None:
    client = TestClient(app)
    created = client.post("/saved-places", headers=bearer(signing_key), json=body()).json()
    other = bearer(signing_key, "user_beta")
    assert client.get("/saved-places", headers=other).json() == []
    assert client.patch(f"/saved-places/{created['id']}", headers=other, json={"alias": "Stolen"}).status_code == 404
    assert client.delete(f"/saved-places/{created['id']}", headers=other).status_code == 404
    assert client.get("/saved-places", headers=bearer(signing_key)).json()[0]["alias"] == "Home"


@pytest.mark.parametrize("changes", [{"latitude": 91}, {"longitude": -181}, {"alias": "  "}, {"display_name": ""}, {"latitude": None}])
def test_saved_places_reject_invalid_or_missing_confirmed_location(api_db, signing_key: str, changes: dict[str, object]) -> None:
    response = TestClient(app).post("/saved-places", headers=bearer(signing_key), json=body(**changes))
    assert response.status_code == 422


def test_saved_place_deletion_does_not_mutate_schedule_location_snapshot(api_db, signing_key: str) -> None:
    client = TestClient(app)
    location = {"name": "Central Library", "locality": "Manila", "region": "Metro Manila", "country": "Philippines", "latitude": 14.5995, "longitude": 120.9842, "timezone": "Asia/Manila"}
    with Session(api_db) as db:
        schedule = Schedule(clerk_user_id="user_alpha", title="Visit", normalized_title="visit", time_intent="arrival", target_datetime=datetime(2026, 12, 1, tzinfo=timezone.utc), timezone="Asia/Manila", location=location)
        db.add(schedule)
        db.commit()
        schedule_id = schedule.id
    saved = client.post("/saved-places", headers=bearer(signing_key), json=body()).json()
    assert client.delete(f"/saved-places/{saved['id']}", headers=bearer(signing_key)).status_code == 204
    with Session(api_db) as db:
        assert db.get(Schedule, schedule_id).location == location

