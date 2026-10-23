# SmartMeet live API smoke test

Date: 2026-10-23 (Asia/Manila)

This was a bounded, authenticated browser smoke test after the reliability improvements. It was not a load test, an uptime test, or a recovery test under sustained failure. No application code was changed and no credentials, API keys, authorization headers, prompts, or sensitive location data were recorded.

## Session and health

- Manual Clerk sign-in was completed in the controlled browser. `/dashboard` loaded and the authenticated schedule page loaded successfully.
- `GET http://localhost:8000/health`: 1 attempt, HTTP 200, approximately 4 ms, body `{"status":"ok"}`.
- The response did not include an `x-request-id` header in the running development process. This is an observation about the current server process, not evidence that the health endpoint failed; the server may have been running an older process than the reliability changes.

## Provider results

| Integration | Attempts | Successful usable responses | Sample success rate | Timing evidence | Result |
|---|---:|---:|---:|---|---|
| OpenRouter extraction | 1 | 1 | 100% | 13,176 ms; sample average 13,176 ms | HTTP 200; draft extraction populated the editable form. No fallback or duplicate extraction call was observed. |
| Open-Meteo weather | 4 provider requests in two paired operations | 4 | 100% | Refresh operation 2,098 ms; save-time pair completed as part of the successful save | Weather advisory data was available for both selected endpoints. |
| TomTom location search | 4 | 4 | 100% | Explicit searches: 1,290 ms and 1,296 ms; average 1,293 ms. Two searches were side effects of the extraction flow and were not timed independently. | HTTP 200 result lists were returned and validated place selections were available. |
| TomTom routing | 2 | 1 usable route response | 50% usable-route rate | The no-route response settled during the observed wait; exact provider elapsed time was not captured. The later valid route response arrived within a 7-second observation window. | One HTTP 422 no-route result was mapped to a clear user message; a separate local route returned six route options. |

### OpenRouter

Input was a disposable, non-sensitive natural-language schedule request. The single request to `/schedules/extract` returned HTTP 200 in 13.176 seconds. The UI displayed “Draft ready for your review”, kept the text in the editable description, and populated the target time, intent, origin, and destination. No automatic retry and no structured-output fallback call were observed.

This run did not reproduce a failed AI extraction. The earlier browser evidence recorded a 503 extraction failure while preserving the input; see [real-browser-test-results.md](./real-browser-test-results.md). That earlier evidence is not counted as a success in this smoke-test sample.

### Open-Meteo

The successful schedule save issued a paired weather assessment for the selected origin and destination, accounting for two Open-Meteo requests. A later “Refresh weather advisory” operation issued the second pair and returned HTTP 200 in 2.098 seconds with the UI status “Weather advisory refreshed.” The UI showed endpoint forecasts and kept the schedule usable.

No live weather outage was induced. Consequently, this test confirms successful advisory behavior and separation from route calculations, but does not independently prove the failure branch for an unavailable weather provider.

### TomTom location search and routing

The extraction flow triggered two location searches. Both returned usable candidate lists. Two additional explicit searches for “Makati City” returned HTTP 200 in approximately 1.290 and 1.296 seconds and produced validated selectable results.

The first route selection deliberately used two selected places in different countries. TomTom returned HTTP 422 and the UI displayed: “TomTom could not find a drivable route between these locations. Check the selected places and try again.” This is a correctly handled no-route/domain result, not evidence of a provider outage or timeout. No retry was clicked.

The user chose “Save without route estimate.” The schedule was saved successfully without a route estimate, while the weather advisory remained available. Departure remained unavailable because travel duration was unknown, and wake-up remained unavailable because preparation duration was unknown. This verifies that a failed route calculation does not invalidate schedule persistence or the advisory data.

A later independent route selection using two local Makati places returned six route options, including a selected 16-minute, 3.5 km route. This demonstrates a successful independent routing request, but it is not recovery of the original no-route request because the endpoints were different.

## Failure handling and safety observations

- No provider timeout, connection error, rate-limit response, or upstream 5xx occurred during this live sample.
- No failed provider request was automatically retried.
- The no-route HTTP 422 was translated into a specific, actionable UI message.
- Optional route failure did not prevent saving the schedule or displaying weather data.
- The created disposable schedule was cancelled after testing. The existing exploratory cancelled schedule was not changed.
- Screenshot evidence: [routing success](./live-api-smoke-routing-success.png) and [weather advisory after cleanup](./live-api-smoke-weather-advisory-after-cleanup.png). The latter is a post-test capture of the still-visible advisory/details state after the disposable schedule was cancelled; it is not presented as a screenshot of the earlier active-save moment.
- Saved-route preservation after a failed refresh was not tested because the saved disposable schedule had no route estimate. No failure was deliberately induced against an existing saved route.
- The browser showed Clerk development/structural-CSS/preload warnings. These are configuration or development warnings, not provider failures. A prior telemetry request also showed `ERR_ABORTED`; it was not associated with a failed provider operation.
- The browser console recorded the expected route HTTP 422 for the no-drivable-route case. No unexpected provider 5xx was recorded.

## Limits and remaining unknowns

This was a small smoke test: one paid AI extraction, four weather requests, four location searches, and two routing attempts. It does not establish long-term provider reliability, behavior under concurrency, connection-pool exhaustion, or behavior during real upstream timeouts, rate limits, authentication failures, or network partitions. The OpenRouter fallback path was not triggered. Live failed-weather behavior, failed-AI manual-entry behavior, and preservation of an existing saved route during a failed refresh remain covered by automated tests and/or prior evidence rather than this live run.

No additional live provider calls should be inferred from this report, and the results should not be used as a reliability guarantee.
