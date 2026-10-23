import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { isCurrentGeneration, isCurrentGenerationForKey } from "./request-generation.ts";

test("only the newest request generation may apply a result", () => {
  assert.equal(isCurrentGeneration(3, 3), true);
  assert.equal(isCurrentGeneration(2, 3), false);
  assert.equal(isCurrentGeneration(3, 2), false);
});

test("a stale route result for a different location pair cannot apply", () => {
  const previousPair = JSON.stringify([{ latitude: 14.5, longitude: 121 }, { latitude: 14.6, longitude: 121.1 }]);
  const currentPair = JSON.stringify([{ latitude: 15.5, longitude: 120.9 }, { latitude: 15.6, longitude: 121.1 }]);
  assert.equal(isCurrentGenerationForKey(4, 4, previousPair, currentPair), false);
  assert.equal(isCurrentGenerationForKey(4, 4, currentPair, currentPair), true);
  assert.equal(isCurrentGenerationForKey(3, 4, previousPair, previousPair), false);
});
