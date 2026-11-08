import assert from "node:assert/strict";
import test from "node:test";
// Node's TypeScript runner strips types directly from this imported file.
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { clarificationQuestions } from "./clarification-messages.ts";

test("school plan clarification shows friendly deduplicated questions, never field identifiers", () => {
  const questions = clarificationQuestions({
    status: "needs_clarification",
    extraction: {
      is_schedule_request: true,
      time_intent: null,
      target_date_local: "2026-10-12",
      target_time_local: null,
      timezone: "Asia/Manila",
      preparation_duration_minutes: null,
      travel_duration_minutes: null,
      origin_description: null,
      destination_description: null,
      origin_saved_place_id: null,
      destination_saved_place_id: null,
      time_intent_ambiguous: true,
      ambiguities: ["time_intent"],
    },
    resolved_target_datetime: null,
    missing_fields: ["time_intent", "target_time_local"],
    ambiguous_fields: ["time_intent"],
    invalid_fields: [],
    draft_id: null,
    clarification: null,
  }, "Asia/Manila");

  const renderedText = questions.join("\n");
  assert.deepEqual(questions, [
    "Is this time for arriving or leaving?",
    "What local time should this schedule use?",
  ]);
  assert.equal(renderedText.includes("time_intent"), false);
  assert.equal(renderedText.includes("target_time_local"), false);
});

test("an offset validation issue does not ask for a clock time that was extracted", () => {
  const questions = clarificationQuestions({
    status: "needs_clarification",
    extraction: {
      is_schedule_request: true,
      time_intent: "departure",
      target_date_local: "2026-10-12",
      target_time_local: "10:00:00",
      timezone: "Asia/Tokyo",
      preparation_duration_minutes: null,
      travel_duration_minutes: null,
      origin_description: "Tokyo, Japan",
      destination_description: null,
      origin_saved_place_id: null,
      destination_saved_place_id: null,
      time_intent_ambiguous: false,
      ambiguities: [],
    },
    resolved_target_datetime: null,
    missing_fields: [],
    ambiguous_fields: [],
    invalid_fields: ["target_time_offset"],
    draft_id: null,
    clarification: null,
  }, "Asia/Tokyo");

  assert.deepEqual(questions, [
    "The AI attached a timezone offset that does not match this schedule's timezone. The clock time was preserved; review the timezone.",
  ]);
  assert.equal(questions.some((question) => question.includes("What local time")), false);
});

test("structured clarification presents one focused question", () => {
  const questions = clarificationQuestions({
    status: "needs_clarification",
    extraction: null,
    resolved_target_datetime: null,
    missing_fields: ["target_date_local", "target_time_local"],
    ambiguous_fields: [],
    invalid_fields: [],
    draft_id: "11111111-1111-1111-1111-111111111111",
    clarification: { field: "target_date_local", reason: "A date is needed.", question: "What date should I use?", answer_type: "date", options: [] },
  }, "Asia/Manila");
  assert.deepEqual(questions, ["What date should I use?"]);
});
