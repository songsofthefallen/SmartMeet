# SmartMeet external API reliability investigation

Date: 2026-10-22  
Scope: OpenRouter schedule extraction, Open-Meteo weather, and TomTom geocoding/routing  
Change policy: application code was not modified. This report is the only new deliverable from this investigation.

## Executive summary

The reported external-service failures are not one common failure mode:

- **Confirmed current issue — OpenRouter:** one safe diagnostic request through the configured client timed out with `httpx.ReadTimeout` and no upstream HTTP status. The backend maps that to `POST /schedules/extract` HTTP 503, and the browser displays the preserved-input recovery message. This is a provider/network timeout, not evidence of an authentication or rate-limit response.
- **Open-Meteo:** the implementation has a short four-second per-request timeout and bounded two-request concurrency. Automated tests confirm timeout and malformed-response handling, including recovery on a later attempt. No new live Open-Meteo failure was generated in this pass, so provider-side cause and real-world frequency remain unknown.
- **TomTom:** search, routing, reverse geocoding, landmarks, and map calls use bounded timeouts and safe status mapping. Automated tests cover timeouts, route computation limits, no-route responses, caching, and refresh concurrency. A live location search succeeded; no live TomTom timeout was observed.

The main cross-cutting reliability risks are missing browser-to-backend cancellation signals, scalar rather than phase-specific HTTP timeouts, and the OpenRouter structured-output compatibility fallback potentially issuing multiple provider requests for one user action. No evidence supports indiscriminately increasing timeouts or adding a shared retry policy.

## Evidence and confidence

### Direct and existing evidence

1. Existing exploratory browser evidence recorded an authenticated natural-language extraction attempt returning browser HTTP 503. The UI showed `Schedule extraction is temporarily unavailable` and preserved the entered text. See [real-browser-test-results.md](./real-browser-test-results.md).
2. Existing project investigation records a configured-client OpenRouter request ending in `httpx.ReadTimeout`, with no upstream HTTP status. See the “Schedule extraction 503 regression investigation” section in [progress-tracker.md](../../context/progress-tracker.md).
3. The focused backend suite passed **215 tests in 9.34 seconds** during this investigation:

   `tests/test_ai_provider.py tests/test_extraction_service.py tests/test_weather.py tests/test_locations.py tests/test_routing.py tests/test_schedule_api.py`

4. No durable runtime log files containing provider failures were found in the repository. Existing sanitized logging and test assertions were used instead. No credentials, authorization headers, response bodies, or user-sensitive data were collected.

### Limitations of this pass

- No repeated paid AI calls were made. The current OpenRouter evidence is one prior safe diagnostic request plus the prior browser 503 capture.
- No new live Open-Meteo or TomTom failure was forced. Doing so would add little value and could create unnecessary provider traffic.
- The browser was not used to bypass Clerk authentication or to create additional external-provider traffic. Existing authenticated browser evidence was reused.
- Browser-side cancellation and server behavior after a user navigates away are inferred from the code path; they are not confirmed with a packet-level or server-disconnect trace.

## Request-flow trace

### OpenRouter AI extraction

Flow: `schedule-workspace.tsx` → `lib/schedule-api.ts` → `POST /schedules/extract` → `ScheduleExtractionService` → `OpenRouterClient` → OpenAI-compatible OpenRouter endpoint.

Relevant implementation: [schedule-workspace.tsx](../../app/schedules/schedule-workspace.tsx), [schedule-api.ts](../../lib/schedule-api.ts), [extraction.py](../../backend/routers/extraction.py), [extraction_service.py](../../backend/extraction_service.py), and [ai_provider.py](../../backend/ai_provider.py).

- The frontend uses browser `fetch` with `cache: "no-store"`; the shared request helper does not supply an `AbortSignal` or client-side timeout.
- `OpenRouterClient` constructs `httpx.Client(timeout=30.0)` by default. This is one scalar timeout; no separate connect, read, write, or pool values are configured, so those phases are not independently controlled.
- There is no general automatic retry. A 400/422 response identified as unsupported structured output triggers sequential fallback requests using JSON-object mode and then no response-format hint. That can produce up to three provider requests for one extraction attempt. It is gated to compatibility errors, but it can still duplicate provider usage and must be treated as a paid-request risk if the selected model/provider is billable.
- Timeout exceptions become an `AIProviderError` classified as `timeout`; other HTTP transport exceptions become `transport_error`. Provider statuses are classified as authentication (401/403), rate limit (429), timeout (408/504), or provider error. Response bodies are not retained in the safe error metadata.
- `ScheduleExtractionService` logs sanitized exception class, category, elapsed milliseconds, and upstream status, then converts provider failures to `ScheduleExtractionError`.
- The extraction router returns HTTP 503 with `Schedule extraction is temporarily unavailable`. Configuration failures also return 503, so the current public status does not distinguish missing configuration from a transient provider timeout.
- The frontend preserves the natural-language input and offers a manual continuation path when extraction fails. This behavior was confirmed in prior browser evidence.
- The UI prevents duplicate extraction clicks with `extractionInFlight`, but it does not cancel the browser request on unmount/navigation. A browser navigation may terminate the browser-side fetch, while the synchronous FastAPI/provider work may continue unless the serving stack detects the disconnected client. There is no request-generation guard in this flow for late results.

### Open-Meteo weather

Flow: schedule create/edit or weather refresh → schedule router `_refresh_weather` → `OpenMeteoWeatherService.assess` → two Open-Meteo forecast requests.

Relevant implementation: [weather_service.py](../../backend/weather_service.py), [schedules.py](../../backend/routers/schedules.py), and [schedule-api.ts](../../lib/schedule-api.ts).

- Each forecast request uses `httpx` with `timeout=4.0`. As with OpenRouter, this is a scalar timeout rather than explicit connect/read/write/pool values.
- Origin and destination requests are launched concurrently with `ThreadPoolExecutor(max_workers=2)`. There is no retry. If either endpoint fails, the assessment becomes unavailable and no unverified weather buffer is applied.
- Timeout exceptions are classified as `provider_timeout`; other transport/status problems become `provider_request_failure`; malformed or incomplete data becomes an invalid-response/missing-data reason. The service retains only safe endpoint/hour diagnostics.
- Weather failure is intentionally non-fatal to schedule timing. The router persists an unavailable weather estimate and keeps the schedule’s deterministic wake/departure/arrival calculations. The weather refresh endpoint returns the schedule with the unavailable estimate rather than converting an optional advisory failure into a schedule-save failure.
- The adapter has no provider-response TTL cache. The persisted schedule weather estimate is retained, but an explicit refresh calls the provider again. The two concurrent requests are bounded to two workers per assessment, but many simultaneous users/requests can still create one two-request pair per in-flight assessment.
- The frontend request helper has no abort signal. Weather refresh has a per-schedule UI guard, but no cancellation on unmount/navigation and no stale-result generation token.

### TomTom geocoding and routing

Flow: location search or schedule route action → `lib/schedule-api.ts` → authenticated schedule router → TomTom service → TomTom Search/Routing APIs.

Relevant implementation: [location_service.py](../../backend/location_service.py), [routing_service.py](../../backend/routing_service.py), [schedules.py](../../backend/routers/schedules.py), and [schedule-workspace.tsx](../../app/schedules/schedule-workspace.tsx).

Timeouts currently used:

| Operation | Provider call | Timeout | Retry/cache behavior |
|---|---|---:|---|
| Location search | TomTom Search Fuzzy Search | 5s | No retry; no search-result cache |
| Route options/estimate | TomTom Routing | 35s | No automatic retry; route refresh has server reservation/cooldown limits |
| Reverse geocode | TomTom Search reverse geocode | 2s | No retry; bounded six-hour cache |
| Route landmarks | TomTom Search Along Route | 5s | No retry; bounded six-hour cache and result limit |
| Static map | TomTom Static Image | 8s | No retry; response is browser/cache controlled |

- All values are scalar `httpx` timeouts; no phase-specific connect/read/write/pool policy is configured.
- Search and landmark transport/HTTP/validation failures become safe `LocationProviderError` responses. Missing credentials map to 503; provider failure maps to 502.
- Route timeout and TomTom compute-limit errors map to HTTP 504 with a user-actionable fallback. No-route maps to 422. Other route provider failures map to 502. For an already-saved schedule, route refresh preserves the saved estimate on failure. A selected-route save failure does not save the schedule and tells the user to refresh route options or save without an estimate.
- Route refresh attempts are reserved server-side, rate limited with HTTP 429/`Retry-After`, and guarded against concurrent refreshes. The UI also applies a 60-second per-schedule cooldown and disables overlapping route/weather refresh controls. These controls reduce duplicate route requests, but initial route-options calls and location searches remain ordinary uncancelled requests.
- Extraction success can start origin and destination location searches concurrently through `Promise.allSettled`; this is bounded at the browser action level to two searches, but there is no abort signal or stale-query generation guard.

## Failure-handling assessment

| Integration | Confirmed behavior | Assessment |
|---|---|---|
| OpenRouter | Timeout becomes sanitized backend 503; input is preserved and manual flow remains usable | Accurate enough for a transient outage, but 503 also covers configuration and does not distinguish timeout vs provider error to the user |
| Open-Meteo | Timeout/malformed data produces unavailable advisory; schedule calculations remain valid; later attempts can recover | Safe optional-data behavior; no confirmed live outage in this pass |
| TomTom search/routing | Missing configuration, timeout, no-route, rate-limit, and provider failures have distinct safe mappings; saved route estimate is preserved during refresh failure | Strongest provider-specific handling; no confirmed live timeout in this pass |

## Confirmed bugs, risks, and harmless/configuration findings

### Confirmed issue: OpenRouter extraction currently times out and returns 503

- **Severity:** Medium; blocks the AI-assisted extraction feature, but manual schedule entry remains available.
- **Reproduction evidence:** Existing authenticated browser run submitted natural-language extraction and observed browser HTTP 503; the UI displayed the temporary-unavailability message and preserved the input. Existing configured-client diagnostic observed `httpx.ReadTimeout` with no upstream status.
- **Classification:** timeout/transport failure, not confirmed rate limiting, authentication failure, or provider HTTP error.
- **Root cause:** the configured OpenRouter request did not produce a response within the client’s scalar timeout. The application’s exception mapping is functioning as designed; the upstream reachability/latency cause is not established.

### Confirmed design risk: no end-to-end cancellation

Frontend requests do not pass an `AbortSignal`. Navigation can abandon the browser response, but there is no explicit application-level cancellation or server/provider cancellation policy. This can leave work running after the user has left the screen and can allow a late response to compete with newer state. This was not packet-traced as a live bug, so it is reported as a confirmed code-path risk rather than a reproduced user-visible failure.

### Confirmed design risk: OpenRouter compatibility fallback can duplicate requests

The structured-output fallback intentionally retries with alternate response-format settings after specific 400/422 responses. It is not a broad unsafe retry, but it can issue multiple requests for one action and should be reviewed against provider billing and model behavior. No evidence shows that this caused the observed timeout.

### Harmless warnings and configuration issues

- The earlier pytest run emitted a Windows pytest-cache-path warning but completed successfully; this is a test-environment warning, not an application failure.
- OpenRouter key/model configuration is present according to the existing sanitized verification. The observed timeout had no upstream status, so it should not be labeled as an invalid-key incident.
- SmartMeet branding is intentional and was not evaluated as a defect.

## Prioritized reliability plan (no code changes made)

1. **Add correlation-safe diagnostics first.** Generate a request ID at the backend boundary and log only provider name, operation, exception class, elapsed time, sanitized category, and upstream status. Keep API keys, authorization headers, response bodies, coordinates, and user text out of logs. This will distinguish connect, read, provider, rate-limit, and application failures in production.
2. **Add explicit phase timeouts per provider.** Use separate connect/read/write/pool values rather than increasing every phase together. OpenRouter needs a bounded read timeout appropriate for model latency; Open-Meteo and search should remain short; TomTom routing needs its existing longer computation budget but a bounded connect/pool timeout.
3. **Use provider-specific retry rules.** OpenRouter: at most one bounded retry with jitter for transport/read timeout if duplicate usage is acceptable and an idempotency mechanism is available; never indiscriminately retry authentication, invalid requests, or rate limits. Open-Meteo: no retry or one short safe retry only for transient transport failures, because the data is optional and parallel calls already increase request count. TomTom search may tolerate one bounded transport retry; do not automatically retry route computation-limit, no-route, 4xx, or rate-limit responses.
4. **Make cancellation and stale-result handling explicit.** Add `AbortController` support to the browser API helper, abort on component unmount/navigation, treat abort as a non-error, and associate each operation with a generation/request token before applying state. Ensure backend/provider work cannot outlive a disconnected request unnecessarily where the serving stack supports cancellation.
5. **Cache weather deliberately.** Add a short TTL cache keyed by rounded coordinates, forecast hour, and relevant forecast parameters, with bounded size and safe invalidation. Continue preserving the last known advisory and never apply a buffer from stale or malformed data without an explicit freshness policy.
6. **Review OpenRouter format fallback.** Prefer a capability decision/cache per model or a single compatible request where possible. If fallback remains, make the multiple-request behavior observable and document its billing/duplication implications.
7. **Keep current user-facing mappings.** Preserve 503 for temporary AI unavailability, 504 for route timeout/compute limit, 422 for no route/invalid input, 502 for provider failures, and 429 with `Retry-After` for rate limits. Consider a more specific AI timeout message internally or via a safe error code without exposing provider details.

## Untested or unresolved

- Exact elapsed time and phase of the live OpenRouter timeout were not preserved in the prior evidence; only `httpx.ReadTimeout` and absence of an upstream status are known.
- Provider-side OpenRouter quota, model capacity, regional routing, and account limits were not independently verified.
- No live Open-Meteo timeout, live TomTom routing timeout, live TomTom rate limit, or live malformed provider payload was induced.
- Actual server behavior after browser navigation/disconnect requires an instrumented ASGI/server test or production-safe request correlation; source inspection alone cannot prove whether the server cancels work.
- Connection-pool exhaustion under concurrent users was not load tested. The code has bounded local concurrency for weather and route-refresh guards, but no end-to-end load evidence exists.

## Conclusion

The only externally reproduced current outage is OpenRouter extraction timing out and being correctly surfaced as a safe 503. Open-Meteo and TomTom have defensive failure mappings and substantial automated coverage, but their live intermittent behavior remains unconfirmed. The highest-value next changes are explicit phase timeouts, cancellation/stale-result protection, sanitized correlation logging, and narrowly scoped provider-specific retry/cache policies. No application code was changed in this investigation.
