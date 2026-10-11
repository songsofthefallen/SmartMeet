import assert from "node:assert/strict";
import test from "node:test";
// Node's built-in test runner strips types directly from this imported file.
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { localDateTimeFromExtraction, localTimeInputFromExtraction } from "./schedule-extraction-time.ts";

test("frontend accepts backend-normalized local time without an offset", () => {
  assert.equal(localTimeInputFromExtraction("08:00:00"), "08:00");
  assert.equal(
    localDateTimeFromExtraction("2026-10-12", "08:00:00"),
    "2026-10-12T08:00",
  );
});

test("frontend does not normalize an offset-bearing provider time a second time", () => {
  assert.equal(localTimeInputFromExtraction("08:00:00.000000+08:00"), null);
  assert.equal(localDateTimeFromExtraction("2026-10-12", "08:00:00+08:00"), null);
});
