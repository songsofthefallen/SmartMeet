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
      title: "Go to school",
      time_intent: null,
      target_date_local: "2026-10-12",
      target_time_local: null,
      timezone: "Asia/Manila",
      preparation_duration_minutes: null,
      travel_duration_minutes: null,
      time_intent_ambiguous: true,
      ambiguities: ["time_intent"],
    },
    resolved_target_datetime: null,
    missing_fields: ["time_intent", "target_time_local"],
    ambiguous_fields: ["time_intent"],
    invalid_fields: [],
  }, "Asia/Manila");

  const renderedText = questions.join("\n");
  assert.deepEqual(questions, [
    "Is this time for arriving or leaving?",
    "What local time should this schedule use?",
  ]);
  assert.equal(renderedText.includes("time_intent"), false);
  assert.equal(renderedText.includes("target_time_local"), false);
});
