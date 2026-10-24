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

test("route options keep suspicious route data distinct from a no-route outcome", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input).endsWith("/schedules/route-options"), true);
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(
      [sent.origin_location.latitude, sent.origin_location.longitude, sent.location.latitude, sent.location.longitude],
      [14.5, 121.0, 14.6, 121.1],
    );
    return new Response(JSON.stringify({
      detail: {
        code: "suspicious_route",
        message: "TomTom returned route details that look implausible. This estimate was not used.",
      },
    }), { status: 422, headers: { "Content-Type": "application/json; charset=utf-8" } });
  };

  try {
    await assert.rejects(
      scheduleApi.routeOptions({
        origin_location: { name: "A", locality: null, region: null, country: null, latitude: 14.5, longitude: 121.0, timezone: null },
        location: { name: "B", locality: null, region: null, country: null, latitude: 14.6, longitude: 121.1, timezone: null },
        time_intent: "arrival",
        target_datetime: "2026-10-30T10:00:00+08:00",
      }, "test-token"),
      (error: unknown) => error instanceof ScheduleApiError
        && error.status === 422
        && error.code === "suspicious_route"
        && error.message.includes("This estimate was not used"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborted requests are reported as cancellation instead of service outage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };

  const controller = new AbortController();
  const request = scheduleApi.list("test-token", { signal: controller.signal });
  controller.abort();
  try {
    await assert.rejects(
      request,
      (error: unknown) => error instanceof ScheduleApiError
        && error.code === "cancelled"
        && error.status === null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saved place CRUD uses the authenticated API and preserves its confirmed location", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const saved = { id: 2, alias: "Home", display_name: "Central Library", latitude: 14.6, longitude: 121,
    formatted_address: "Manila, Philippines", locality: "Manila", region: "Metro Manila", country: "Philippines",
    timezone: "Asia/Manila", location_source: "tomtom_search", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z" };
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") return new Response(JSON.stringify([saved]), { status: 200 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify(saved), { status: method === "POST" ? 201 : 200 });
  };
  try {
    assert.equal((await scheduleApi.savedPlaces("token"))[0].longitude, 121);
    await scheduleApi.createSavedPlace({ alias: "Home", display_name: "Central Library", latitude: 14.6, longitude: 121,
      formatted_address: "Manila, Philippines", locality: "Manila", region: "Metro Manila", country: "Philippines",
      timezone: "Asia/Manila", location_source: "tomtom_search" }, "token");
    await scheduleApi.updateSavedPlace(2, { alias: "Work" }, "token");
    await scheduleApi.deleteSavedPlace(2, "token");
    assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
      ["/saved-places", "GET"], ["/saved-places", "POST"], ["/saved-places/2", "PATCH"], ["/saved-places/2", "DELETE"],
    ]);
    assert.equal((calls[1].body as { latitude: number }).latitude, 14.6);
  } finally { globalThis.fetch = originalFetch; }
});

test("location map and reverse-geocode requests preserve map pin coordinates without an address", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { path: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith("/locations/map-image")) return new Response(new Blob(["png"]), { status: 200, headers: { "Content-Type": "image/png" } });
    return new Response(JSON.stringify({ address: null }), { status: 200 });
  };
  try {
    const image = await scheduleApi.savedPlaceMap({ latitude: 14.6, longitude: 121.0 }, 16, "token");
    assert.equal(image.type, "image/png");
    assert.deepEqual(await scheduleApi.reverseGeocode({ latitude: 14.6, longitude: 121.0 }, "token"), { address: null });
    assert.deepEqual(calls, [
      { path: "/locations/map-image", body: { latitude: 14.6, longitude: 121, zoom: 16 } },
      { path: "/locations/reverse-geocode", body: { latitude: 14.6, longitude: 121 } },
    ]);
  } finally { globalThis.fetch = originalFetch; }
});
