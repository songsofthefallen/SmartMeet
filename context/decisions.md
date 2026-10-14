# Product and Architecture Decisions

## Status Definitions
- **Confirmed direction**: explicitly selected by the user, though detailed implementation may remain undecided.
- **Proposed**: recommended but not yet accepted.
- **Superseded**: replaced by a later decision; keep the historical record.

## DEC-001 — AI interprets; backend calculates
- Status: Proposed
- Context: Natural-language schedule descriptions need interpretation, while reminder calculations must be reliable and testable.
- Decision: Use the LLM to extract intent and candidate fields. Validate with Pydantic and domain rules. Calculate departure/wake-up times in deterministic backend code.
- Tradeoffs: More schema and validation work, but fewer unpredictable calculations and easier tests.

## DEC-002 — Use OpenRouter as the configurable AI gateway
- Status: Confirmed direction
- Context: Free model availability changes, and the user wants to select or change models without application-code changes.
- Decision: Use OpenRouter's OpenAI-compatible chat completions API with backend-only `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` settings. Default `AI_MODEL` to `openrouter/free`; allow a configured model override. Do not integrate directly with the OpenAI API. Request structured output where supported, fall back to less restrictive response hints when unsupported, and always validate returned content with Pydantic.
- Tradeoffs: Model choice remains configurable, while output capabilities and free model availability vary; application validation remains authoritative.

## DEC-003 — Build in vertical slices
- Status: Proposed
- Context: The product combines AI, persistence, time calculations, external APIs, and reminders.
- Decision: Deliver one verified slice at a time: extraction/validation, authentication and persistence, calculation, reminders, then traffic/weather enrichment.
- Tradeoffs: Slower initial breadth, but easier debugging and better learning.

## DEC-004 — Next.js frontend
- Status: Confirmed direction
- Context: A modern web interface is required and the user selected Next.js.
- Decision: Use Next.js for the frontend. Exact version, UI library, deployment, and API proxy arrangement remain undecided.
- Tradeoffs: Strong React ecosystem and flexible rendering, with additional server/client boundary and deployment concepts to learn.

## DEC-005 — Clerk authentication from the start
- Status: Confirmed direction
- Context: Schedules are user-specific; implementing custom authentication would add unnecessary security and maintenance work.
- Decision: Use Clerk for authentication rather than implementing password/session management from scratch. FastAPI must verify trusted Clerk-issued identity before private data access.
- Tradeoffs: Faster and safer than rolling a custom auth system for this project, but adds an external dependency and requires a correct token-verification boundary between Next.js and FastAPI.
- Open implementation detail: exact token forwarding and verification approach must be checked against current Clerk documentation.

## DEC-006 — Auto-save after validation
- Status: Confirmed direction
- Context: User wants schedules to be saved without an extra confirmation step when AI interpretation is sufficiently complete.
- Decision: Auto-save only after all required fields pass schema and business validation. Ask clarifying questions for missing/ambiguous required fields. Show success only after persistence succeeds; allow editing/cancellation.
- Tradeoffs: Faster interaction, but the validity threshold must be precise and edits/cancellation must be supported.

## DEC-007 — Arrival and departure time intent
- Status: Confirmed direction
- Context: Requests may specify when the user needs to arrive or when they need to leave.
- Decision: Support both intents and clarify when the wording is ambiguous.
- Tradeoffs: More flexible natural language, but extraction schema and calculation rules must distinguish the two.

## DEC-008 — Web Push notifications
- Status: Confirmed direction
- Context: Page-only timers are unreliable when a tab is closed or a device sleeps.
- Decision: Prefer Web Push using a service worker, push subscription, and backend-triggered delivery. Keep an in-app schedule list as a fallback.
- Tradeoffs: Better suited to reminders from a website than a page-only timer, but requires permission, subscription lifecycle management, server-side scheduling, push keys, and browser/device support. Delivery is not guaranteed.
- Open implementation detail: scheduler/queue and push library remain undecided.

## DEC-009 — MySQL with SQLAlchemy
- Status: Confirmed direction
- Context: The user is familiar with MySQL and wants SQLAlchemy as the ORM.
- Decision: Use MySQL for relational persistence and SQLAlchemy for ORM/data access.
- Tradeoffs: Builds on existing familiarity and supports relational ownership/schedule relationships; requires explicit session/transaction management, migrations, and test database setup.

## DEC-010 — Next.js frontend
- Status: Confirmed direction
- Context: The website needs a modern interactive UI.
- Decision: Use Next.js. Exact version, component library, and deployment topology remain open.
- Tradeoffs: Good ecosystem and flexible rendering, with additional server/client boundaries to understand.

## DEC-011 — Auto-save after validation
- Status: Confirmed direction
- Context: The user wants schedules saved automatically when extraction is valid.
- Decision: Save only after required fields pass validation; clarify missing/ambiguous required data. Report success only after persistence succeeds.
- Tradeoffs: Faster flow, but validity rules, editing, cancellation, and failure recovery must be designed.

## DEC-012 — Arrival and departure intent
- Status: Confirmed direction
- Context: User language can specify when to arrive or when to leave.
- Decision: Support both; ask a clarification when the intent is ambiguous.
- Tradeoffs: More natural interaction but more validation and tests.

## DEC-013 — Learning plus usable MVP
- Status: Confirmed direction
- Context: The project is both a learning project and an application the user wants to use.
- Decision: Build in small end-to-end slices and explain architecture tradeoffs as the system grows.
- Tradeoffs: More deliberate than generating a large codebase all at once, but easier to understand, test, and maintain.

## DEC-014 — Deterministic time calculation buffers
- Status: Confirmed direction
- Context: Suggested departure and preparation-start times must use explicit, testable rules, with no invented durations.
- Decision: FastAPI calculates both recommendations from the stored target instant, time intent, known durations, and nonnegative `TRAVEL_BUFFER_MINUTES` / `PREPARATION_BUFFER_MINUTES` backend settings. Both buffers default to zero. A null duration remains unknown; unavailable calculations include a reason.
- Tradeoffs: Operators can configure consistent buffers through backend environment settings; per-schedule buffer editing is not part of this spec.

## DEC-015 - Spec 11 auto-save and retry identity
- Status: Confirmed direction
- Context: Spec 09 originally required explicit review and save, while confirmed auto-save decisions and Spec 11 require automatic persistence once complete and valid.
- Decision: In the Spec 11 assistant workflow, extraction results with missing or ambiguous required fields remain unsaved and retain known values for clarification. When the form becomes valid, the frontend submits through the existing authenticated schedule-create endpoint automatically. Manual create/edit remains explicitly submitted. Each assistant save attempt reuses a client-generated idempotency key on retries; the backend enforces uniqueness per Clerk user and returns the existing schedule for repeated requests.
- Tradeoffs: Correct retry behavior requires a nullable schedule column and unique constraint migration. Existing rows remain unchanged; clients omitting the key retain existing create semantics.

## DEC-016 - Spec 12 replaceable geocoding and selected location storage
- Status: Confirmed direction
- Context: Schedules need user-confirmed coordinates for future routing. Open-Meteo's geocoding results did not reliably cover named points of interest such as schools and businesses.
- Decision: Use TomTom Search API Fuzzy Search with `typeahead=true` through a replaceable backend service. This endpoint supports full POI/address results and predictive partial queries in one request. Keep `TOMTOM_API_KEY` in backend-only configuration. Persist the selected, validated location as a nullable JSON schedule value.
- Tradeoffs: TomTom requires a developer API key and is subject to its account quotas and terms. The provider remains behind the service boundary so it can be changed later. The dedicated TomTom Autocomplete endpoint returns query segments rather than final coordinate-bearing locations, so Fuzzy Search is used for this current result-selection UI.

## DEC-017 - Spec 13 replaceable traffic-aware routing
- Status: Confirmed direction
- Context: Deterministic arrival calculations need a travel duration based on explicitly selected coordinates, while provider details must remain replaceable and failures must not block schedule persistence.
- Decision: Preserve the existing schedule `location` as the selected destination and add a nullable, separately selected `origin_location`. Request a TomTom Routing API v1 route only when both are present and duration is missing on create, the user clears a known duration, or either selected endpoint changes. Omit unchanged duration fields from edit requests so preparation-only edits recalculate locally without another route call. Use server-side `TOMTOM_API_KEY`, `traffic=true`, and `computeTravelTimeFor=all`. Store validated estimate metadata and rounded-up whole-minute duration; failed routing leaves duration unknown. Recalculate deterministic departure, arrival, and wake times on writes and reads. Derive a late-traffic warning from the saved retrieval timestamp and intended departure; do not schedule future refreshes.
- Tradeoffs: Route lookup is synchronous when those inputs require a new estimate and may add up to the provider timeout to the request. The estimate reflects traffic data available at lookup time and is not a guarantee for the future event time. Arrival-intent wake suggestions can still use the target time when route duration is unknown, as explicitly required by the schedule workflow.

## DEC-018 - Spec 13 late estimate and intent-specific calculated times
- Status: Confirmed direction
- Context: Route lookups can complete after the planned travel time, and unknown route or preparation values should not remove otherwise valid schedule times.
- Decision: Preserve the user target instant. Store deterministic estimated arrival for departure-intent schedules only when travel duration is known; show an unknown-duration reason otherwise. For arrival intent with unknown travel, leave departure unavailable but permit a wake/preparation-start suggestion from target time and known preparation duration. Departure intent retains target departure and independently calculates wake-up when preparation is known. Derive a visible late-estimate warning from actual route retrieval time compared with intended departure; do not schedule background refreshes.
- Tradeoffs: Added one nullable calculated-arrival column and migration. The arrival-intent wake suggestion is based on the event target when route duration is unknown and must not be presented as a departure time.

## DEC-019 - Spec 13 time-conditioned routing and independent traffic comparisons
- Status: Confirmed direction
- Context: A route calculated at request time must not be presented as the traffic forecast for a later schedule, and TomTom's traffic metrics are not algebraically interchangeable.
- Decision: Use TomTom `departAt` for future leave-at schedules and `arriveAt` for future arrive-by schedules. For arrival intent, use the single arrival-conditioned request, then let deterministic calculation derive the departure from its duration; do not issue a feedback-loop re-request. Past targets use TomTom's current-time default. Use `travelTimeInSeconds` as the sole route duration. Validate each optional traffic metric independently; only display a delay when both its explicit `trafficDelayInSeconds` value and a positive `noTrafficTravelTimeInSeconds` comparison are present. Classify using those fields without requiring equality with the best-estimate, historical, or live comparison durations. Describe live/historical fields as comparison estimates available in the response, not proof that both changed the selected route duration.
- Tradeoffs: Future plans are time-conditioned by TomTom but remain estimates; historical patterns and known incidents/closures may be available differently by date and region. One bounded request avoids recalculation loops but cannot reconcile the provider's estimated travel time with deterministic app buffers.

## DEC-020 - Durable route refresh limits
- Status: Confirmed direction
- Context: Manual refreshes must be limited consistently across authenticated requests, workers, and restarts, including provider failures.
- Decision: Store each refresh attempt and a per-user serialization row in the application database. Reserve and commit the attempt before calling TomTom, count failures in both rolling limits, and only replace a saved estimate after a validated route succeeds. Return HTTP 429 with `Retry-After` for rate limits. A short in-progress lease releases a request abandoned by a worker crash.
- Tradeoffs: Adds a migration and retains attempt history for the rolling window; a cleanup job is not required for limit correctness but may be added if operational retention needs change.

## DEC-021 - Open-Meteo route-point weather buffers
- Status: Confirmed direction
- Context: Weather should adjust travel planning without modifying the selected route duration or counting the base travel buffer twice. The selected route stores endpoint coordinates but not route geometry.
- Decision: Query Open-Meteo hourly forecasts at the selected origin near planned departure and destination near estimated arrival. Use UTC hourly values. No route geometry interpolation or unsaved route sampling is used. Apply one weather buffer equal to the strongest condition found across both points: precipitation 2.5 to under 7.5 mm/hour adds 5 minutes; precipitation at least 7.5 mm/hour adds 10; snowfall at least 1 cm/hour adds 15; wind at least 50 km/h adds 10; WMO thunderstorm codes 95, 96, or 99 add 20. Conditions do not stack; the maximum is used. These thresholds are conservative application heuristics, not provider severity declarations.
- For `arrive_by`, forecast origin conditions at target arrival minus known route duration and the base travel buffer, and destination conditions at target arrival. For `leave_at`, forecast origin at the exact target departure and destination at target plus known route duration. Add the weather buffer separately to travel calculations: subtract it once from arrival-intent departure; add it once to departure-intent estimated arrival. Preserve departure target exactly. Unknown route duration prevents assessment.
- Store the validated assessment and retrieval/forecast timestamps in nullable schedule JSON. Provider errors, invalid values, missing hours, and dates outside the 16-day forecast window yield unavailable status and zero weather buffer. Schedule reads do not call Open-Meteo. Use a 4-second timeout per point, fetched concurrently.
- Tradeoffs: Endpoint-only samples are less representative than a complete route trace, which TomTom does not currently persist. A weather assessment is a forecast, not actual conditions or a travel-time guarantee. Persistence requires one nullable JSON column migration; no backfill is needed.
