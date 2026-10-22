import assert from "node:assert/strict";

const backendStatusModule = await import("./backend-status" + ".ts");
const { checkBackend } = backendStatusModule;

const healthUrl = "http://localhost:8000/health";

const response = (ok: boolean, body: unknown) => ({
  ok,
  json: async () => body,
});

{
  const result = await checkBackend(
    async (url: string, init: { signal: AbortSignal }) => {
      assert.equal(url, healthUrl);
      assert.equal(init.signal.aborted, false);
      return response(true, { status: "ok" });
    },
    healthUrl,
    new AbortController().signal,
  );
  assert.equal(result, "connected");
}

{
  const result = await checkBackend(
    async () => response(false, { status: "error" }),
    healthUrl,
    new AbortController().signal,
  );
  assert.equal(result, "unavailable");
}

{
  const result = await checkBackend(
    async () => response(true, { status: "not-ok" }),
    healthUrl,
    new AbortController().signal,
  );
  assert.equal(result, "unavailable");
}

{
  const result = await checkBackend(
    async () => {
      throw new Error("connection refused");
    },
    healthUrl,
    new AbortController().signal,
  );
  assert.equal(result, "unavailable");
}

{
  const controller = new AbortController();
  controller.abort();
  const result = await checkBackend(
    async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    },
    healthUrl,
    controller.signal,
  );
  assert.equal(result, "aborted");
}

{
  const controller = new AbortController();
  const result = await checkBackend(
    async () => {
      controller.abort();
      throw new Error("request cancelled by navigation");
    },
    healthUrl,
    controller.signal,
  );
  assert.equal(result, "aborted");
}

console.log("backend-status tests passed");
