## Current Progress

### Spec 13 traffic display consistency and stale warning diagnosis

- The routing adapter uses `routes[0].summary.travelTimeInSeconds` for the route duration and `summary.trafficDelayInSeconds` for route-level traffic delay. It reads `sections[].delayInSeconds` only from `TRAFFIC` sections as per-incident delays and never sums them into the route delay. TomTom's current Routing API documentation describes these as distinct fields: route delay is compared with free-flow conditions, while a traffic section's delay is caused by its incident.
- The old UI rounded every section upward to whole minutes independently. If exact section delays are 299, 600, and 61 seconds, their exact sum is 960 seconds (16 minutes), while the old labels showed 5 + 10 + 2 = 17 minutes. Section values also have distinct provider semantics and are not a breakdown guaranteed to total route delay. The UI now renders exact minutes/seconds, labels the route-level delay explicitly, and explains that incident delays are separate.
- The late warning compares timezone-aware `retrieved_at` and intended departure instants after UTC normalization. It has no minute rounding or tolerance. A later retrieval within the same displayed minute is legitimately later; the warning now shows retrieval and intended-departure timestamps with seconds for clarity.
- Added a mocked routing regression for independent summary/section fields and the per-section rounding example, frontend exact-delay formatting assertions, and route-warning cases for a later instant in the same displayed minute, an earlier instant across timezone offsets, and a genuinely later instant.
- Verification: backend pytest **199 passed**; frontend tests passed (**19 traffic assertions** plus suggested-time tests); lint, TypeScript checks, production build, and `git diff --check` passed. No migration was required. Live TomTom and browser verification remain manual.

### Spec 14 weather failure diagnostics

- Added internal structured failure reasons for unsupported forecast times, missing requested hourly data, invalid response values, provider timeouts, and provider request failures. Schedule orchestration logs a fixed warning event with assessment pass and requested UTC endpoint hours; a failed second pass is logged as `second_pass_failure` while retaining its original cause reason.
- Diagnostic context is an in-memory Pydantic private attribute. It is excluded from API serialization and persistence. Logs omit location names, coordinates, secrets, and raw exception text. Fallback calculations, user-facing messages, weather thresholds, and the two-pass limit are unchanged; no migration was needed.
- Tests cover reason classification, diagnostic non-exposure, and preservation of the original second-pass cause through base-calculation fallback.
- Verification: backend pytest **195 passed**; frontend tests passed; lint, TypeScript checks, production build, and `git diff --check` passed. No live Open-Meteo or browser verification was performed.

### Spec 14 forecast-unavailable diagnosis

- The frontend displays `Forecast unavailable` only when the API's persisted `weather_estimate.status` is `unavailable`; runtime response validation accepts both statuses and does not reinterpret an available estimate. The local Next.js log contains startup/browser messages only. No backend request log or schedule-specific provider payload is available, so a particular user's exact forecast request cannot be reconstructed.
- `OpenMeteoWeatherService.assess` returns unavailable if either endpoint time is outside its supported window, if Open-Meteo's `hourly.time` does not contain the requested UTC hour, or if response fields are invalid/missing. On a positive first pass, `_refresh_weather` makes one second assessment; if that is unavailable, it intentionally discards the first-pass buffer and uses base schedule calculations. The API serializes that status unchanged, and the UI renders it as unavailable. This is the documented safe fallback, not evidence by itself that Open-Meteo is down.
- Added regression coverage for a valid provider response missing the exact requested UTC hour and strengthened the schedule test asserting a missing-hour second pass falls back to base times, persists unavailable status, and applies no weather buffer. No calculation or provider behavior changed.
- Verification: backend pytest **194 passed**; frontend tests passed; `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. No live Open-Meteo request or browser verification was performed. No migration was added.

Spec 14 — Weather-Aware Buffers is implemented and automated verification passes. No live Open-Meteo call or browser workflow has been performed.

### Spec 14 implementation

- Added a replaceable Open-Meteo adapter that samples the selected origin at calculated departure and destination at calculated arrival. Each assessment fetches the two endpoints concurrently with 4-second timeouts. Schedule orchestration uses a bounded maximum of two assessments: base times first, then interim weather-adjusted times only when pass one has a positive buffer. Hourly values are validated; missing, unsupported, malformed, timed-out, and provider-error results return unavailable weather.
- Rules use the strongest qualifying endpoint condition once: rain >=2.5 and <7.5 mm/hour: 5 minutes; heavy rain >=7.5: 10; snowfall >=1 cm/hour: 15; wind >=50 km/h: 10; WMO thunderstorm code 95/96/99: 20. Threshold rationale and timing behavior are in DEC-021. Base travel duration and base buffer remain separate.
- Arrival intent keeps target arrival fixed and forecasts origin at the base departure, then the interim adjusted departure if needed. Departure intent preserves its target departure and forecasts destination at base estimated arrival, then interim weather-adjusted arrival if needed. The maximum buffer from successful passes is applied once. A failed second pass falls back to base calculations; a stronger second-pass result is used with a note that final times may differ from the latest forecast sample. Unknown travel duration is not replaced. Weather is fetched on create and relevant edits/route refreshes, persisted in nullable JSON, and not fetched on reads.
- Schedule details show summary, applied minutes/unavailable status, origin and destination forecast hours, retrieval time, and the bounded-approximation note when applicable. UI labels forecasts as estimates.
- Weather presentation maps documented Open-Meteo WMO codes to readable conditions independently for origin and destination, shows hourly precipitation/snowfall/wind values, and labels both as forecasts rather than observations. Zero-buffer available forecasts use the requested no-extra-time message; unavailable data remains a separate state. Positive adjustments name their triggering weather conditions. The endpoint condition/value summaries remain inside the existing weather JSON; no migration was needed.
- Verification after forecast presentation update: backend pytest **193 passed**, frontend tests passed, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `alembic check` (no new operations), and `git diff --check` passed. No live Open-Meteo or browser verification was performed.
- Migration `20261014_0008_schedule_weather_estimate` stores assessments in the existing schedule weather JSON. At this verification, the configured database reports revision `20261014_0008` (head); no additional migration was needed for the new endpoint timestamps or timing note.
- Changed files for bounded timing correction: `backend/routers/schedules.py`, `backend/schemas.py`, `backend/weather_service.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `app/schedules/schedule-workspace.tsx`, `context/feature-specs/14-weather-aware-buffers.md`, `context/decisions.md`, and this tracker. No database model or migration change was needed; endpoint timestamps and timing note use the existing weather JSON column.
- Verification: backend pytest **164 passed**; frontend tests passed (15 traffic assertions plus Suggested Times cases); `npm run lint`, `npx tsc --noEmit`, `npm run build`, `alembic check` (no new operations), and `git diff --check` passed. `alembic current` reports `20261014_0008` (head).
- Manual verification still needed: verify live Open-Meteo response behavior with selected locations, and inspect forecast/buffer/unavailable rendering in a browser. No live provider or browser verification is claimed.

## Completed Spec 10 — Historical tracker record

Spec 10 intent-specific suggested-time display was implemented and verified as recorded below.

### Spec 10 intent-specific Suggested Times display

- `leave_at` now shows “Departure time” from the saved target instant, “Estimated arrival” from the backend-calculated arrival, and “Wake-up / preparation start.” It no longer presents the target departure as a suggestion. Unknown travel and preparation durations each have a clear unavailable explanation.
- `arrive_by` retains “Suggested departure” and “Wake-up / preparation start.” When travel is unknown but wake-up is calculable, the existing clarification explains it is measured back from the target arrival; unavailable departure and wake-up values state their missing duration.
- Added a small display-only helper and automated frontend cases for both intents and missing travel/preparation durations. No time arithmetic or API/backend behavior changed; timezone formatting still uses the existing schedule timezone and backend UTC instants. The travel and traffic section is unchanged.
- Changed files: `app/schedules/schedule-workspace.tsx`, `lib/suggested-times.js`, `lib/suggested-times.test.js`, `package.json`, Spec 10, and this tracker.
- Verification: frontend tests passed (15 existing traffic assertions plus both-intent/missing-duration Suggested Times cases); relevant backend tests **32 passed**; lint, TypeScript, production build, and `git diff --check` passed. The first lint run reported an unused import; it was removed and the clean lint rerun passed. Browser verification has not been performed.

### Spec 13 status

Spec 13 stale estimate handling and manual refresh rate limiting are implemented. Live routing, browser workflow, and applying pending MySQL migrations remain outstanding.

### Spec 13 stale estimate warnings and manual refresh limits

- Route estimates are marked stale when `retrieved_at` is over 15 minutes old. The detail view checks freshness every second, so the exact warning appears while the page stays open. The existing estimate stays visible.
- Added authenticated `POST /schedules/{id}/travel-estimate/refresh`. It uses the schedule's selected endpoints and target-time routing behavior. On success it stores the validated duration, traffic metadata, and retrieval timestamp, then recalculates with the deterministic calculation service. `arrive_by` recalculates departure/wake when possible; `leave_at` retains target departure and recalculates estimated arrival. On provider failure, rate limit, or concurrent schedule edits, the previously saved estimate is retained.
- Backend limits are durable and cross-worker: one attempt per schedule per 60 seconds and 10 attempts per authenticated user in a rolling 15-minute window. Attempts are reserved before provider calls and failed attempts count. A database user-lock row serializes rolling-window checks; same-schedule concurrent requests are blocked. HTTP 429 includes `Retry-After`. A 30-second in-progress lease handles abandoned requests. Frontend disables refresh while running/cooling down and shows a countdown; API responses update both detail and list state.
- Added Alembic revision `20261013_0007_route_refresh_limits` for refresh attempts and per-user locking. **Not applied** to the configured MySQL database. This migration must be applied before deploying the endpoint.
- Changed files: `backend/models.py`, `backend/route_refresh_limits.py`, `backend/routers/schedules.py`, `backend/alembic/env.py`, `backend/alembic/versions/20261013_0007_route_refresh_limits.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `lib/traffic-display.test.js`, `app/schedules/schedule-workspace.tsx`, Spec 13, decisions, and this tracker.
- Verification: backend pytest **140 passed**; frontend traffic/stale-time helper assertions **15 passed**; `npm run lint`, `npx tsc --noEmit`, `npm run build`, `alembic upgrade head --sql`, and `git diff --check` **passed**. Git reported only line-ending normalization notices. No live TomTom request or browser verification was performed.
- Remaining manual verification: apply revisions `20261013_0005` through `20261013_0007` with the normal MySQL migration workflow; verify refresh success/failure and visible countdown in a browser using a configured TomTom key. No future background refresh is scheduled.

### Spec 13 routing response and future-trip correction

- Verified the existing adapter already sent `traffic=true` and `computeTravelTimeFor=all`; it now continues to do so and reads the actual response `routes[0].summary` fields independently. TomTom's documented response defines `travelTimeInSeconds` as the estimate, `trafficDelayInSeconds` relative to real-time/free-flow conditions, and the no-traffic, historical, and live-incidents travel times as separate comparisons. The route duration is never adjusted by adding delay.
- Optional traffic fields accept finite nonnegative numeric seconds independently. Delay is shown only when the explicit delay value and a positive no-traffic comparison are both valid; no duration difference is invented as a substitute. Traffic classification is unavailable if either required value is absent/invalid. Historical/live values are described as comparison estimates returned, not as proof each changed the best estimate.
- Future `leave_at` schedules send the target instant as TomTom `departAt`; future `arrive_by` schedules send it as `arriveAt`. Past schedules omit both parameters and use the provider's current-time default. The arrival-conditioned request is one bounded provider call; deterministic calculation then derives departure from returned duration and configured app buffers, with no feedback reroute loop.
- The response records whether the request used current conditions, scheduled departure, or scheduled arrival. TomTom documents that future travel times can use historical patterns and that road closures/works may be considered up to 60 days when available; no future estimate is guaranteed. Live traffic was not verified with a real key.
- Tests now use TomTom's documented realistic response values (`travelTimeInSeconds=161`, `trafficDelayInSeconds=15`, `noTrafficTravelTimeInSeconds=120`, historical `157`, live `161`), plus explicit zero, positive, missing/invalid fields, both future intents, and provider failure coverage.
- Migration status: no migration required; route time basis persists in existing JSON estimate metadata. No actual database migration was applied.
- Changed files for this correction: `backend/routing_service.py`, `backend/routers/schedules.py`, `backend/schemas.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `lib/traffic-display.js`, `lib/traffic-display.test.js`, `app/schedules/schedule-workspace.tsx`, `context/feature-specs/13-routing-and-traffic.md`, `context/decisions.md`, and this tracker.
- Verification: backend pytest **135 passed**; frontend traffic display assertions **13 passed**; `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` **passed**. No live provider request or browser verification was performed.
- Migration status: no migration added; existing pending schedule migrations remain unapplied.
- Remaining manual verification: use a configured TomTom key to inspect a real traffic response, then verify future `departAt` and `arriveAt` schedules, comparison labels, and unavailable-data behavior in a browser. TomTom's future estimates remain estimates; live traffic was not verified.

### Spec 13 traffic conditions UI enhancement

- The backend requests TomTom traffic sections and parses `trafficDelayInSeconds`, `noTrafficTravelTimeInSeconds`, `historicTrafficTravelTimeInSeconds`, and `liveTrafficIncidentsTravelTimeInSeconds` as optional nonnegative integer seconds. Missing optional data retains a valid route duration.
- Application thresholds: little/no delay requires at most 2 minutes and at most 5% of the no-traffic baseline; significant delay is at least 10 minutes or 20%; other validated comparisons are some delay. Status is unavailable without reliable comparison data. These are application labels, not TomTom classifications.
- Live and historical components are distinguished by the provider fields present. Valid traffic sections show a delay and application severity only; no road or segment details are inferred from route-wide data.
- Schedule details show estimated route duration, available delay, status, data source, retrieval timestamp, late-estimate warning, and stale warning after 15 minutes. Staleness means time since retrieval; it does not assert underlying provider-data age or schedule refreshes.
- Changed files: `backend/routing_service.py`, `backend/schemas.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `lib/traffic-display.js`, `lib/traffic-display.test.js`, `app/schedules/schedule-workspace.tsx`, `package.json`, and this tracker.
- Verification: backend pytest **126 passed**; frontend traffic display assertions **10 passed**; lint, TypeScript, production build, and `git diff --check` **passed**. An initial run had two incorrect fixture expectations; corrected fixtures passed in the final run.
- Migration status: no migration added or required; traffic metadata uses the existing JSON `travel_estimate` column. Existing pending MySQL migrations remain unapplied.
- Remaining manual checks: confirm actual TomTom field/section availability with a configured live key and inspect status, stale/late warnings, and section rendering in a browser. No live routing or browser verification was performed.

### Spec 13 - Routing and Traffic

- Added a replaceable backend TomTom Routing API v1 adapter. It validates the route response, requests `traffic=true` plus `computeTravelTimeFor=all`, rounds the provider's seconds upward to whole travel minutes, and returns provider, retrieval time, and traffic-inclusion metadata.
- Existing `location` remains the explicitly selected destination; added a separately selected optional origin. The form requires explicit search-result selection for each. Routing is attempted only when both are present; failure or removal of either clears route-derived duration and leaves the schedule saved with Spec 10's unknown-travel calculation behavior.
- Schedule creation requests a route when both explicitly selected endpoints are present and duration is missing. Edits request routes for changed endpoints or a cleared known duration; unchanged travel duration is omitted from the edit payload so preparation-only changes recalculate without duplicate provider calls. Routing failures preserve the schedule and use unknown-duration rules. The saved target instant is unchanged.
- Added a derived warning when `retrieved_at` is later than intended departure, and deterministic estimated arrival for departure-intent schedules. Arrival schedules with unknown travel retain a prep-based wake suggestion; departure schedules retain target departure/wake independently of route availability. Unknown preparation does not remove departure/arrival. UI uses the saved API response.
- Added Alembic revision `20261013_0006` for nullable `calculated_arrival_time`; revisions `20261013_0005` and `0006` are rendered in static MySQL SQL but have not been applied.
- Added regression coverage for automatic route on create, route retry when duration is cleared, route failure on create/edit, late retrieval with target preservation, endpoint changes, no extra route on prep edits, both intents, unknown travel/preparation, and estimated arrival/wake calculations.
- Verification: backend pytest **121 passed**; frontend helper tests **3 passed**; `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and `alembic upgrade head --sql` **passed**. No live provider or browser verification was performed.
- Changed files: `backend/time_calculation.py`, `backend/models.py`, `backend/schemas.py`, `backend/routing_service.py`, `backend/routers/schedules.py`, `backend/alembic/versions/20261013_0005_schedule_origin_routing.py`, `backend/alembic/versions/20261013_0006_schedule_arrival_calculation.py`, `backend/tests/test_time_calculation.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `app/schedules/schedule-workspace.tsx`, `context/feature-specs/10-deterministic-time-calcualtions.md`, `context/feature-specs/13-routing-and-traffic.md`, `context/architecture-context.md`, `context/decisions.md`, and this tracker.
- Remaining manual verification: apply revisions `20261013_0005` and `20261013_0006` through the configured MySQL workflow; configure a real TomTom key and verify live route retrieval timestamps; in a browser, verify late warnings, target-time preservation, clear-duration edit/retry, prep-only edits, and saved response refresh.

### Completed Spec 12 - Location and Geocoding (verification pending)

- Implemented authenticated `POST /locations/search` backed by replaceable TomTom Search API Fuzzy Search with `typeahead=true`. Search responses and schedule selections use validated Pydantic schemas; invalid-coordinate provider entries are omitted, empty searches return no results, missing key configuration returns 503, and provider/time-out failures return a safe 502 message.
- Added explicit location candidate selection to the schedule form. A candidate is only persisted after the user selects it; the selected result is shown in schedule details and loaded into edit mode. Search is optional and does not become an autosave prerequisite.
- Added a nullable SQLAlchemy JSON location value and Alembic revision `20261013_0004`; prior schedules remain null. Migration SQL generation and Alembic head inspection passed. The migration was not applied to a database.
- Switched the provider from Open-Meteo to TomTom without changing the API response or persisted selection shape. `TOMTOM_API_KEY` is loaded from the backend `.env`; no key is present in frontend variables or code. No database schema change was needed for this provider switch; existing Spec 12 migration `20261013_0004` still applies to location persistence.
- Added mocked TomTom response coverage for POI/address mapping, typeahead/key parameters, invalid coordinates, timeout failures, and empty input; existing endpoint tests cover auth, candidate ambiguity, no results, provider errors, and persistence.
- Provider-change files: `backend/location_service.py`, `backend/routers/locations.py`, `backend/tests/test_locations.py`, `backend/.env.example`, local `backend/.env` (placeholder added only if the variable was absent), `context/feature-specs/12-location-and-geocoding.md`, `context/decisions.md`, and this tracker.
- Verification after provider switch: backend pytest **105 passed**; frontend unit tests **6 passed**; `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` **passed**. `alembic heads` and `alembic upgrade head --sql` **passed**; `alembic check` reported **No new upgrade operations detected**; `alembic current` reports configured MySQL at `20261013_0004 (head)`. No migration was applied in this turn. No schema migration is needed for the provider switch.
- Remaining manual verification: replace the local `backend/.env` `TOMTOM_API_KEY` placeholder with a real developer key; verify live TomTom search and browser selection, schedule save/edit/refresh, and existing flows. Automated tests use mocked TomTom responses and do not establish provider account access or browser behavior.

### Spec 11 implementation record (verification pending)

The assistant flow automatically creates schedules after extraction or clarification produces a valid form, and retries carry a per-user idempotency key. Live browser, configured-provider, and configured MySQL migration verification remain outstanding.

### Spec 11 implementation record (verification pending)

- Already present: authenticated extraction, structured missing/ambiguous/invalid results, retained known values in editable fields, focused clarification text, authenticated schedule CRUD/cancel, user ownership checks, DST/timezone validation, unknown-duration handling, and Spec 10 calculations on create/update/read.
- Changed: assistant-created schedules auto-submit once required values are valid; incomplete extraction remains unsaved; failures retain the form for retry. Assistant retry requests reuse an idempotency key. Backend create returns the existing user's schedule when the same key is repeated.
- Added migration `20261012_0003` for nullable `schedules.idempotency_key` and unique `(clerk_user_id, idempotency_key)`; existing schedule records are preserved.
- Added backend regression coverage for repeat submission and frontend autosave eligibility coverage.
- Verification: backend pytest **95 passed**; frontend helper tests **6 passed**; `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and `alembic heads` **passed**. Alembic head is `20261012_0003`; migration application was not performed. No live provider or browser end-to-end workflow was verified.
- Product decision recorded as DEC-015: Spec 11 supersedes Spec 09's explicit-save step for the assistant workflow; manual schedule entry/edit retain explicit submission.

## Completed Spec 10 - Deterministic Time Calculations

### Spec 10 timezone response regression fix

Root cause: the calculation service returned schedule-local aware datetimes, then SQLAlchemy refreshed MySQL `DATETIME` columns that do not preserve timezone metadata. On create/update responses, the schema interpreted the refreshed local wall time as UTC, and the frontend formatted that instant in the schedule timezone again. For Manila this produced an eight-hour late display. The service now keeps calculation results as UTC-aware instants through persistence and API serialization; the existing frontend formats those UTC instants once using the schedule IANA timezone. Naive values read back from the database continue to be interpreted as UTC, matching the established target-datetime storage contract. No manual offset or timezone-specific calculation was added.

Regression coverage now verifies the October 12, 2026 8:00 AM Asia/Manila arrival example with 90-minute travel and 60-minute preparation durations: API UTC instants correspond to 6:30 AM and 5:30 AM local. Unit coverage also checks departure intent in Manila and Tokyo, crossing local midnight, and the existing DST transition arithmetic. API tests explicitly zero environment buffers so local `.env` settings do not affect expected values.

Verification for the regression fix:

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 94 tests**.
- Frontend helper tests: **passed, 3 tests total** (2 schedule extraction time tests and 1 clarification test).
- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `git diff --check`: **passed** (only expected LF-to-CRLF notices).
- The UI formatting path was traced to `formatDate`, which applies the schedule timezone to API UTC instants. Browser behavior remains unverified; retest the same saved schedule in the browser.

Implemented deterministic backend departure and wake-up/preparation-start calculations. Arrival intent subtracts a known travel duration and configured travel buffer; departure intent preserves the requested departure instant. Both intents subtract a known preparation duration and configured preparation buffer for the wake time. Buffers are nonnegative backend environment settings (`TRAVEL_BUFFER_MINUTES`, `PREPARATION_BUFFER_MINUTES`) defaulting to zero. Unknown durations remain null, with an API reason explaining why a result is unavailable. Calculation results are recalculated on create and relevant updates, and refreshed for reads; they use aware instants and serialize as UTC for the existing frontend to render in the schedule timezone. The existing calculated columns are reused; no migration was needed.

### Changed files

- `backend/time_calculation.py` - validated buffer settings, deterministic calculation service, and schedule recalculation.
- `backend/routers/schedules.py`, `backend/schemas.py` - calculate on create/update/read and return unavailable reasons.
- `backend/.env.example` - documents zero-default buffer settings.
- `backend/tests/test_time_calculation.py`, `backend/tests/test_schedule_api.py` - calculation, timezone, unknown/zero duration, buffers, recalculation, serialization, and ownership coverage.
- `lib/schedule-api.ts`, `app/schedules/schedule-workspace.tsx` - validate and display calculated suggestions and unavailable reasons in local timezone.
- `context/decisions.md`, `context/architecture-context.md`, and this tracker - record confirmed buffer and calculation behavior.

### Verification

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 92 tests**.
- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `git diff --check`: **passed** (Git reported expected LF-to-CRLF normalization notices).
- No database migration was required. Database migration application and interactive browser rendering were not performed; the schedule display is covered by lint, TypeScript, build, and API payload tests.

## Completed Spec 09 - Step 4: API and frontend integration

**Spec 09 Step 4 - API and frontend integration** is implemented. Authenticated `POST /schedules/extract` reuses Clerk verification, generates its reference instant on the server, and accepts only a validated optional IANA timezone context. The workspace can request a draft, inspect extraction or clarification results, edit known values, answer partial date/time questions, and explicitly save through the existing schedule API. Manual create/edit remains available. Extraction and save submissions are guarded against duplicates; request failures preserve the natural-language input. AI settings are loaded from the backend `.env` at client construction using a path anchored to the provider module. Follow-up fixes add a title fallback, apply the selected timezone when the model omits one, require explicit confirmation for conflicting timezone output, and normalize a model time offset once against selected/model IANA zones before the existing resolver. The frontend now accepts only the normalized local-time wire value.

### Changed files

- `backend/routers/extraction.py` - authenticated extraction endpoint, server reference time, safe configuration/provider errors.
- `backend/ai_provider.py` - loads backend AI configuration at client construction from an explicit path.
- `backend/extraction_schemas.py` and `backend/extraction_service.py` - accept offset-bearing model times only long enough to verify the offset against selected/model IANA timezone context, then normalize once; conflicting zones/offsets require clarification. Missing titles receive `Go to <destination>` when a destination is recognized, otherwise `New schedule`.
- `backend/main.py` - registers the extraction route before schedule ID routes.
- `backend/tests/test_schedule_api.py` - extraction endpoint auth, ready/clarification response, validation, and error tests.
- `backend/tests/test_ai_provider.py` - regression coverage for backend `.env` loading when process working directory differs.
- `backend/tests/test_extraction_service.py` - title/timezone defaults, matching `Asia/Manila` offset normalization, explicit timezone conflict, mismatched offset, and preservation of other fields.
- `lib/schedule-api.ts` - extraction request/response types and runtime response validation.
- `app/schedules/schedule-workspace.tsx` - natural-language input, result/clarification display, editable candidate fields, explicit confirmation for timezone conflicts, retry, and confirmed save.
- `lib/clarification-messages.ts` and `lib/clarification-messages.test.ts` - map internal clarification identifiers to user-facing messages, sanitize model ambiguity identifiers, and deduplicate equivalent questions. Regression covers “I need to go to school tomorrow.”
- `lib/schedule-extraction-time.ts` and `lib/schedule-extraction-time.test.ts` - accept normalized local wall times and refuse to strip a provider offset a second time. Frontend unit tests exercise these helpers, not the React workspace.
- `context/progress-tracker.md` - this Step 4 result.

### Verification

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 83 tests**.
- `node --experimental-strip-types lib/schedule-extraction-time.test.ts`: **passed, 2 tests**.
- `node --experimental-strip-types lib/clarification-messages.test.ts`: **passed, 1 test**, including the manual-test regression; frontend helper tests now total 3.
- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed** (Next.js production build).
- `git diff --check`: **passed** (Git emitted LF-to-CRLF normalization notices only).
- Automated checks passed as recorded above. Live OpenRouter extraction with the configured model and interactive browser end-to-end verification remain pending. A provider response captured during earlier diagnosis was used as a fixture, not as end-to-end verification. No database changes, migrations, or schedule calculations were performed.
- Manual-test correction: raw `time_intent` appeared because model-provided `extraction.ambiguities` strings were appended directly after the structured missing/ambiguous/invalid field lists had been mapped. The formatter now maps known identifiers to display questions and deduplicates repeated requests. Extracted candidate values and explicit save behavior are unchanged.

### Remaining Step 4 verification

- Verify a live extraction using the configured OpenRouter model, then manually verify the extraction and correction flow in a browser, including provider retry, timezone-conflict confirmation, and date/time clarification.

## Completed Spec 09 - Step 3: Date/time resolution and clarification readiness

**Spec 09 Step 3 - Date/time resolution and clarification readiness** is implemented with mocked coverage. Relative dates are requested using the explicit reference instant and local date/time in the trusted IANA timezone when supplied. Candidate local date/time values are resolved to UTC using shared backend timezone validation and round-trip checks that reject DST gaps and flag repeated times. The service returns a structured ready-for-review or needs-clarification result, with separate missing, ambiguous, and invalid field lists. Provider output schema failures are surfaced as invalid fields; provider availability failures remain safe service errors.

### Changed files

- `backend/timezone_utils.py` - shared IANA timezone validation and DST-aware local datetime resolver.
- `backend/schemas.py` - reuses the shared IANA timezone validator.
- `backend/extraction_schemas.py` - structured review status/result.
- `backend/extraction_service.py` - temporal resolution and clarification classification.
- `backend/ai_provider.py` - identifies schema-invalid output separately from provider failures.
- `backend/tests/test_extraction_service.py` - relative dates, missing timezone, invalid dates, DST gaps/folds, and clarification cases.
- `context/progress-tracker.md` - this Step 3 result.

### Verification

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 72 tests** at Step 3 completion.
- `git diff --check`: **passed** at Step 3 completion (Git emitted expected LF-to-CRLF normalization notices).
- No live AI provider call, frontend change, public API endpoint, database migration, or schedule calculation was performed.

### Remaining Step 3 limitations

- Relative language is interpreted by the model using the supplied trusted date/time context; tests mock the model and verify that context is provided, not live model interpretation quality.
- The review result is not persistence eligibility. The later schedule workflow must still apply its final validation and user-review behavior.

## Completed Spec 09 - Step 2: Schedule extraction schema and service

**Spec 09 Step 2 - Schedule extraction schema and service** is implemented with mocked tests. `ScheduleExtraction` validates candidate title, intent, local date/time, optional IANA timezone, optional nonnegative durations, request classification, and ambiguity metadata. Missing required schedule fields are computed from validated candidates. Relative dates receive an explicit aware reference instant and optional user timezone. The service uses the Step 1 OpenRouter client and returns validated candidates only; it does not persist schedules, calculate estimates, or expose an API route.

### Changed files

- `backend/ai_provider.py` - server-side settings and isolated, timeout-aware OpenRouter client.
- `backend/tests/test_ai_provider.py` - mocked HTTP and configuration coverage, including structured-output fallback and malformed output.
- `backend/extraction_schemas.py` - strict Pydantic extraction contract, timezone/date/time/duration validation, ambiguity handling, and computed missing fields.
- `backend/extraction_service.py` - prompt construction with trusted temporal context and provider orchestration.
- `backend/tests/test_extraction_service.py` - mocked valid, incomplete, invalid, and provider-failure cases.
- `backend/.env.example` - OpenRouter environment setting names and safe placeholders.
- `context/decisions.md` - confirmed OpenRouter gateway and configurable model decision.
- `context/progress-tracker.md` - this implementation and verification record.

### Verification

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 68 tests**, including mocked extraction success, both intents, missing/ambiguous information, valid and unknown durations, invalid candidates, provider failures, and the existing backend suite at Step 2 completion.
- `git diff --check`: **passed** at Step 2 completion (Git emitted expected LF-to-CRLF normalization notices).
- No live provider call, dependency install, public route, frontend change, or database access/schema change was performed.

### Remaining Step 2 limitations

- No live model behavior was verified. Extraction quality, ambiguous-intent reporting, and model-specific structured-output compatibility still require later integration verification.
- Local dates and times are extraction candidates. Combining them with timezone rules, rejecting DST gaps/repeated times, and deciding schedule eligibility remain downstream validation responsibilities.
- `context/feature-specs/09-ai-schedule-extraction.md` was completed after Step 2; this Step 2 tracker entry records the implementation state at that time.

## Completed Spec 08 - Schedule Intent and Validation

**Spec 08 - Schedule Intent and Validation** is implemented and automated checks pass. Schedule intent remains explicitly represented by the existing `arrival`/`departure` enum, while the form now requires an explicit selection. Required fields are title (existing product field), intent, target local date/time, and IANA timezone. Preparation and travel durations are optional; null means unknown and is never replaced with zero.

### Scope and implementation

- The create/update/response contracts, SQLAlchemy model, frontend API types, and form consistently allow a missing preparation duration and unknown travel duration. Existing records retain their current preparation values.
- Added Alembic revision `20261010_0002` to make preparation duration nullable safely. It preserves existing rows and retains a nonnegative check when a value is supplied. The migration was rendered as MySQL SQL but has not been applied to a database.
- The schedule editor no longer defaults intent to arrival or inserts a preparation duration. It labels the choices “Arrive by” and “Leave at,” validates required fields before submitting, and shows null durations as “Not provided”/“Unknown.” The API response is the source of saved/success state; failures preserve the form.
- Local `datetime-local` values are converted using the chosen IANA timezone. Invalid/nonexistent local times and repeated daylight-saving times are rejected instead of silently resolved. Offset-aware instants continue to round-trip as UTC with the selected timezone used for local display. Past times remain allowed.
- No AI extraction, calculation engine, routing, weather, notifications, auth changes, or unrelated refactoring were added.

### Changed files

- `app/schedules/schedule-workspace.tsx` - explicit intent, optional duration inputs, and strict local-time/DST validation.
- `lib/schedule-api.ts` - nullable preparation duration in client types and runtime response validation.
- `backend/models.py`, `backend/schemas.py` - nullable preparation duration contract and persistence semantics.
- `backend/alembic/versions/20261010_0002_optional_preparation_duration.py` - safe nullable-column migration.
- `backend/tests/test_schedules.py`, `backend/tests/test_schedule_api.py` - required-field, both-intent, optional-duration, and persistence coverage.
- `context/progress-tracker.md` - this Spec 08 record and Spec 07 completion history.

### Verification results

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 42 tests**.
- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**.
- `alembic upgrade head --sql`: **passed**; generated MySQL SQL for both revisions including the nullable preparation-duration alteration. No live migration was applied.
- `git diff --check`: **passed** (Git reported expected LF-to-CRLF normalization notices).
- Browser workflow and actual database migration were not verified in this turn. Frontend date conversion is covered by code review/build but has no dedicated automated test harness in the repository.

### Remaining verification

Apply revision `20261010_0002` through the normal migration workflow before using null preparation durations against an existing database. Manually verify the schedule form in a browser, including DST gap and repeated-time cases.

## Completed Specs

### Spec 07 - Connect Schedule UI to API

Implemented and verified before Spec 08. The schedule workspace uses the authenticated API for list, detail, create, update, and cancel; successful UI state follows API confirmation. CORS uses a configured origin allowlist. It also established UTC normalization with IANA timezone display.

**Recorded verification at Spec 07 completion:** backend suite passed (37 tests), lint, TypeScript, production build, and `git diff --check` passed. MySQL create/read/update/cancel was exercised inside a transaction and rolled back; no browser workflow was verified. See the prior Spec 07 record in repository history for its full details.
## Completed Specs

### Spec 06 - Schedule API

Implemented and verified with authenticated `POST`/`GET /schedules`, `GET`/`PATCH /schedules/{id}`, and `POST /schedules/{id}/cancel`. All reads and mutations are scoped to the verified Clerk subject; the owner is never accepted from the client. Missing and other-user records share the same 404 response. Mutations commit, refresh, and safely roll back on SQLAlchemy persistence failures.

**Changed files:** `backend/main.py`, `backend/routers/schedules.py`, `backend/tests/test_schedule_api.py`, and this tracker.

**Recorded verification:** backend suite passed with 34 tests at Spec 06 completion. API tests used signed test JWTs and isolated in-memory SQLite. MySQL was not modified or exercised for that spec. CORS allowed only GET at the time; Spec 07 expands this allowlist for schedule writes.

### Spec 05 - Schedule Interface

Implemented with temporary mock data. Added the protected `/schedules` interface with list/detail, create/edit forms, cancel confirmation, responsive layouts, loading/empty/success/error states, and client-side field validation. Mock changes were explicitly described as temporary and did not persist. The interface was not connected to the API during Spec 05.

**Recorded verification:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Interactive browser flows were not verified; the initial fixture was populated, so the empty state was not manually checked.


### Spec 04 â€” Schedule Data Model

Implemented and verified. Added the SQLAlchemy schedule model, Pydantic create/update/response schemas, initial Alembic migration, dependencies, and migration documentation. The model includes Clerk ownership, time intent, timezone-aware target time, durations, optional calculated fields, status, timestamps, constraints, and indexes. It did not add CRUD routes, calculations, or frontend behavior. Backend suite passed (26 tests); Alembic applied to configured MySQL, current revision was `20261010_0001`, `alembic check` found no metadata differences, and inspection confirmed 14 columns, two indexes, and four checks. Other MySQL versions/configurations remain unverified.

### Spec 03 â€” Database Foundation

**Implemented and unit verified; live MySQL connectivity and migration were not part of its original verification.** Added `backend/database.py` with a lazy reused SQLAlchemy engine (`pool_pre_ping=True`), session factory, FastAPI `get_db` dependency, and safe `SELECT 1` connectivity check. It validates `DATABASE_URL` as a complete `mysql+pymysql` URL and returns credential-safe configuration errors. Added SQLAlchemy/PyMySQL, a placeholder in `backend/.env.example`, database tests, and initial setup notes in `README.md`.

**Recorded checks at completion:** backend tests passed (21 tests); SQLite was used for connectivity/session lifecycle tests, so MySQL was not verified then. Spec 04 subsequently verified connectivity and applied its migration on the configured MySQL database.

### Spec 01 â€” Local Foundation and Health Check

**Implemented and verified.** Kept the existing root Next.js TypeScript app and added the separate FastAPI backend, public `GET /health`, configured local CORS, frontend backend-status states, environment examples, Python ignore rules, and local setup/test instructions. Replaced the starter's build-time Google Fonts fetch with a system font fallback after the build could not reach Google Fonts.

**Recorded checks:** backend health/CORS tests passed; FastAPI and Next.js development servers started; live `/health` returned HTTP 200 with `{"status":"ok"}` and the expected local CORS header; frontend connected/unavailable states were manually checked; lint, TypeScript, and production build passed. Initial pytest cache permission and font-network issues were resolved before the recorded final checks.

### Spec 02 â€” Clerk Authentication

**Implementation and automated checks complete; live Clerk instance verification remains outstanding.** Added Clerk Next.js integration, sign-in/sign-up controls and pages, sign-out, protected `/dashboard`, and Bearer-token forwarding to FastAPI. Added reusable FastAPI Clerk token verification and protected `GET /auth/me`; it checks RS256 signature, expiry/issued-at, required claims, issuer, and allowed `azp`. CORS permits Authorization while retaining configured origins and GET-only methods. `/health` stays public.

**Recorded checks:** generated-key tests covered valid identity and invalid/missing credentials, bad signatures, expired tokens, wrong issuer, untrusted party, missing configuration, and public health. Backend tests passed (12 tests); lint, TypeScript, and production build passed. Clerk registration/sign-in could not be verified against a real configured instance because the workspace had no instance keys. The required frontend and backend environment variables and setup steps are listed below.

## Environment Notes for Completed Specs

- Spec 02 frontend `.env.local`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, server-only `CLERK_SECRET_KEY`, and existing `NEXT_PUBLIC_API_BASE_URL`.
- Spec 02 backend `backend/.env`: `CLERK_JWT_KEY` (PEM public verification key), `CLERK_ISSUER` (exact token issuer), and `FRONTEND_ORIGINS` (comma-separated allowed browser origins).
- Spec 03 backend `backend/.env`: `DATABASE_URL` as described in the current spec section.
- Use local development credentials only in ignored environment files. Never place real secrets in examples, frontend variables, logs, or this tracker.

## Product and Architecture Decisions

- Confirmed: Next.js frontend, Python/FastAPI backend, MySQL with SQLAlchemy, Clerk authentication, auto-save only after validation, arrival and departure intent, Web Push preference, and learning while building a usable MVP.
- Spec 02 forwards a Clerk session token as Bearer authorization and verifies it in FastAPI against configured issuer/key/origins.
- Spec 03 uses a lazily initialized synchronous SQLAlchemy engine and one yielded session per FastAPI request.
- Proposed: AI extracts intent; deterministic backend logic validates and calculates. External providers should be isolated behind adapters; reminder delivery should be idempotent where practical.
- Undecided: deployment topology and production origins, CORS/CSRF configuration, durable reminder scheduler, Web Push library/key management, maps/weather providers, required schedule fields, default timezone and buffers, past-event handling, and recurring schedules.

## Open Verification Items

- Configure a Clerk instance and manually verify registration, sign-in, dashboard identity, and sign-out in a browser.
- Browser verification of frontend connected/unavailable states was previously recorded, but can be repeated when the development environment changes.

## Tracker Maintenance Rule

For each feature-spec change, keep this tracker synchronized with the spec's actual scope and results. The active section should describe only the current spec. When moving to another spec, move the prior spec out of the active section into **Completed Specs**, with its implementation summary, changed files, actual verification results, and outstanding verification clearly recorded. Do not claim external or manual checks that were not performed. Preserve product decisions and open verification items without duplicating a completed spec as the current goal.
