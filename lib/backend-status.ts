export type BackendCheckResult = "connected" | "unavailable" | "aborted";

type HealthResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchImplementation = (
  input: string,
  init: { signal: AbortSignal },
) => Promise<HealthResponse>;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export async function checkBackend(
  fetchImplementation: FetchImplementation,
  url: string,
  signal: AbortSignal,
): Promise<BackendCheckResult> {
  try {
    const response = await fetchImplementation(url, { signal });
    if (!response.ok) {
      return "unavailable";
    }

    const body = await response.json();
    return typeof body === "object" &&
      body !== null &&
      "status" in body &&
      body.status === "ok"
      ? "connected"
      : "unavailable";
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      return "aborted";
    }

    return "unavailable";
  }
}
