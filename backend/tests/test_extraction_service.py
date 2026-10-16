import json
from datetime import datetime

import httpx
import pytest
from pydantic import ValidationError

from ai_provider import AIProviderError, AISettings, OpenRouterClient
from extraction_schemas import ExtractionReviewStatus, ScheduleExtraction
from extraction_service import ScheduleExtractionError, ScheduleExtractionService
from models import TimeIntent


def candidate(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "is_schedule_request": True,
        "time_intent": "arrival",
        "target_date_local": "2026-10-12",
        "target_time_local": "07:00:00",
        "timezone": "Asia/Manila",
        "preparation_duration_minutes": None,
        "travel_duration_minutes": None,
        "time_intent_ambiguous": False,
        "ambiguities": [],
    }
    values.update(overrides)
    return values


def parsed_candidate(**overrides: object) -> ScheduleExtraction:
    return ScheduleExtraction.model_validate_json(json.dumps(candidate(**overrides)))


class MockExtractionClient:
    def __init__(self, result: ScheduleExtraction | Exception) -> None:
        self.result = result
        self.response_model: type | None = None
        self.messages: list[dict[str, str]] | None = None

    def complete_structured(
        self, messages: list[dict[str, str]], response_model: type
    ) -> ScheduleExtraction:
        self.messages = messages
        self.response_model = response_model
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def test_extraction_returns_valid_arrival_candidates_and_preserves_unknown_durations() -> None:
    client = MockExtractionClient(parsed_candidate())
    reference = datetime.fromisoformat("2026-10-11T20:00:00+08:00")

    result = ScheduleExtractionService(client).extract(
        "I need to be at class tomorrow at 7", reference_datetime=reference
    )

    assert result.status is ExtractionReviewStatus.READY_FOR_REVIEW
    assert result.extraction.time_intent is TimeIntent.ARRIVAL
    assert result.extraction.target_date_local.isoformat() == "2026-10-12"
    assert result.extraction.target_time_local.isoformat() == "07:00:00"
    assert result.extraction.preparation_duration_minutes is None
    assert result.extraction.travel_duration_minutes is None
    assert result.missing_fields == []
    assert result.resolved_target_datetime.isoformat() == "2026-10-11T23:00:00+00:00"
    assert client.response_model is ScheduleExtraction
    assert "Reference instant: 2026-10-11T20:00:00+08:00" in client.messages[1]["content"]


@pytest.mark.parametrize("intent", ["arrival", "departure"])
def test_extraction_schema_supports_both_existing_intents(intent: str) -> None:
    parsed = parsed_candidate(time_intent=intent)
    assert parsed.time_intent.value == intent


def test_extraction_schema_accepts_explicit_nonnegative_durations() -> None:
    parsed = parsed_candidate(preparation_duration_minutes=25, travel_duration_minutes=40)
    assert parsed.preparation_duration_minutes == 25
    assert parsed.travel_duration_minutes == 40


def test_missing_and_ambiguous_information_stays_null_and_is_reported() -> None:
    extracted = parsed_candidate(
        time_intent=None,
        target_time_local=None,
        timezone=None,
        time_intent_ambiguous=True,
        ambiguities=["It is unclear whether 7 means arrival or departure."],
    )

    client = MockExtractionClient(extracted)
    result = ScheduleExtractionService(client).extract(
        "I have something at 7", reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00")
    )

    assert result.status is ExtractionReviewStatus.NEEDS_CLARIFICATION
    assert result.extraction.time_intent is None
    assert result.extraction.target_time_local is None
    assert result.extraction.preparation_duration_minutes is None
    assert result.extraction.travel_duration_minutes is None
    assert result.missing_fields == ["time_intent", "target_time_local", "timezone"]
    assert result.ambiguous_fields == ["time_intent", "ambiguities"]


def test_extraction_does_not_generate_or_require_a_schedule_title() -> None:
    extracted = parsed_candidate()
    result = ScheduleExtractionService(MockExtractionClient(extracted)).extract(
        "I need to arrive at school by 8:00 AM tomorrow",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.READY_FOR_REVIEW
    assert "title" not in ScheduleExtraction.model_fields


def test_missing_model_timezone_uses_selected_timezone_without_clarification() -> None:
    extracted = parsed_candidate(timezone=None)
    result = ScheduleExtractionService(MockExtractionClient(extracted)).extract(
        "Arrive at school tomorrow at 8 AM",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.READY_FOR_REVIEW
    assert result.extraction.timezone == "Asia/Manila"
    assert "timezone" not in result.missing_fields
    assert "timezone" not in result.ambiguous_fields


def test_relative_date_uses_explicit_reference_in_trusted_timezone() -> None:
    client = MockExtractionClient(parsed_candidate(target_date_local="2026-10-13"))
    reference = datetime.fromisoformat("2026-10-11T23:30:00+00:00")

    result = ScheduleExtractionService(client).extract(
        "I need to arrive tomorrow at 7",
        reference_datetime=reference,
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.READY_FOR_REVIEW
    assert result.extraction.target_date_local.isoformat() == "2026-10-13"
    assert "Reference local date/time: 2026-10-12T07:30:00+08:00" in client.messages[1]["content"]


def test_model_time_offset_matching_timezone_is_normalized_to_local_wall_time() -> None:
    # OpenRouter returned this offset-bearing ISO time for the user's "8:00 AM".
    extracted = parsed_candidate(
        target_date_local="2026-10-12",
        target_time_local="08:00:00.000000+08:00",
        timezone="Asia/Manila",
        preparation_duration_minutes=60,
        travel_duration_minutes=90,
    )
    client = MockExtractionClient(extracted)

    result = ScheduleExtractionService(client).extract(
        "I need to arrive at school by 8:00 AM tomorrow. It takes 90 minutes to travel and 60 minutes to prepare.",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.READY_FOR_REVIEW
    assert result.extraction.target_date_local.isoformat() == "2026-10-12"
    assert result.extraction.target_time_local.isoformat() == "08:00:00"
    assert result.extraction.timezone == "Asia/Manila"
    assert result.extraction.preparation_duration_minutes == 60
    assert result.extraction.travel_duration_minutes == 90
    assert result.resolved_target_datetime.isoformat() == "2026-10-12T00:00:00+00:00"


def test_model_time_offset_must_match_resolved_timezone() -> None:
    extracted = parsed_candidate(
        target_date_local="2026-10-12",
        target_time_local="08:00:00+09:00",
        timezone="Asia/Manila",
        preparation_duration_minutes=60,
        travel_duration_minutes=90,
    )
    result = ScheduleExtractionService(MockExtractionClient(extracted)).extract(
        "Arrive tomorrow at 8 AM",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.NEEDS_CLARIFICATION
    assert result.extraction is not None
    assert result.extraction.target_time_local is None
    assert result.extraction.target_date_local.isoformat() == "2026-10-12"
    assert result.extraction.preparation_duration_minutes == 60
    assert result.extraction.travel_duration_minutes == 90
    assert result.missing_fields == ["target_time_local"]
    assert result.invalid_fields == ["target_time_offset"]


def test_explicit_model_timezone_conflict_requires_confirmation_and_keeps_values() -> None:
    extracted = parsed_candidate(
        target_date_local="2026-10-12",
        target_time_local="08:00:00+08:00",
        timezone="Europe/Paris",
        preparation_duration_minutes=60,
        travel_duration_minutes=90,
    )
    result = ScheduleExtractionService(MockExtractionClient(extracted)).extract(
        "Arrive at school tomorrow at 8 AM",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.status is ExtractionReviewStatus.NEEDS_CLARIFICATION
    assert result.extraction.timezone == "Europe/Paris"
    assert result.extraction.target_time_local.isoformat() == "08:00:00"
    assert result.extraction.target_date_local.isoformat() == "2026-10-12"
    assert result.extraction.preparation_duration_minutes == 60
    assert result.extraction.travel_duration_minutes == 90
    assert result.ambiguous_fields == ["timezone"]


def test_missing_timezone_context_requires_clarification_without_inventing_timezone() -> None:
    client = MockExtractionClient(parsed_candidate(timezone=None))
    result = ScheduleExtractionService(client).extract(
        "Class tomorrow at 7",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
    )

    assert result.status is ExtractionReviewStatus.NEEDS_CLARIFICATION
    assert result.extraction.timezone is None
    assert result.missing_fields == ["timezone"]
    assert result.resolved_target_datetime is None


@pytest.mark.parametrize(
    ("target_date", "target_time", "status", "field"),
    [
        ("2026-03-29", "02:30:00", ExtractionReviewStatus.NEEDS_CLARIFICATION, "invalid_fields"),
        ("2026-10-25", "02:30:00", ExtractionReviewStatus.NEEDS_CLARIFICATION, "ambiguous_fields"),
    ],
)
def test_dst_gap_and_repeated_local_time_require_clarification(
    target_date: str,
    target_time: str,
    status: ExtractionReviewStatus,
    field: str,
) -> None:
    client = MockExtractionClient(
        parsed_candidate(
            target_date_local=target_date,
            target_time_local=target_time,
            timezone="Europe/Paris",
        )
    )
    result = ScheduleExtractionService(client).extract(
        "A schedule request",
        reference_datetime=datetime.fromisoformat("2026-01-01T12:00:00+01:00"),
    )

    assert result.status is status
    assert result.resolved_target_datetime is None
    assert getattr(result, field) == ["target_time_local"]


@pytest.mark.parametrize(
    "changes",
    [
        {"time_intent": "unknown"},
        {"target_time_local": "not a time"},
        {"timezone": "Not/AZone"},
        {"travel_duration_minutes": -1},
        {"time_intent_ambiguous": True, "time_intent": "arrival"},
        {"unexpected": "model-added field"},
    ],
)
def test_extraction_schema_rejects_invalid_untrusted_candidates(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ScheduleExtraction.model_validate_json(json.dumps(candidate(**changes)))


def test_service_maps_provider_failures_to_safe_extraction_error() -> None:
    client = MockExtractionClient(AIProviderError("private upstream detail"))

    with pytest.raises(ScheduleExtractionError, match="temporarily unavailable") as error:
        ScheduleExtractionService(client).extract(
            "class tomorrow", reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00")
        )

    assert "private upstream detail" not in str(error.value)


def test_service_logs_sanitized_provider_failure_metadata(caplog: pytest.LogCaptureFixture) -> None:
    client = MockExtractionClient(AIProviderError(
        "private upstream detail",
        category="timeout",
        exception_class="ReadTimeout",
    ))

    with caplog.at_level("WARNING", logger="extraction_service"):
        with pytest.raises(ScheduleExtractionError):
            ScheduleExtractionService(client).extract(
                "class tomorrow",
                reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
            )

    message = caplog.text
    assert "exception_class=ReadTimeout" in message
    assert "category=timeout" in message
    assert "elapsed_ms=" in message
    assert "upstream_http_status=none" in message
    assert "private upstream detail" not in message


@pytest.mark.parametrize(
    ("status_code", "category"),
    [(401, "authentication"), (429, "rate_limit"), (503, "provider_error")],
)
def test_service_logs_sanitized_upstream_status_and_category(
    status_code: int, category: str, caplog: pytest.LogCaptureFixture,
) -> None:
    client = MockExtractionClient(AIProviderError(
        "private upstream response body",
        category=category,
        exception_class="HTTPStatusError",
        upstream_status_code=status_code,
    ))

    with caplog.at_level("WARNING", logger="extraction_service"):
        with pytest.raises(ScheduleExtractionError):
            ScheduleExtractionService(client).extract(
                "class tomorrow",
                reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
            )

    assert f"exception_class=HTTPStatusError category={category}" in caplog.text
    assert f"upstream_http_status={status_code}" in caplog.text
    assert "elapsed_ms=" in caplog.text
    assert "private upstream response body" not in caplog.text


def test_service_rejects_invalid_mocked_provider_output() -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        invalid = candidate(target_date_local="2026-02-30")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(invalid)}}]},
        )

    settings = AISettings(
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key="mock-key",
        model="mock-model",
    )
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        service = ScheduleExtractionService(OpenRouterClient(settings, http_client=http))
        result = service.extract(
            "class tomorrow", reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00")
        )
    assert result.status is ExtractionReviewStatus.NEEDS_CLARIFICATION
    assert result.extraction is None
    assert result.invalid_fields == ["target_date_local"]


def test_trusted_user_timezone_fills_only_an_unresolved_timezone() -> None:
    extracted = parsed_candidate(timezone=None)
    client = MockExtractionClient(extracted)
    service = ScheduleExtractionService(client)

    result = service.extract(
        "class tomorrow at 7",
        reference_datetime=datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
        user_timezone="Asia/Manila",
    )

    assert result.extraction.timezone == "Asia/Manila"
    assert "timezone" not in result.missing_fields
    assert "Reference local date/time: 2026-10-11T20:00:00+08:00" in client.messages[1]["content"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"user_text": "  "},
        {"user_text": "x" * 4001},
        {"user_text": "event", "reference_datetime": datetime(2026, 10, 11, 20)},
        {
            "user_text": "event",
            "reference_datetime": datetime.fromisoformat("2026-10-11T20:00:00+08:00"),
            "user_timezone": "Not/AZone",
        },
    ],
)
def test_service_validates_input_and_trusted_time_context(kwargs: dict[str, object]) -> None:
    defaults = {"reference_datetime": datetime.fromisoformat("2026-10-11T20:00:00+08:00")}
    defaults.update(kwargs)
    service = ScheduleExtractionService(MockExtractionClient(parsed_candidate()))
    with pytest.raises(ScheduleExtractionError):
        service.extract(**defaults)  # type: ignore[arg-type]
