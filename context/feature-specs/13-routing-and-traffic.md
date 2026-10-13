# Spec 13 — Routing and Traffic

## Goal

Estimate travel duration between a schedule's selected origin and destination coordinates using a replaceable routing service, initially backed by TomTom Routing.

## Requirements

- Route only with validated coordinates from the schedule's explicitly selected origin and destination. Do not infer or geocode locations as part of routing.
- Keep the TomTom Routing API key server-side, reusing `TOMTOM_API_KEY`; never expose it to the frontend or in errors/logs.
- Hide TomTom behind a replaceable backend routing service. Validate provider responses and return duration in a documented unit, provider/source, retrieval time, and whether traffic was included.
- Request traffic-aware routing when supported by the provider. Represent traffic inclusion accurately; do not imply live traffic when unavailable.
- For future schedules, pass the intended departure/arrival time to routing when the provider supports it. Use a bounded time-conditioned request and keep the deterministic calculation service authoritative; do not loop through repeated route recalculations.
- Use `travelTimeInSeconds` as the route duration. Validate traffic comparison fields independently and do not assume `trafficDelayInSeconds` is additive to route duration or must equal the difference between other comparison estimates.
- Treat missing coordinates, invalid responses, no route, timeouts, and provider failures as unavailable travel duration with a safe, useful status/message. Do not fabricate a fallback estimate or corrupt the saved schedule.
- Feed a valid travel duration into the existing deterministic Spec 10 calculation path. Preserve arrival/departure intent, configured buffers, unknown-duration semantics, timezone handling, and recalculation after relevant edits. Never move time arithmetic into the provider or AI layer.
- Preserve existing authentication, schedule ownership, autosave, selected-location behavior, and schedule CRUD. Do not add weather buffers or notifications.
- Allow users to explicitly search for and select an origin using the existing location-search flow. Persist the selected origin separately from the destination. Allow the origin to be changed when editing a schedule. Do not assume the user's home or current location.
- If either origin or destination is missing, do not request a route. Explain which location is needed and preserve the existing schedule and unknown-travel-duration behavior.
- Automatically estimate travel when both selected coordinates exist and duration is missing. On edits, reroute when the origin/destination changes or the user clears a previously set duration; a preparation-only edit must not call routing. Do not make background refreshes or imply they are scheduled.
- Preserve the selected target instant exactly. Record retrieval time when the provider response arrives. If retrieval is later than the intended departure (or target arrival when that is the relevant time), show a warning that the estimate may not represent traffic at the intended travel time.
- For `arrive_by`, keep departure unavailable when travel is unknown while allowing a preparation-start suggestion from the target time when preparation is known. For `leave_at`, keep target departure and wake-up available independently of travel; estimated arrival remains unavailable when travel is unknown. Unknown preparation only makes wake-up unavailable.
- Show a stale-estimate warning after 15 minutes based on `retrieved_at`; update it while the detail page remains open. Keep the prior estimate visible and offer a manual refresh. A successful refresh replaces duration, traffic metadata, and retrieval time and uses the deterministic calculation service; a failed or limited refresh leaves the prior estimate intact.
- Enforce one manual refresh attempt per schedule per 60 seconds and 10 attempts per authenticated user per rolling 15 minutes on the backend. Count provider failures. Return HTTP 429 and `Retry-After` for limit violations, scope by authenticated owner, and prevent concurrent refreshes for one schedule. Disable the UI control during requests/cooldowns and show its next available time.
- Store refresh attempts and per-user serialization locks in the application database so limits are shared across workers and survive restarts. A short lease releases an abandoned in-progress refresh; the route provider call itself remains bounded by its timeout.

## Scope

- Add a backend routing adapter, validated schemas, and service orchestration; persist the estimate only if the existing schedule model can represent it without unrelated changes, otherwise define the minimal required migration.
- Display the available travel estimate and its traffic status in the existing schedule interface; make unavailable estimates clear without implying a calculated departure time.
- Return and display estimated arrival for departure-intent schedules when travel duration is known, and a late-estimate warning when applicable. Refresh UI from the successful create/update API response.
- Add automated tests for valid routes with and without traffic, invalid/no-route responses, missing coordinates, provider timeout/failure, auth/ownership, and deterministic calculation integration/recalculation.
- Cover missing duration on create, clearing duration on edit, route failure, late retrieval, both time intents, unknown preparation, unchanged targets, and no route call for preparation-only edits.

## Acceptance Criteria

- Schedules with selected origin and destination coordinates can receive a validated route duration.
- Traffic inclusion is requested when supported and accurately reflected in the API/UI.
- Routing failure leaves the schedule valid and uses Spec 10's existing unknown-travel behavior.
- Existing authentication, ownership, autosave, location selection, time calculations, editing, and cancellation remain intact.

## Verification

- Run backend and frontend tests, lint, TypeScript checks, production build, and `git diff --check`.
- Verify routing, traffic status, schedule save/edit/refresh, and provider-unavailable behavior in a browser. Record live-provider or database checks that cannot be completed separately.
