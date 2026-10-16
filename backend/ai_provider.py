"""Server-side OpenRouter client for OpenAI-compatible chat completions."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)
BACKEND_ENV_PATH = Path(__file__).resolve().with_name(".env")
DEFAULT_AI_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_AI_MODEL = "openrouter/free"


class AIConfigurationError(RuntimeError):
    """Raised when server-side AI settings are missing or unsupported."""


class AIProviderError(RuntimeError):
    """Raised when OpenRouter cannot return a valid structured response."""

    def __init__(
        self,
        message: str,
        *,
        category: str = "provider_error",
        exception_class: str = "AIProviderError",
        upstream_status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.exception_class = exception_class
        self.upstream_status_code = upstream_status_code


class AIInvalidOutputError(AIProviderError):
    """Raised when a successful provider response fails the requested schema."""

    def __init__(self, invalid_fields: tuple[str, ...]) -> None:
        super().__init__(
            "OpenRouter returned an invalid structured response",
            category="invalid_output",
            exception_class="ValidationError",
        )
        self.invalid_fields = invalid_fields


@dataclass(frozen=True)
class AISettings:
    provider: str
    base_url: str
    api_key: str
    model: str

    @classmethod
    def from_env(cls) -> "AISettings":
        provider = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
        if provider != "openrouter":
            raise AIConfigurationError("AI_PROVIDER must be openrouter")

        api_key = os.getenv("AI_API_KEY", "").strip()
        if not api_key:
            raise AIConfigurationError("AI_API_KEY is not configured")

        base_url = os.getenv("AI_BASE_URL", DEFAULT_AI_BASE_URL).strip().rstrip("/")
        model = os.getenv("AI_MODEL", DEFAULT_AI_MODEL).strip()
        if not base_url.startswith("https://") or not model:
            raise AIConfigurationError("AI_BASE_URL and AI_MODEL must be valid")
        return cls(provider=provider, base_url=base_url, api_key=api_key, model=model)


def load_ai_settings() -> AISettings:
    """Load backend settings from its own .env, regardless of process cwd."""
    load_dotenv(dotenv_path=BACKEND_ENV_PATH, override=False)
    return AISettings.from_env()


class OpenRouterClient:
    """Small provider boundary; output is parsed and validated by Pydantic."""

    def __init__(
        self,
        settings: AISettings | None = None,
        *,
        http_client: httpx.Client | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.settings = settings or load_ai_settings()
        self._client = http_client or httpx.Client(timeout=timeout_seconds)
        self._owns_client = http_client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "OpenRouterClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def complete_structured(
        self,
        messages: list[dict[str, str]],
        response_model: type[T],
    ) -> T:
        """Request structured chat output, degrading format hints when unsupported."""
        schema_format = {
            "type": "json_schema",
            "json_schema": {
                "name": response_model.__name__,
                "strict": True,
                "schema": response_model.model_json_schema(),
            },
        }
        response = self._post(messages, schema_format)
        if response.status_code in (400, 422) and _unsupported_format(response):
            response = self._post(messages, {"type": "json_object"})
            if response.status_code in (400, 422) and _unsupported_format(response):
                response = self._post(messages, None)

        if response.is_error:
            status_code = response.status_code
            if status_code in (401, 403):
                category = "authentication"
            elif status_code == 429:
                category = "rate_limit"
            elif status_code in (408, 504):
                category = "timeout"
            else:
                category = "provider_error"
            raise AIProviderError(
                f"OpenRouter request failed with HTTP {status_code}",
                category=category,
                exception_class="HTTPStatusError",
                upstream_status_code=status_code,
            )
        try:
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("content must be text")
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AIInvalidOutputError(("model_output",)) from exc
        try:
            return response_model.model_validate_json(content)
        except ValidationError as exc:
            fields = tuple(
                dict.fromkeys(
                    str(error["loc"][0])
                    for error in exc.errors(include_input=False)
                    if error.get("loc") and isinstance(error["loc"][0], str)
                )
            ) or ("model_output",)
            raise AIInvalidOutputError(fields) from exc

    def _post(
        self,
        messages: list[dict[str, str]],
        response_format: dict[str, Any] | None,
    ) -> httpx.Response:
        body: dict[str, Any] = {"model": self.settings.model, "messages": messages}
        if response_format is not None:
            body["response_format"] = response_format
        try:
            return self._client.post(
                f"{self.settings.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.settings.api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                "OpenRouter request timed out",
                category="timeout",
                exception_class=type(exc).__name__,
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                "OpenRouter request could not be completed",
                category="transport_error",
                exception_class=type(exc).__name__,
            ) from exc


def _unsupported_format(response: httpx.Response) -> bool:
    """Recognize format-capability errors without masking unrelated API failures."""
    try:
        detail = response.text.lower()
    except httpx.ResponseNotRead:
        return False
    return any(
        term in detail
        for term in ("response_format", "json_schema", "json_object", "structured output", "structured_outputs")
    ) and any(term in detail for term in ("unsupported", "not support", "not allowed", "invalid"))
