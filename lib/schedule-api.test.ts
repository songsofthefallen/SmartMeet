import assert from "node:assert/strict";
import test from "node:test";
// Node's TypeScript runner requires the explicit source extension.
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { scheduleApi, ScheduleApiError } from "./schedule-api.ts";

test("route refresh maps an expected no-route response to its safe error code and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: {
      code: "no_drivable_route",
      message: "TomTom could not find a drivable route. Traffic was not updated.",
    },
  }), { status: 422, headers: { "Content-Type": "application/json" } });

  try {
    await assert.rejects(
      scheduleApi.refreshTravelEstimate(123, "test-token"),
      (error: unknown) => error instanceof ScheduleApiError
        && error.status === 422
        && error.code === "no_drivable_route"
        && error.message.includes("Traffic was not updated"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
