import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { isCurrentGeneration } from "./request-generation.ts";

test("only the newest request generation may apply a result", () => {
  assert.equal(isCurrentGeneration(3, 3), true);
  assert.equal(isCurrentGeneration(2, 3), false);
  assert.equal(isCurrentGeneration(3, 2), false);
});
