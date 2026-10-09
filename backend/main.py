import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def configured_origins() -> list[str]:
    value = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Deadline Notifier API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins(),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Accept", "Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
