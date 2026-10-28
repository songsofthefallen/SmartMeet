import os
from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jwt import InvalidTokenError
from starlette.requests import Request
from starlette.responses import Response

from observability import new_request_id, reset_request_id, set_request_id


def configured_origins() -> list[str]:
    value = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Deadline Notifier API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Accept", "Authorization", "Content-Type"],
)


@app.middleware("http")
async def correlate_requests(request: Request, call_next: Callable[[Request], Response]) -> Response:
    supplied = request.headers.get("X-Request-ID", "").strip()
    request_id = supplied if supplied and len(supplied) <= 64 and all(character.isalnum() or character in "-_." for character in supplied) else new_request_id()
    token = set_request_id(request_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        reset_request_id(token)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def verify_clerk_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    public_key = os.getenv("CLERK_JWT_KEY", "").replace("\\n", "\n")
    issuer = os.getenv("CLERK_ISSUER")
    if not public_key or not issuer:
        raise HTTPException(status_code=503, detail="Authentication is not configured")

    try:
        claims = jwt.decode(
            token,
            public_key.replace("\\n", "\n"),
            algorithms=["RS256"],
            issuer=issuer,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
        user_id = claims.get("sub")
        if not isinstance(user_id, str) or not user_id:
            raise InvalidTokenError("Missing subject")
        authorized_party = claims.get("azp")
        if authorized_party is not None and authorized_party not in configured_origins():
            raise InvalidTokenError("Untrusted authorized party")
        return user_id
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc


@app.get("/auth/me")
def auth_me(user_id: Annotated[str, Depends(verify_clerk_token)]) -> dict[str, str]:
    return {"user_id": user_id}


from routers.extraction import router as extraction_router
from routers.locations import router as locations_router
from routers.schedules import router as schedules_router
from routers.push import router as push_router

app.include_router(extraction_router)
app.include_router(locations_router)
app.include_router(schedules_router)
app.include_router(push_router)
