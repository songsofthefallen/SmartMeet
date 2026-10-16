import assert from "node:assert/strict";
import test from "node:test";
// Node's TypeScript runner requires the explicit source extension.
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { isAssistantAutosaveEligible, type AssistantSaveFields } from "./assistant-autosave.ts";

const valid: AssistantSaveFields = {
  timeIntent: "arrival",
  targetDateTime: "2026-10-12T07:00",
  timezone: "Asia/Manila",
  preparationMinutes: null,
  travelMinutes: null,
  timezoneConflictConfirmed: true,
};

test("assistant autosave accepts complete fields with unknown durations", () => {
  assert.equal(isAssistantAutosaveEligible(valid), true);
});

test("assistant autosave waits for intent, target time, and timezone conflict confirmation", () => {
  assert.equal(isAssistantAutosaveEligible({ ...valid, timeIntent: "" }), false);
  assert.equal(isAssistantAutosaveEligible({ ...valid, targetDateTime: "" }), false);
  assert.equal(isAssistantAutosaveEligible({ ...valid, timezoneConflictConfirmed: false }), false);
});

test("assistant autosave rejects invalid durations", () => {
  assert.equal(isAssistantAutosaveEligible({ ...valid, travelMinutes: -1 }), false);
  assert.equal(isAssistantAutosaveEligible({ ...valid, preparationMinutes: 1.5 }), false);
});
