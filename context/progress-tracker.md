## Current Progress

### Next.js security patch upgrade (16.4.0 to 16.4.2)

- Updated the root npm dependencies `next` and `eslint-config-next` from 16.4.0 to the exact target 16.4.2 and refreshed `package-lock.json`.
- Added `experimental.agentUpgrade: "security"` to `next.config.ts`; target 16.4.2 includes this option in its runtime schema and TypeScript config types. Preserved the existing `agentFeedback` setting and unrelated configuration.
- Completed in a separate Git worktree on branch `upgrade/next-16.4.2-security`. Duplicate app/history checks found no equivalent work. The GitHub open-PR check was attempted but could not connect to GitHub.
- Verification: clean `npm ci` passed on retry after the sandbox blocked a package lifecycle process with `spawn EPERM`; `npm exec next -- --version` reported **16.4.2**; `npm run build`, `npm run lint`, `npm run test:frontend`, `npm ls next eslint-config-next @clerk/nextjs`, and `git diff --check` passed. npm reported five high-severity audit findings across the installed dependency tree; no audit remediation was attempted as part of this version-only upgrade.
- The GitHub provider lookup and PR recheck are unavailable in this environment, so no PR was published. Open PR status could not be confirmed.

### External provider reliability improvements

- Added request correlation middleware with safe `X-Request-ID` response propagation and sanitized provider diagnostics for OpenRouter, Open-Meteo, and TomTom. Logs include provider, operation, elapsed milliseconds, category, exception class, upstream status when available, and correlation ID; they do not include secrets, prompts, authorization headers, or location payloads.
- Replaced scalar provider timeouts with explicit connect/read/write/pool values while preserving existing read limits: OpenRouter 5/30/10/5 seconds, Open-Meteo 2/4/2/2, TomTom search/landmarks 2/5/2/2, route 3/35/5/5, and reverse geocode 1/2/1/2.
- Added `AbortSignal` support to the schedule API helper. Intentional aborts map to a typed cancellation error, workspace requests are aborted on unmount, and load, route, location, extraction, detail, and refresh results are guarded against stale updates. OpenRouter structured-output fallback remains limited to explicit format-capability 400/422 responses and is documented as potentially issuing up to three requests only when necessary.
- Added regression tests for explicit timeout phases, request correlation, cancellation, unrelated OpenRouter 400 behavior, and existing provider timeout/error/fallback paths. No database schema or live provider calls were made.
- Verification: full backend pytest **317 passed**, frontend tests passed, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Direct frontend TypeScript tests retain the existing Node module-type performance warnings. Load testing, live provider recovery, and server-side cancellation after client disconnect remain unverified.

### Backend status cancellation handling

- Fixed the confirmed status flicker in `app/backend-status.tsx`. Aborted/cancelled health requests now produce no status result, unmounted components cannot update state, and request-generation checks prevent stale health results from overwriting newer results.
- Added `lib/backend-status.ts` and `lib/backend-status.test.ts` covering successful health responses, genuine HTTP/body failures, DOM abort errors, and cancellation signaled through `AbortSignal`. Added the test to `npm run test:frontend`.
- Verification: `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Existing Node module-type performance warnings remain during direct TypeScript test execution. Exploratory evidence remains under `artifacts/exploratory-testing/`; no branding or unrelated feature changes were made.

### Playwright exploratory testing preparation

- Inspected the existing project structure, package scripts, frontend and backend environment examples, tests, and repository-local Clerk testing guidance. No Playwright package or browser test configuration existed.
- Added `@playwright/test`, the `test:e2e` npm script, and `playwright.config.ts` for Chromium with the Next.js development server, `data-testid` selectors, failure screenshots, retained failure traces, HTML reporting, and ignored output directories.
- Added `e2e/README.md` with safe test-account and disposable-data guidance. No authenticated setup or application functionality was changed.
- Verification completed: dependency installation succeeded, the package lock was updated, Chromium was installed locally, and `npx tsc --noEmit` passed. `npx playwright test --list` loaded the configuration but reported zero tests, as expected because no exploratory spec exists yet. No browser test was run because no safe Clerk test account was provided.
- Manual setup before authenticated browser testing: configure working development values in root `.env.local` and `backend/.env`, apply the required backend migrations, start FastAPI on port 8000, install Chromium, and use a dedicated Clerk development-instance account. Auth storage state should be generated later under ignored `e2e/.auth/`.

### Completed Spec 18 - Web Push Backend Delivery

- Implemented: authenticated subscription registration/removal and `POST /push/test`, encrypted subscription payload storage keyed by endpoint hash, VAPID delivery service, wake/departure notification payloads, and worker wiring through `WebPushDelivery`.
- Outcomes: provider success is the only delivery confirmation; 404/410 removes the expired endpoint, throttling/server/transport errors retry through the existing bounded lease flow, permanent rejections fail, and missing subscriptions fail without futile retries. Once any endpoint accepts, the reminder is confirmed to avoid retrying to that endpoint and causing likely duplicates.
- Security: VAPID private key and Fernet encryption key stay backend-only. API requests validate field bounds and HTTPS endpoints; endpoint hashes are used for lookup and secrets are not logged or returned. Subscription removal is scoped to the verified Clerk subject.
- Migration: revision `20261019_0012` adds encrypted subscription storage; configured MySQL reports current revision `20261019_0011`, so `0012` is pending. Targeted offline SQL generation for `0011 → 0012` passed; the migration was not applied.
- Environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and `PUSH_SUBSCRIPTION_ENCRYPTION_KEY` are required to operate delivery/storage.
- Verification: full backend pytest **306 passed**; focused push/worker tests **22 passed**; `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, targeted Alembic SQL generation for revision `0012`, and `git diff --check` passed. `python -m compileall` passed. Full-history `alembic upgrade head --sql` cannot render because pre-existing revision `20261016_0009` queries existing rows during offline execution; targeted `0011 → 0012` generation succeeds. No live migration was applied.
- Manual verification outstanding: apply the migration, configure real VAPID/encryption values, register a browser subscription after Spec 19's service worker exists, and confirm a real test notification. A provider 2xx confirms service acceptance, not display. Exactly-once delivery is not possible across a worker crash after provider acceptance and before DB confirmation. Partial multi-device delivery confirms on first acceptance; another device may miss that instance.

### Completed Spec 19 - Service Worker and Push Notification UI

- Implemented: added root-scoped `public/service-worker.js` push display and same-origin notification-click focus/navigation. Added Dashboard notification settings for unsupported, permission-denied, disabled, enabled, and error states; explicit permission request; browser subscription reuse/creation; authenticated API registration/removal; test notification; and partial disable failure messaging.
- Reused `scheduleApi` request/auth handling and the Spec 18 endpoints (`POST /push/subscriptions`, `DELETE /push/subscriptions`, `POST /push/test`). The UI sends only `PushSubscription.toJSON()` endpoint/key fields. No backend, reminder logic, or schema changes.
- Configuration: set frontend `NEXT_PUBLIC_VAPID_PUBLIC_KEY` equal to backend `VAPID_PUBLIC_KEY`; backend private VAPID, subject, and Fernet keys remain backend-only. Added placeholder to root `.env.example` and setup/manual verification steps to README.
- Changed files: `public/service-worker.js`, `app/dashboard/notification-settings.tsx`, `app/dashboard/page.tsx`, `lib/schedule-api.ts`, `lib/push-api.test.ts`, `package.json`, `.env.example`, `backend/.env.example`, `README.md`, `context/decisions.md`, and this tracker.
- Verification: backend pytest **306 passed** (run from `backend/`); `npm run test:frontend` passed (including 3 new push API contract tests); `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. One initial backend invocation from the repository root failed collection because backend modules are imported relative to `backend/`; the documented backend-directory invocation passed. Build/tests mock API behavior only and do not verify push service or browser display.
- Manual verification outstanding: apply pending Spec 18 migration, configure matching real VAPID keys, exercise permission grant/deny and subscription registration/removal in a supported browser, receive/click a real test push, and confirm worker reminder delivery. Automated API tests do not establish real push delivery or device display.

### Active Spec 21 - Edge Cases and Production Readiness

- Audit confirmed Specs 17–20 already cover schedule synchronization, UTC/timezone handling, DST gap/fold validation, leases, bounded retries, cancellation/stale checks, encrypted subscriptions, provider status classification, and multi-device partial acceptance. No rewrite or migration was warranted.
- Fixed two gaps: malformed stored subscription data previously aborted the user's entire send before valid devices were attempted; malformed rows are now isolated and skipped, with sanitized ID-only diagnostics. Browser encryption key material is validated at the API boundary.
- Worker delivery settings are now validated before the worker opens its processing loop: VAPID key pairing, contact subject URI, and Fernet key. Invalid configuration exits with a safe message before claiming reminders. The test-push endpoint distinguishes invalid provider configuration (503) from missing subscriptions (409).
- Added regressions for malformed subscriptions alongside a valid device, API key-shape rejection, safe configuration errors, and worker preflight before database startup. Existing timezone, overdue, lease, retry, ownership, and schedule consistency tests remain in place.
- Migration status: no schema changes; no migration modified or applied. The live database was not queried; the last recorded state remains revision `20261019_0011` with `20261019_0012` pending.
- Verification: backend pytest **314 passed** with one existing `.pytest_cache` `WinError 183` warning; `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Frontend test invocation emitted existing Node module-type performance warnings. Git reported line-ending normalization notices only.
- Remaining risks/manual checks: API database and Clerk configuration still report safe request-time errors rather than being globally preflighted at API startup; validate those values in deployment. Confirm live MySQL revision and apply `20261019_0012` if still pending. Exercise worker startup and recovery with deployment environment, actual push-service expired/revoked behavior, multi-device delivery, and supported browsers. Provider acceptance is not device display, partial multi-device acceptance can leave a device without the reminder, and delivery is not exactly-once. This verification does not establish production readiness.

### Completed Spec 20 - Reminder Reliability

- Inspection confirmed existing schedule create/edit/cancel reconciliation, UTC instants plus IANA timezone storage, uniqueness, MySQL `SKIP LOCKED` claims, expiring leases, bounded backoff, stale-schedule validation, encrypted multi-device subscriptions, and provider outcome mapping.
- Fixed a reliability gap: routine synchronization no longer resets a permanent `FAILED` reminder when its schedule/type/trigger identity is unchanged. A changed trigger remains a distinct pending reminder. Sent rows remain sent; cancelled rows can be reactivated when the same schedule trigger becomes current again.
- Documented overdue behavior: past instants are not newly queued on create/edit; reminders already queued are eligible for best-effort catch-up after worker downtime if the schedule is still active and the trigger remains current.
- Added regressions for permanent failure preservation, changed-trigger scheduling, the two distinct UTC instants represented by the repeated fall-back DST wall time, and multi-device partial acceptance.
- Migration status: no schema changes and no migration modified or applied. The configured MySQL database was not queried during this work; Spec 18's recorded database state had revision `20261019_0011` while `20261019_0012` remained pending.
- Verification: backend pytest **309 passed** with one existing pytest cache-path warning; `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Build completed successfully. Pytest's warning was `WinError 183` while writing the existing `.pytest_cache` nodeids file; it did not affect test execution.
- Manual verification outstanding: confirm the configured MySQL migration revision and apply pending `20261019_0012` if appropriate; run the worker against configured VAPID credentials and valid subscriptions; exercise subscription expiry and multi-device behavior against actual push services; verify browser permission, display, and click behavior. Provider acceptance does not establish device display, and exactly-once delivery is not guaranteed.

### Completed Spec 17 - Reminder model and scheduling

- Added persistent wake/departure reminder records backed by MySQL and a migration, with UTC trigger instants, IANA timezone, status, attempt count, sent time, error, and duplicate constraint.
- Schedule create/edit/cancel reconciles reminders in the same transaction. Pending reminders track calculated times; cancelled schedules cancel pending rows; sent reminders remain sent. Past or unavailable calculations do not create reminders.
- Scheduler choice: database-backed queue polled by standalone `python -m reminder_worker`. MySQL claims use row locks with `SKIP LOCKED`; UUID tokens, lease expiry, and next-attempt timestamps support competing workers, retry delays, and crash recovery.
- Schedule validity checks, sanitized error records, capped exponential retries, and confirmed-send-only status were added. Expired final claims become failed rather than being reclaimed forever. Operational logs omit exception text and secrets.
- Timing assumption: because lead times are undefined, reminders use the calculated wake and departure instants themselves.
- Verification at Spec 17 completion: backend suite **295 passed** (including 14 worker tests); `git diff --check` passed. Migration was already present as revisions `20261019_0010` and `_0011`; no live schema migration was applied during Spec 17.

### Spec 16 follow-up - Restore saved-view refresh actions

- Restored only the route-estimate and weather-advisory refresh buttons in saved schedule view. Route-choice radios and the alternative list remain available only in create/edit mode.
- The existing one-minute route cooldown, server-side rate-limit handling, and past-schedule restrictions still apply. No database migration.
- Verification: frontend tests, ESLint, TypeScript check, production build, and `git diff --check` passed. Backend was unchanged. No browser verification performed.

### Spec 16 follow-up - Separate selected-route view from route editing

- Saved schedule details now render only the saved selected route on the map. The alternative list and route radios are hidden in view mode; users can choose another route by opening Edit. The route-estimate refresh and weather-advisory refresh buttons remain available for future active schedules with confirmed endpoints, with existing cooldown and past-schedule rules.
- Create and edit forms show the available route list and comparison map. The selected path is drawn last with a wider, brighter stroke, and selection state updates the map and selected-route landmarks immediately. Edit mode reuses saved options when endpoints/time are unchanged and keeps the persisted choice selected by default. Changed route context loads fresh options.
- Route-only edits select from the saved validated alternative set without an extra routing call. Edits to endpoints or scheduled time use the existing backend route recalculation and apply the submitted option ID before recalculating schedule times and weather timing. Existing route-refresh limits are unchanged.
- Added regression coverage that route selection during update uses the refreshed route metadata and duration. No schema change or migration.
- Verification: backend pytest **278 passed**; routing tests **58 passed**; frontend tests passed; ESLint passed; TypeScript check passed; production build passed; `git diff --check` passed. No browser workflow was manually verified.
- Remaining manual verification: confirm saved detail shows one route and no route controls; open Edit, change route, verify immediate map highlight, save, then reopen and confirm the saved route alone appears. Check desktop/mobile layout.

### Spec 16 follow-up - Correct route preview and add landmarks/zoom

- Fixed root cause for incomplete route lines: provider geometry longer than 500 points was previously truncated at point 500, dropping the destination. Geometry is now sampled across the full path with the first and last route points retained.
- Kept the detailed shared road map as the route preview and removed the old small per-card SVG previews that squeezed route paths into route-option cards. The map shows A/Origin and B/Destination markers plus explicit endpoint labels.
- Added zoom in/out, reset, and drag-to-pan controls. The currently selected route now loads nearby hospitals and schools through an authenticated backend proxy to TomTom Search Along Route. Requests are limited to 100 sampled route points, 20 results, five-second timeout, and a six-hour in-process cache; invalid results are discarded and failures do not block route selection.
- Added backend coverage for route geometry endpoint preservation, landmark request validation/authentication, provider response filtering, request bounds, and caching. No database schema change or migration is required.
- Verification: backend pytest **278 passed**; `npm run test:frontend` passed; ESLint passed; `npx tsc --noEmit` passed; production build passed; `git diff --check` passed (Git printed line-ending normalization notices only). No interactive browser check or live landmark search was performed.
- Remaining manual verification: inspect the route map at desktop/mobile widths, zoom and pan with mouse/touch, verify actual route alignment and endpoint pins, and confirm local hospital/school coverage with the configured TomTom Search key.

### Spec 16 follow-up - Fix TomTom map preview 502

- Reproduced the map proxy failure against TomTom using the exact geographic bounds from the user's request (without printing the configured API key). TomTom returned a generic plain-text HTTP 400 `Bad request`; the FastAPI route translated that upstream rejection into its own HTTP 502. The TomTom body did not identify a rejected parameter.
- Corrected the Static Image request to use the documented `center` plus a viewport-fit `zoom`, computed from the map's 960×420 dimensions and Mercator-projected bounds. A live TomTom request for those same bounds now returned `image/png` (146,335 bytes).
- Hardened diagnostics: server logs record only failure category, upstream HTTP status, structured provider code, and validated parameter target names; no key, URL, response body, or coordinates are logged. The endpoint maps invalid/restricted credentials to actionable configuration guidance, provider throttling to 429, timeouts to 504, and other upstream failures to a safe 502.
- Added regression tests for center/zoom generation and upstream status mappings. No schema or migration change.
- Verification: live TomTom request succeeded; backend pytest **275 passed**; frontend tests passed; ESLint, TypeScript, production build, and `git diff --check` passed. Browser UI confirmation remains outstanding.

### Spec 16 follow-up - Add labeled map to route comparison

- Implemented: the pre-save route chooser and saved schedule route comparison now display all route geometries over one TomTom Static Image road map. Distinct route colors, shared start/destination markers, route legend, and TomTom attribution make geographic differences easier to compare. The existing route cards retain travel time, distance, traffic delay, and provider road labels.
- Map requests use an authenticated FastAPI proxy with bounded geographic bounds, fixed image dimensions, a derived zoom level, an eight-second timeout, response content/size validation, and safe failure behavior. The TomTom key remains backend-only. Missing map imagery leaves route selection and details available. No new dependency, schema change, or migration.
- Changed files: `backend/map_service.py`, `backend/routers/schedules.py`, `backend/tests/test_map_service.py`, `backend/tests/test_schedule_api.py`, `app/schedules/route-comparison-map.tsx`, `app/schedules/schedule-workspace.tsx`, `lib/schedule-api.ts`, `context/decisions.md`, and this tracker.
- Verification: backend pytest **268 passed**; `npm run test:frontend`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed (Git emitted expected line-ending notices). No live TomTom image request or interactive browser verification has been performed.
- Remaining manual verification: with a configured TomTom key, inspect map label coverage and route alignment on create and saved schedule screens, confirm mobile sizing, and verify the graceful map-unavailable state. No migration required.

### Spec 16 follow-up - Fix 502 for the full alternative-route set

- Root cause: the routing adapter correctly collected up to six entries (primary plus five alternatives), but `TravelEstimate.alternatives` allowed only five. When TomTom returned all six, Pydantic rejected the estimate and the route-options endpoint translated that validation failure into a generic 502.
- Fixed the schema capacity at six and added a regression test for the full provider-supported set. The request parameter remains `maxAlternatives=5`.
- Verification: backend pytest **263 passed**; `git diff --check` passed (with existing LF-to-CRLF normalization notices). No live TomTom request performed, so the user's exact provider response was not captured; the six-route validation failure is reproduced and fixed by the regression test.

### Spec 16 follow-up - Choose routes before saving

- Implemented: a confirmed origin and destination in a new schedule triggers an authenticated route-options preview using the selected target time and intent. Routes appear in the form with duration, distance, traffic delay, and road labels; selection is required before saving or assistant autosave. On provider failure, the form displays the safe failure reason, allows retry, and offers an explicit save-without-route option.
- Implemented: the create request includes the selected provider route ID; the backend re-requests and validates current options, then applies only the matching route to the persisted estimate and calculations. A changed option list returns a clear conflict rather than silently selecting a different route.
- Added route-preview/create integration coverage. Changed files: `backend/schemas.py`, `backend/routers/schedules.py`, `backend/tests/test_routing.py`, `lib/schedule-api.ts`, `app/schedules/schedule-workspace.tsx`, `context/decisions.md`, and this tracker.
- Tradeoff: Preview and create each request TomTom to avoid trusting route data supplied by the browser or adding database-backed temporary state.
- Verification: backend pytest **262 passed**; frontend test suite passed; ESLint, TypeScript, production build, and `git diff --check` passed. No live TomTom or browser workflow performed.

### Spec 16 follow-up - Show route status and expose route selection

- Fixed: confirmed origin/destination schedules now show the Travel and traffic card even when route lookup failed. It explains that estimates are unavailable and exposes a `Get route estimate` retry action; successful lookups continue to show saved duration and traffic details.
- Fixed: route choices are shown whenever TomTom returned at least one route, making the selected route visible even when the provider offers no alternatives. Existing location-free and past-schedule behavior remains intact.
- Changed files: `app/schedules/schedule-workspace.tsx`, `lib/schedule-warning-display.js`, `lib/schedule-warning-display.test.js`, `context/decisions.md`, and this tracker.
- Verification: backend pytest **261 passed**; frontend tests passed; ESLint (no warnings), TypeScript, production build, and `git diff --check` passed. No live provider or browser reproduction performed.

### Spec 16 - Alternative Route Selection

- Implemented: TomTom requests `maxAlternatives=5`, validates each returned route independently, and retains up to six valid driving routes (primary plus five alternatives). Each option carries duration, optional distance and traffic metrics, traffic sections, provider road names, and up to 500 validated route points for an SVG path preview. Invalid alternatives are skipped; invalid/no routes use the existing graceful provider-failure behavior.
- Implemented: schedule detail displays selectable route comparisons and marks the saved selection. Authenticated selection updates the selected estimate, traffic sections, duration, dependent schedule calculations, and weather assessment in one backend update. Selection and route options live in the existing estimate JSON; old schedules without route options remain compatible. No migration.
- Changed files: `backend/routing_service.py`, `backend/schemas.py`, `backend/routers/schedules.py`, `backend/tests/test_routing.py`, `backend/tests/test_schedules.py`, `lib/schedule-api.ts`, `app/schedules/schedule-workspace.tsx`, `context/decisions.md`, and this tracker.
- Database inspection: configured MySQL database reports Alembic revision `20261016_0009` (head). Existing `schedules.travel_estimate` is the route JSON storage field in the ORM and existing migration history; no new column was needed and no migration was applied.
- Verification: backend pytest **261 passed**; the routing suite was rerun after the added geometry assertion (**55 passed**). Frontend test suite passed; `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Git emitted expected LF-to-CRLF normalization notices. No live TomTom request or interactive browser workflow performed.
- Remaining manual verification: compare route path previews in the browser using configured TomTom credentials, choose a route, verify traffic incidents and weather forecast hours update, then verify saved choice after reload. Verify no-alternative/provider-failure states with live provider conditions if available.

### Spec 15 - AI origin/destination extraction and location resolution

- Implemented: extraction now returns validated nullable origin/destination descriptions separately from the existing schedule fields. The frontend searches each stated description through the existing authenticated backend TomTom Search API and presents the returned candidates through the existing `LocationPicker`; it never selects a candidate automatically. Place-aware autosave waits until each extracted description has a selected candidate. User edits to a location query clear its prior selection; unrelated schedule edits retain selections in the existing schedule request and JSON fields.
- Missing required schedule information continues through the existing targeted clarification flow. Location-free schedules retain current autosave eligibility. Empty results and provider failures leave locations unselected and report that safely. TomTom keys and requests remain backend-only.
- Existing `LocationSelection`, `LocationPicker`, authenticated search API, schedule JSON fields, and create/update/idempotency/routing flow are reused. No alternative routes, traffic/weather/time changes, or migrations were made. The spec path's internal heading says “Spec 16”; implementation followed its content without changing its numbering.
- Changed files: backend extraction schema/service and extraction/location tests; schedule workspace, API types, autosave eligibility/tests, clarification copy/test, location selection helper/test; frontend test script; decisions and this tracker.
- Verification: backend pytest **244 passed**; frontend tests passed (including autosave, clarification, and location selection suites); ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. No live AI/TomTom request or interactive browser workflow was performed.
- No schema change or migration was required or applied. Manual verification with the configured AI provider and browser location candidate/selection flow remains outstanding.
- Follow-up UI request: removed latitude/longitude from saved schedule location details and from the confirmed location display in the editor. Coordinates remain in API data for routing and are still used internally to identify search candidates; no persistence or routing changes.
- Spec file note: `context/feature-specs/15-ai-location-extraction.md` has a title heading numbered Spec 16; following its requirements without modifying the spec numbering.
- Verification: backend extraction, time-calculation, and schedule API tests **82 passed** (pytest emitted the existing cache warning); frontend tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. The initial sandboxed build hit `spawn EPERM`; rerunning with approved escalation passed. No live AI-provider request or interactive browser verification was performed.

### Prevent misleading traffic and weather for past schedules

- Added an aware UTC instant comparison to schedule responses. `is_past` follows the calculated intended departure instant when available (including arrival-intent schedules), otherwise the target instant; it does not use formatted display values or alter the saved target.
- Schedule create/edit skips route and weather provider requests for past targets. Existing travel/weather estimate JSON is preserved as historical reference. Editing a past target to a future instant resumes normal routing and weather assessment. Manual route refresh returns HTTP 409 before consuming a refresh attempt when the schedule has passed.
- Detail UI identifies past schedules, explains that live traffic and future forecasts no longer apply, labels saved route data with its retrieval time as historical reference, states when no useful past estimate exists, and hides manual refresh while past. Schedule edit and cancel controls remain available.
- Follow-up UI refinement: suppress the top-level after-departure route warning only for past schedules because the historical-estimate notice already covers it. The 15-minute stale warning is also suppressed for past schedules, while remaining for stale upcoming schedules; fresh upcoming estimates do not show it. These checks use the backend's existing `is_past` result. The banner and timestamped historical notice remain visible. Frontend regression tests cover all three stale-warning cases and both retained notices.
- Added regression coverage for future, just-passed, and long-past aware instants across timezone representations; arrival departures already passed; provider-call suppression; historical estimate preservation; future edit recovery; refresh rejection; and retaining schedule identity and title.
- No schema or migration change. Verification: backend pytest **242 passed** in the prior change; frontend tests, ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed for the UI refinements.

### Remove duplicate locations and harden traffic incident details

- Confirmed location duplication: event details rendered each incident's reverse-geocoded `approximate_location` even when that same value already appeared in its group heading. The presentation helper now omits that duplicate and only keeps an incident location when it adds context beyond the group heading.
- Trace of empty-row report: backend `TrafficSection` allows nullable `incident_type` and `delay_seconds` and serializes them as `null`; the schedule API type/validator requires those keys but accepts null. In the inspected UI source, every valid incident row already had `Incident type unavailable` and `Delay unavailable` fallbacks, so a blank row could not be reproduced from a schema-valid response. Rendering is now centralized in a tested details helper: nullable values always yield readable fallbacks, and malformed non-object entries are omitted instead of producing a blank list row. The live North Luzon response was not available, so its exact observed blank-row trigger remains unconfirmed.
- Added frontend tests for duplicate-location suppression, meaningful distinct location detail, missing/null optional fields, malformed events, preserved incident type/delay values, and unchanged group totals. No backend, routing, provider, persistence, or rate-limit behavior changed.
- Verification: backend pytest **236 passed**; frontend traffic-display, suggested-times, and schedule-order tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. No browser verification was performed.

### Use approximate locations in traffic group headings

- Root cause: `groupTrafficSections()` constructed every section without a verified `road_names` entry under the same `road-name-unavailable` identity and did not consult the already-present `approximate_location`/`location_source` fields. Routing produced midpoint coordinates and persisted the reverse-geocoder result separately; API schemas and JSON persistence retained it, and the incident detail UI displayed it.
- Grouping now prefers verified road metadata. For sections without verified names, a normalized reverse-geocoded label supplies an `approximate:` grouping identity and a `Near …` heading with an `Approximate location` badge. Different labels remain separate, and absent/unavailable labels still use `Road name unavailable`. Approximate labels are not copied into `road_names` or used to claim affected-road identity. Existing event count, type breakdown, delay totals, and route-level delay source are unchanged.
- Added grouping tests for verified-name priority, same/different approximate labels, unavailable labels, and combined incident-delay totals; routing tests confirm midpoint selection, missing-coordinate behavior, fallback persistence through schema serialization, and existing route-vs-incident delay separation.
- Verification: backend pytest **236 passed**; frontend traffic-display, suggested-times, and schedule-order tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. `alembic check` reports no new upgrade operations; no migration was needed. No live TomTom or browser verification performed.

### Reverse-geocoding fallback for unnamed traffic sections

- Preserved route-metadata matching as primary. Missing or ambiguous road-name matches may now request TomTom Search API v2 reverse geocoding at the traffic section's midpoint route coordinate. The result is stored separately as `approximate_location` with `location_source=reverse_geocoding`; it is never added to verified road names or used for grouping.
- The fallback uses the existing server-side TomTom key, a 2-second timeout, 50-meter result radius, a maximum of three eligible lookup attempts per route estimate, and a bounded process-local cache (500 entries, six-hour TTL, including empty results). Failures/timeouts leave the location unavailable and do not fail a route estimate. The UI labels successful values `Near …` with a visible `Approximate location` badge and keeps coordinates hidden.
- Added backend coverage for verified-name bypass, ambiguous and missing name fallback, lookup caps, empty/time-out behavior, server key/timeout/radius, caching, and fallback source separation. Added frontend grouping compatibility coverage. No migration is required because traffic sections are stored in the existing JSON estimate; older rows default the new fields on schema parsing.
- Verification: focused routing tests **40 passed** before the final timeout-cache case was added; full backend pytest **235 passed**; frontend traffic-display, suggested-times, and schedule-order tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. `alembic heads` reports `20261016_0009 (head)` and `alembic check` reports no new upgrade operations. No migration was needed or created. No live TomTom or browser verification performed.

### Group traffic incidents and show delay totals

- Extended the existing verified-road groups with incident counts, a breakdown by reported incident type, and a per-road combined incident-delay summary. Each provider section remains a separate incident and is available in an expandable details list.
- Group totals include valid zero-second values. Missing, negative, fractional, or unsafe delay values are unavailable; if any exist the total is marked incomplete and any known subtotal is explicitly labeled. The displayed aggregate is described as provider incident figures, not additional travel time or a decomposition of route-level delay. The existing route-level delay label and status classification are unchanged.
- Added frontend helper assertions for repeated-road grouping, event/type counts, seconds formatting, zero values, missing and invalid values, and the unnamed-road group. Existing backend route tests separately verify route-level delay is independent from the incident sections.
- Verification: backend pytest **231 passed**; frontend traffic-display, suggested-times, and schedule-order tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. No live TomTom or browser verification performed; no provider calls, dependencies, schemas, or migrations changed.

### Group traffic incidents by road and clean up identifiers

- The schedule detail view now groups traffic events by a normalized set of provider road names. The group heading displays the road name once; every provider `TRAFFIC` section remains an individual event with its own incident type and reported delay. Sections without names remain under `Road name unavailable`. Grouping does not sum delays or imply that separate events are the same incident/location.
- TomTom's documented `roadNumbers[].text` is a road number and the array is ordered by display priority. The actual raw response for the user's live example is still unavailable. The UI now filters display to alphanumeric route designations (for example `AH26`, `E3`) and suppresses ambiguous numeric-only strings such as `1`, while retaining every provider road number in backend storage and API data. No country-specific meaning is inferred for `1`.
- Added frontend tests for normalized repeated road names, distinct events and delays under one road, unnamed sections, recognized designation formatting, filtering numeric-only values, and unchanged event values. No backend schema, routing, refresh, rate-limit, persistence, or dependency changes were needed.
- Verification: backend pytest **231 passed**; frontend tests passed (**35 traffic display assertions** plus suggested-times and schedule-order tests); ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. The route-number semantics are based on official documentation, not a captured live response; live TomTom and browser verification have not been performed.

### Remaining unnamed traffic sections: sanitized refresh diagnostics

- Raw TomTom responses are not retained, no captured route response is present in the repository, and the computer-use inventory exposes no controllable browser/app session (although local frontend/backend listeners are running). Therefore the two reported live sections have not yet been refreshed and inspected in this session; their exact upstream cause remains unconfirmed.
- Added temporary diagnostics only to the manual route-refresh path, and only for `TRAFFIC` sections that still have no mapped road identifier. Logs include traffic point indexes, up to 20 nearest `IMPORTANT_ROAD_STRETCH` sections by point-index gap, their indexes, provider road names/numbers, and an explicit overlap decision. Logs omit route coordinates, user IDs, keys, headers, and raw response bodies. Initial schedule route calculations do not enable diagnostics.
- The diagnostic decision distinguishes no road-stretch metadata in the response, nearest metadata with no overlap, overlapping sections without identifiers, and multiple overlapping stretches. No road name is assigned from non-overlapping metadata. Existing refresh rate limits, estimate persistence, and incident/route-delay semantics are unchanged.
- Verification: full backend pytest **231 passed**; frontend tests passed (**25 traffic display assertions** plus suggested-times and schedule-order tests); ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. The diagnostics are still enabled but restricted to unnamed sections from manual refreshes because no live refresh was available to verify and remove them. No provider data was captured in this run.

### Traffic-affected route portions

- TomTom response JSON is not persisted raw and the repository has no captured response for the affected estimate, so the historical road-name omissions cannot be attributed conclusively to missing upstream fields versus incomplete route coverage. The current adapter maps `streetName.text` and `roadNumbers[].text` only from `IMPORTANT_ROAD_STRETCH` sections whose point-index range overlaps each `TRAFFIC` section; it maps incident delay/category from the `TRAFFIC` section and coordinates from indexed `legs[].points`.
- Found and fixed an index-boundary mapping gap: TomTom documents section start/end indexes as the first/last route points to which each section applies, while the adapter required positive-length overlap and rejected shared endpoint indexes. Matching now treats those documented inclusive endpoints as overlap. The UI now displays `Road name unavailable` when neither road names nor numbers are mapped and keeps raw coordinates out of the ordinary user display; coordinates remain in the internal estimate.
- A TomTom reverse-geocoding API exists, but no extra request was added: it can return an address/nearby result rather than prove the named road is the affected roadway, and per-section calls would add latency and provider usage without caching. Route-level and incident-level delay semantics and refresh behavior are unchanged.
- Added/updated mocked cases for available names, inclusive endpoint match, genuinely missing names with coordinates retained internally, and UI labels for both available and unavailable road identifiers. Existing estimate JSON persistence requires no migration.
- Verification for this investigation/fix: full backend pytest **230 passed**; frontend tests passed (**25 traffic display assertions** plus suggested-times and schedule-order tests); ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. No captured historical response, live TomTom call, or browser verification was available/performed.

### New schedules appear at the top immediately

- Root cause: the backend list already returns `created_at DESC, id DESC`, but the shared manual-create and AI-autosave success path appended the returned schedule to the end of the current client list. Refreshing reloaded the server order, which made it appear at the top then.
- New create responses now use a shared client helper that upserts the schedule and sorts by creation timestamp descending with ID descending as the tie-break. Manual create and AI autosave share this path. Idempotent retries do not duplicate schedules or move an older schedule ahead of newer items; edits retain their existing position.
- Added frontend helper tests for immediate newest-first placement, idempotent retry, and timestamp ties. Verification: frontend tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. No backend or database changes were needed. Browser workflow was not performed.

### Weather Advisories

- Replaced weather time adjustments with endpoint-specific advisories. The backend still samples Open-Meteo near calculated departure and arrival using the existing rain, heavy-rain, snow, wind, and thunderstorm thresholds. Advisories include condition, endpoint, and forecast hour; no significant conditions and unavailable forecasts have distinct messages.
- Removed weather input from deterministic time calculations and removed the bounded second assessment, since forecasts no longer shift the sample time. Route duration, traffic delay, configured travel buffer, preparation buffer, arrival/departure intent, and wake calculations remain deterministic and independent of weather.
- Updated the schedule UI and API types to show cautious advisory wording, endpoint forecast detail, and endpoint coverage limits. Legacy weather buffer and timing JSON fields remain readable but are excluded from current API output. The existing nullable `weather_estimate` JSON column remains sufficient; no migration was added or applied.
- Tests cover rain, heavy rain, snow, strong winds, thunderstorms, clear weather, unavailable forecasts, legacy JSON compatibility, aware advisory timestamps, both schedule intents, and no weather effect on departure, arrival, wake time, or configured buffers. Route-refresh integration verifies the advisory is informational.
- Verification: full backend pytest **228 passed** (one pytest cache-path `WinError 183` warning); frontend tests passed (traffic display and suggested-times tests); `npm run lint`, `npx tsc --noEmit`, production build, and `git diff --check` passed. `alembic heads` reports `20261016_0009 (head)` and live configured-database `alembic check` reports no new operations. No migration was created or applied. `alembic upgrade head --sql` was also attempted and failed in the existing `20261016_0009_schedule_names.py` migration because its data-inspection query requires an online connection; it is unrelated to this feature. No live Open-Meteo request or browser workflow was performed.

### Schedule extraction 503 regression investigation

- Traced `POST /schedules/extract`: `OpenRouterClient._post()` converts `httpx.TimeoutException` / transport errors to `AIProviderError`; `ScheduleExtractionService` wraps those as `ScheduleExtractionError`; the extraction router returns the generic HTTP 503 response. No local logs were available for the original incident.
- Reproduced the current 503 with one generic request to the configured free provider: the cause chain was `httpx.ReadTimeout` -> `AIProviderError("OpenRouter request timed out")` -> `ScheduleExtractionError` -> HTTP 503. A sandboxed request also failed at transport. This establishes a current upstream/network timeout, but cannot prove the exact original incident exception without logs from that request.
- Compared the naming changes with the prior implementation: title was removed from the prompt/schema, extraction missing-field set, and title fallback. This affects schema validation: a provider response that still includes an extra title is rejected by `extra="forbid"`, but `AIInvalidOutputError` is caught before `AIProviderError` and produces HTTP 200 clarification, not the observed 503. Valid title-free provider JSON parses and returns ready review in a local endpoint test.
- The migration is unrelated to extraction: this endpoint depends on auth and the extraction-service dependency, not the database. The provider client, HTTP timeout, and exception mapping were not changed by schedule naming. No provider timeout/configuration change was justified by the evidence.
- Added endpoint regression tests for title-free structured provider parsing and safe 503 mapping of a simulated upstream timeout in `backend/tests/test_schedule_api.py`. Verification: backend pytest **217 passed**. Historical incident attribution remains unverified; if it recurs, correlate the request timestamp and capture only the sanitized transport exception class or upstream HTTP status (never response secrets or API keys).
- Added sanitized server diagnostics. `OpenRouterClient` records classified metadata (`timeout`, `authentication`, `rate_limit`, `configuration`, `transport_error`, or `provider_error`) with exception class and upstream status when present; `ScheduleExtractionService` logs class/category/elapsed milliseconds/status, and the router logs effective provider/model/sanitized base URL plus only whether a key is configured. No credentials, authorization headers, or response bodies are logged. Tests cover status classification, timeout metadata, safe 503 mapping, and title-free extraction.
- Current configuration verification: provider `openrouter`, model `nvidia/nemotron-3-ultra-550b-a55b:free`, base URL `https://openrouter.ai/api/v1`; a key is configured and agrees with `backend/.env` (value intentionally not displayed). Minimal request through the configured client timed out with `httpx.ReadTimeout` and no upstream HTTP status. This confirms a current timeout, not authentication, rate limiting, or a provider HTTP response. No upstream reachability fix is established, so extraction is not confirmed working.
- Latest verification: focused extraction/provider/API tests **72 passed**; full backend pytest **228 passed**; `git diff --check` passed. Pytest emitted a cache-path `WinError 183` warning, but completed successfully. No migration or schedule naming changes were made for this investigation.

### Sequential schedule names and duplicate prevention

- Implemented optional user-supplied titles with backend-generated defaults (`Schedule 1`, `Schedule 2`, ...). A per-user counter is initialized from existing `Schedule N` titles during migration and advanced in the same transaction as a save. The counter row is locked for allocation; deleted numbers are not reused. Idempotency lookup remains before allocation, and unique-key race retries return the original saved schedule.
- Added trimmed, case-folded `normalized_title` persistence and a database unique constraint scoped by Clerk user. Duplicate create/rename attempts return HTTP 409 with a clear message. Renaming to the same schedule's own name (including case-only changes) remains valid. AI extraction no longer requests or returns a title; assistant autosave omits title and displays the backend response. Manual custom titles remain supported.
- Added Alembic revision `20261016_0009`. It preserves existing titles, seeds each user's counter from matching existing `Schedule N` names, and checks for normalized duplicates before DDL. Existing duplicates cause an explicit migration error listing owner and schedule IDs; operators must resolve them before retrying. No existing data is silently renamed or deleted.
- Changed files: `backend/models.py`, `backend/schemas.py`, `backend/routers/schedules.py`, `backend/extraction_schemas.py`, `backend/extraction_service.py`, `backend/alembic/versions/20261016_0009_schedule_names.py`, `backend/tests/test_schedule_api.py`, `backend/tests/test_extraction_service.py`, `backend/tests/test_schedule_name_migration.py`, `app/schedules/schedule-workspace.tsx`, `lib/schedule-api.ts`, `lib/assistant-autosave.ts`, `lib/assistant-autosave.test.ts`, `lib/clarification-messages.test.ts`, `context/decisions.md`, and this tracker.
- Verification: backend pytest **215 passed**, including API CRUD/user scoping/extraction regressions, numbering per user, no reuse after deletion, duplicate creation/rename behavior, idempotent retries, simultaneous creates, and SQLite migration tests. Frontend tests passed (traffic display and suggested times); assistant autosave tests **3 passed**; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. On the configured MySQL database, all 35 confirmed-disposable schedules and 5 referencing route-refresh attempts were deleted in FK-safe order. `route_refresh_user_locks` (1 row) and `alembic_version` were preserved. Alembic revision `20261016_0009` was applied; `alembic current` reports `20261016_0009 (head)`, `alembic check` reports no new operations, and inspection confirms the non-null `normalized_title` column, per-user unique constraint, and `schedule_name_counters` table. Schedule and route-attempt tables are empty; lock row remains.
- Live MySQL migration and post-migration schema consistency are verified. A browser workflow and a new schedule creation against MySQL were not performed; backend behavior is covered by the SQLite-backed automated API/concurrency tests.

### Schedule list ordering — newest created first

- Root cause: `GET /schedules` sorted by `target_datetime` ascending, and the active schedule list independently repeated that target-time sort. Schedules with later target dates could therefore appear above more recently created schedules.
- The API now orders each user's schedules by `created_at DESC, id DESC`; the secondary ID order makes equal creation timestamps deterministic. The UI filters active schedules while preserving API order. The list endpoint has no pagination parameters, and the SQL ordering is applied in the query before any potential pagination.
- Added API coverage with deliberately conflicting target dates and explicit creation timestamps, including equal timestamps to verify the ID tie-break. Existing API tests cover user scoping.
- Verification: backend pytest **208 passed**; frontend tests passed; `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. No frontend browser check or Alembic check was run; the model/schema did not change and no migration is needed.

### Spec 14 intermittent Open-Meteo timeout investigation

- Each origin/destination HTTP request passes `timeout=4.0` to HTTPX. `_forecast()` maps `httpx.TimeoutException` to the safe `provider_timeout` reason and retains only the endpoint label and requested UTC hour; the two calls run concurrently in a two-worker executor. A timeout from either makes the complete assessment unavailable with a zero weather buffer, so unverified data is never applied.
- Added mocked tests for origin and destination timeouts and for a subsequent assessment succeeding after a timeout. The mock confirms the 4-second timeout argument and that recovery uses newly returned weather data.
- The observed diagnostic supports that the origin request timed out. It does not establish whether provider latency, network/local conditions, or concurrency caused it. No evidence currently justifies changing timeout configuration or concurrency; rules, fallback, and the bounded two-pass schedule flow are unchanged.
- Verification: backend pytest **207 passed**; frontend tests, ESLint, TypeScript check, production build, and `git diff --check` passed. Pytest emitted a cache-path warning while tests passed. No live provider or browser request was performed.

### Spec 14 unsupported forecast-time diagnostics

- Traced the only `unsupported_forecast_time` gate: a requested departure hour earlier than the current UTC hour, or an arrival hour later than the current UTC hour plus 15 days. The existing comparison boundaries and fallback behavior are unchanged.
- Unavailable assessments now retain a safe rejection code (`departure_before_current_hour`, `arrival_beyond_forecast_horizon`, or both) and the UTC hour used as the comparison boundary. The existing warning logger renders these alongside requested endpoint forecast hours; no locations, coordinates, secrets, or exception text are included. API serialization and persisted schedule data are unchanged.
- Added deterministic tests for each rejection, both conditions together, the current-hour boundary, and the inclusive 15-day boundary. Updated log-format coverage for the additional safe fields.
- A separate defensive 16-day check inside `_forecast()` maps to `invalid_response_values`, not `unsupported_forecast_time`; the specific reason requested here is produced only by the outer two-condition gate. The observed log cannot establish its historical cause because it contains no comparison-hour value. New logs will identify future occurrences.
- Verification: backend pytest **204 passed**; frontend tests, ESLint, TypeScript check, production build, and `git diff --check` passed. No migration or frontend source change was needed. No live Open-Meteo or browser verification was performed.

### Spec 14 weather diagnostics visible in local logs

- Investigation found `_log_weather_failure()` populated `LogRecord` extras, but application startup had no formatter that displayed those attributes. The Alembic formatter only applies to migration commands; the default Uvicorn console formatter prints the message and omits arbitrary extras.
- Weather failure warnings now render the approved structured fields as fixed key/value text in the log message while retaining each field as a `LogRecord` attribute for structured handlers. Regression coverage verifies all diagnostic fields in both representations and checks that names, coordinates, and key-like values are absent.
- No weather behavior, response, or persistence changes; no migration required. Verification: backend pytest **199 passed**, frontend tests passed, lint, TypeScript checks, production build, and `git diff --check` passed. The originally observed runtime failure cause remains unknown until a subsequent failure is captured in the updated logs.

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

### Long-distance route estimate failure handling

- Confirmed code path: TomTom route requests previously had a five-second timeout; timeout/provider errors were mapped to generic HTTP 502, and the frontend replaced 5xx details with a generic service message. The exact reported overseas request is not logged, so its individual provider response cannot be confirmed.
- Increased route request timeout to 35 seconds, classified local timeouts and TomTom's documented compute-limit response, and added safe actionable responses for timeout/compute-limit and explicit no-route errors. Refresh failure continues preserving the prior estimate; no fabricated estimate is created. Users are told they can enter travel duration manually.
- Added backend tests for timeout classification, safe error classification, timeout value, refresh responses, and persisted-estimate preservation. No schema or migration change.
- Verification: routing tests 50 passed; frontend tests passed; ESLint, TypeScript, production build, and `git diff --check` passed. The first pytest invocation lacked the backend import path and failed collection; rerunning with `PYTHONPATH=.` passed. Pytest emitted a cache warning due to an existing cache directory conflict. No live overseas request was reproduced.

### Confirm no-route schedules before saving

- Schedule creation now stops before persistence when TomTom explicitly returns no drivable route. The form explains that traffic/weather estimates will be unavailable and asks whether to save without the route estimate or review the locations.
- Confirmed retry uses the same idempotency key, skips repeating route lookup, saves with travel duration unavailable, and retains the existing unavailable weather response. Other provider failures preserve prior creation behavior; refresh error handling is unchanged.
- Added backend regression coverage proving no schedule/weather request occurs before confirmation, the confirmed retry saves without re-requesting routing, and the schedule has no fabricated travel estimate. No migration or persisted schema change.
- Verification: 76 routing and schedule API tests passed; frontend tests passed; ESLint, TypeScript, production build, and git diff --check passed. Pytest reported the existing cache-directory warning. No interactive browser verification was performed.

### Explain weather timing and hide empty travel card

- At this stage, weather stayed unavailable without a duration; this behavior was changed in the follow-up below.
- Upcoming schedules without a saved route estimate no longer render the Travel and traffic card. The route retry action remains available separately, and past schedules retain the unavailable historical-reference message. Added frontend helper coverage for these display conditions.
- Backend tests at that stage confirmed weather could assess when duration was known without a route estimate.
- Verification: backend routing and schedule API tests **77 passed**; frontend tests passed; ESLint and TypeScript passed. Production build and `git diff --check` passed.

### Inform no-route refreshes and assess weather without route duration

- Explicit no-drivable-route responses from route refresh now carry a safe code/message and appear as an informational status, not an error alert. The API client's typed error parsing is covered by a frontend test.
- When a schedule has no traffic estimate, its action now refreshes weather only through a dedicated endpoint. Weather assessments use the schedule event instant for both endpoints when route duration is unknown; the UI labels these as endpoint snapshots, not trip-timed forecasts. With a duration, the existing departure/arrival forecast times remain unchanged.
- Added backend coverage for no-route refresh mapping and weather-only refresh; updated no-route create coverage to verify weather can be assessed without route duration. Updated Spec 14 and recorded DEC-034. No migration or schema change.
- Verification: backend routing/schedule API tests **78 passed**; frontend tests passed (including the new API error mapping test); ESLint, TypeScript, production build, and git diff --check passed. Pytest emitted the existing cache-directory warning. No interactive browser verification was performed.

### Preserve extracted clock time when an AI offset conflicts

- Extraction now separates an offset-bearing model time into a naive wall-clock value plus a temporary offset for validation. It no longer clears the clock or emits a missing-time error solely because the model offset disagrees.
- Explicit IANA timezone text takes precedence. A directly time-bound departure origin or arrival destination can establish the schedule timezone (including Tokyo); unrelated trip mentions do not. Otherwise the selected timezone remains the default. Datetime resolution uses the existing IANA timezone database and preserves DST gap/repeated-time checks. The frontend uses the backend-resolved timezone unless the backend reports a genuine timezone ambiguity.
- Added regression coverage for Tokyo 10 AM with matching, conflicting, and missing offsets; selected Manila defaults; explicitly stated IANA zones; missing times; general trip mentions; and clarification copy. No schema or migration change.
- Verification: backend extraction, time-calculation, and schedule API tests **82 passed** (pytest emitted the existing cache warning); frontend tests passed; ESLint, `npx tsc --noEmit`, production build, and `git diff --check` passed. The initial sandboxed build hit `spawn EPERM`; rerunning with approved escalation passed. No live AI-provider request or interactive browser verification was performed.
