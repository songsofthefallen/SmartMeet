import json
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel

import ai_provider
from ai_provider import (
    AIConfigurationError,
    AIProviderError,
    AISettings,
    DEFAULT_AI_BASE_URL,
    DEFAULT_AI_MODEL,
    OpenRouterClient,
)


class Extracted(BaseModel):
    title: str
    ready: bool


def settings(**overrides: str) -> AISettings:
    values = {
        "provider": "openrouter",
        "base_url": DEFAULT_AI_BASE_URL,
        "api_key": "test-secret",
        "model": DEFAULT_AI_MODEL,
    }
    values.update(overrides)
    return AISettings(**values)


def test_settings_default_to_openrouter_free_and_allow_model_override(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("AI_API_KEY", "test-secret")

    configured = AISettings.from_env()
    assert configured.provider == "openrouter"
    assert configured.base_url == DEFAULT_AI_BASE_URL
    assert configured.model == DEFAULT_AI_MODEL

    monkeypatch.setenv("AI_MODEL", "vendor/model-choice")
    assert AISettings.from_env().model == "vendor/model-choice"


def test_settings_require_key_and_reject_other_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AI_API_KEY", raising=False)
    with pytest.raises(AIConfigurationError, match="AI_API_KEY"):
        AISettings.from_env()

    monkeypatch.setenv("AI_API_KEY", "test-secret")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    with pytest.raises(AIConfigurationError, match="openrouter"):
        AISettings.from_env()


def test_client_loads_backend_env_when_started_from_another_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend_env = Path.cwd() / ".env"
    monkeypatch.setattr(ai_provider, "BACKEND_ENV_PATH", backend_env)
    monkeypatch.chdir(Path.cwd().parent)
    for key in ("AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    loaded_paths: list[Path] = []

    def load_backend_env(*, dotenv_path: Path, override: bool) -> None:
        loaded_paths.append(dotenv_path)
        assert override is False
        monkeypatch.setenv("AI_PROVIDER", "openrouter")
        monkeypatch.setenv("AI_BASE_URL", DEFAULT_AI_BASE_URL)
        monkeypatch.setenv("AI_API_KEY", "regression-test-key")
        monkeypatch.setenv("AI_MODEL", "vendor/test-model")

    monkeypatch.setattr(ai_provider, "load_dotenv", load_backend_env)
    client = OpenRouterClient()
    try:
        assert loaded_paths == [backend_env]
        assert client.settings.model == "vendor/test-model"
        assert client.settings.api_key == "regression-test-key"
    finally:
        client.close()

def test_client_requests_openai_compatible_schema_and_validates_with_pydantic() -> None:
    captured: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"title":"Class","ready":true}'}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        result = OpenRouterClient(settings(), http_client=http).complete_structured(
            [{"role": "user", "content": "extract"}], Extracted
        )

    assert result == Extracted(title="Class", ready=True)
    assert captured[0].url == "https://openrouter.ai/api/v1/chat/completions"
    assert captured[0].headers["Authorization"] == "Bearer test-secret"
    body = json.loads(captured[0].content)
    assert body["model"] == "openrouter/free"
    assert body["response_format"]["type"] == "json_schema"


@pytest.mark.parametrize("unsupported", ["json_schema is not supported", "response_format unsupported"])
def test_client_falls_back_when_model_rejects_structured_output(unsupported: str) -> None:
    formats: list[object] = []

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        formats.append(body.get("response_format"))
        if len(formats) == 1:
            return httpx.Response(400, json={"error": {"message": unsupported}})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"title":"Class","ready":true}'}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        result = OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)

    assert result.title == "Class"
    assert formats[0]["type"] == "json_schema"
    assert formats[1] == {"type": "json_object"}


def test_client_drops_format_hint_if_json_mode_is_also_unsupported() -> None:
    formats: list[object] = []

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        formats.append(body.get("response_format"))
        if len(formats) < 3:
            hint = "json_schema" if len(formats) == 1 else "json_object"
            return httpx.Response(400, json={"error": {"message": f"{hint} unsupported"}})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"title":"Class","ready":true}'}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        result = OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)

    assert result.ready is True
    assert formats == [
        {"type": "json_schema", "json_schema": {"name": "Extracted", "strict": True, "schema": Extracted.model_json_schema()}},
        {"type": "json_object"},
        None,
    ]


def test_client_rejects_invalid_model_output_and_sanitizes_provider_errors() -> None:
    def invalid_output(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"title":4}'}}]})

    with httpx.Client(transport=httpx.MockTransport(invalid_output)) as http:
        with pytest.raises(AIProviderError, match="invalid structured response"):
            OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)

    def provider_error(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="private provider detail")

    with httpx.Client(transport=httpx.MockTransport(provider_error)) as http:
        with pytest.raises(AIProviderError, match="HTTP 500") as error:
            OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)
    assert "private provider detail" not in str(error.value)
    assert "test-secret" not in str(error.value)


def test_client_maps_timeouts_to_safe_provider_error() -> None:
    def timeout(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timeout with private details")

    with httpx.Client(transport=httpx.MockTransport(timeout)) as http:
        with pytest.raises(AIProviderError, match="timed out") as error:
            OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)
    assert "private details" not in str(error.value)


@pytest.mark.parametrize(
    ("status_code", "category"),
    [
        (401, "authentication"),
        (403, "authentication"),
        (429, "rate_limit"),
        (408, "timeout"),
        (504, "timeout"),
        (500, "provider_error"),
    ],
)
def test_client_classifies_upstream_status_without_retaining_response_body(
    status_code: int, category: str,
) -> None:
    def provider_error(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, text="private provider response body")

    with httpx.Client(transport=httpx.MockTransport(provider_error)) as http:
        with pytest.raises(AIProviderError) as error:
            OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)

    assert error.value.category == category
    assert error.value.exception_class == "HTTPStatusError"
    assert error.value.upstream_status_code == status_code
    assert "private provider response body" not in str(error.value)


def test_client_classifies_transport_timeout_by_exception_class() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private timeout details", request=request)

    with httpx.Client(transport=httpx.MockTransport(timeout)) as http:
        with pytest.raises(AIProviderError) as error:
            OpenRouterClient(settings(), http_client=http).complete_structured([], Extracted)

    assert error.value.category == "timeout"
    assert error.value.exception_class == "ReadTimeout"
    assert error.value.upstream_status_code is None
    assert "private timeout details" not in str(error.value)
