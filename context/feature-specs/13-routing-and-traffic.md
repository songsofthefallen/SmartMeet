# Spec 13 — Routing and Traffic

## Goal

Estimate travel duration between a schedule's selected origin and destination coordinates using a replaceable routing service, initially backed by TomTom Routing.

## Requirements

- Route only with validated coordinates from the schedule's explicitly selected origin and destination. Do not infer or geocode locations as part of routing.
- Keep the TomTom Routing API key server-side, reusing `TOMTOM_API_KEY`; never expose it to the frontend or in errors/logs.
- Hide TomTom behind a replaceable backend routing service. Validate provider responses and return duration in a documented unit, provider/source, retrieval time, and whether traffic was included.
- Request traffic-aware routing when supported by the provider. Represent traffic inclusion accurately; do not imply live traffic when unavailable.
- Treat missing coordinates, invalid responses, no route, timeouts, and provider failures as unavailable travel duration with a safe, useful status/message. Do not fabricate a fallback estimate or corrupt the saved schedule.
- Feed a valid travel duration into the existing deterministic Spec 10 calculation path. Preserve arrival/departure intent, configured buffers, unknown-duration semantics, timezone handling, and recalculation after relevant edits. Never move time arithmetic into the provider or AI layer.
- Preserve existing authentication, schedule ownership, autosave, selected-location behavior, and schedule CRUD. Do not add weather buffers or notifications.

## Scope

- Add a backend routing adapter, validated schemas, and service orchestration; persist the estimate only if the existing schedule model can represent it without unrelated changes, otherwise define the minimal required migration.
- Display the available travel estimate and its traffic status in the existing schedule interface; make unavailable estimates clear without implying a calculated departure time.
- Add automated tests for valid routes with and without traffic, invalid/no-route responses, missing coordinates, provider timeout/failure, auth/ownership, and deterministic calculation integration/recalculation.

## Acceptance Criteria

- Schedules with selected origin and destination coordinates can receive a validated route duration.
- Traffic inclusion is requested when supported and accurately reflected in the API/UI.
- Routing failure leaves the schedule valid and uses Spec 10's existing unknown-travel behavior.
- Existing authentication, ownership, autosave, location selection, time calculations, editing, and cancellation remain intact.

## Verification

- Run backend and frontend tests, lint, TypeScript checks, production build, and `git diff --check`.
- Verify routing, traffic status, schedule save/edit/refresh, and provider-unavailable behavior in a browser. Record live-provider or database checks that cannot be completed separately.
