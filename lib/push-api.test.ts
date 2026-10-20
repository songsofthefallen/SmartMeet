import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's TypeScript runner requires the explicit source extension.
import { scheduleApi } from "./schedule-api.ts";

test("push subscription registration and removal use authenticated backend contracts", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  };
  try {
    const subscription = { endpoint: "https://push.example/subscription", keys: { p256dh: "public-key", auth: "auth-secret" } };
    await scheduleApi.registerPushSubscription(subscription, "clerk-token");
    await scheduleApi.removePushSubscription(subscription.endpoint, "clerk-token");
    assert.equal(calls[0].url.endsWith("/push/subscriptions"), true);
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), subscription);
    assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), "Bearer clerk-token");
    assert.equal(calls[1].init?.method, "DELETE");
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { endpoint: subscription.endpoint });
  } finally { globalThis.fetch = originalFetch; }
});

test("test push requires the backend acceptance response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ accepted: true }), { status: 200 });
  try { await scheduleApi.testPushNotification("clerk-token"); }
  finally { globalThis.fetch = originalFetch; }
});

test("test push rejects malformed backend responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ accepted: false }), { status: 200 });
  try { await assert.rejects(scheduleApi.testPushNotification("clerk-token"), /invalid response/i); }
  finally { globalThis.fetch = originalFetch; }
});
