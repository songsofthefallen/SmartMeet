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
- Status: Superseded by DEC-023
- Context: Weather should adjust travel planning without modifying the selected route duration or counting the base travel buffer twice. The selected route stores endpoint coordinates but not route geometry.
- Historical decision: Spec 14 originally added weather minutes to deterministic travel time. Its thresholds and endpoint sampling remain useful, but this behavior is superseded by DEC-023. The nullable weather JSON column from revision `20261014_0008` remains in use and is not removed.
- Historical tradeoff: The original two-pass strategy and weather-minute adjustments could shift calculated times, which the advisory design no longer permits.

## DEC-022 - Per-user schedule names and uniqueness
- Status: Confirmed direction
- Context: Schedules need backend-generated defaults while retaining manual custom titles and preventing case-insensitive duplicates under concurrent writes.
- Decision: Treat a blank/omitted create title as a backend default. Persist a per-user next-number counter and advance it in the same transaction as schedule creation; lock the counter row during allocation so deleted schedules do not cause reuse and concurrent creates serialize. Store a trimmed, case-folded title key with a unique `(clerk_user_id, normalized_title)` constraint. Keep title extraction out of the AI contract; the assistant uses the backend returned title. Conflicting pre-existing names stop the migration with the affected user and schedule IDs; operators resolve them explicitly before retrying.
- Tradeoffs: Adds one schedule column, one per-user counter table, and a migration. Case-folded keys use application normalization, while the database unique index is the final race-safe enforcement layer. Assistant retries keep using the existing idempotency key.

## DEC-023 - Weather advisories do not alter schedule calculations
- Status: Confirmed direction
- Context: Forecasts can warn users about conditions but cannot establish a measured delay at their trip time or across the whole route.
- Decision: Continue assessing Open-Meteo weather at the selected origin near deterministic departure and destination near deterministic arrival. Apply Spec 14's rain, snow, wind, and thunderstorm thresholds as endpoint advisories with the condition and forecast hour. Never pass a weather value into time calculation. Preserve route duration, traffic data, and user-configured travel/preparation buffers. Show unavailable weather distinctly from no detected concerns; explain endpoint-only coverage and use cautious language that conditions may affect a trip.
- Persistence: Keep the nullable schedule JSON field. New assessments store advisories and forecast details without weather-buffer values. Read legacy buffer/timing fields for compatibility but exclude them from new API responses. No migration or deletion of old JSON data is required.
- Tradeoffs: Forecasts remain hourly, limited to selected endpoints, and unavailable outside provider coverage. An advisory may miss conditions elsewhere on the route and is not a delay estimate or guarantee.

## DEC-024 - Traffic-affected route portions use provider section indexes
- Status: Confirmed direction
- Context: Aggregate route delay alone does not explain where traffic reports occur, but section delay values are incident details and are not a decomposition of aggregate route delay.
- Decision: Request TomTom `TRAFFIC` and `IMPORTANT_ROAD_STRETCH` sections with polyline representation. Associate road names/numbers only where their inclusive route point-index ranges overlap a traffic section; use indexed route points as approximate coordinates when available. Preserve each provider incident's delay and category separately from `summary.trafficDelayInSeconds`. Missing road, coordinate, category, or delay fields remain unavailable, and an empty section list is described only as no affected portions reported for that estimate.
- Persistence/UI: Keep enriched sections inside the existing travel-estimate JSON value. Render a list in the existing schedule detail view; no schema migration or map dependency is needed. The UI has no route map, and no map highlighting is implemented.
- Tradeoffs: TomTom may omit road stretches, point indexes, geometry, or incident values by route or region. The display can therefore identify only the most specific provider-verified information in each response and is not a full-route inventory. A reverse-geocoded nearby address is not necessarily the affected road, so the app does not automatically make per-section reverse-geocoding calls.

## DEC-025 - Traffic display groups sections by verified road labels
- Status: Confirmed direction
- Context: A route can report multiple traffic sections on the same road, while each section remains a distinct traffic event. TomTom road-number text may contain multiple values, including numeric-only strings whose local significance is unclear without country-specific context.
- Decision: Group traffic sections by normalized provider road-name identity, but preserve every section as a separate event and retain its incident type and delay. Keep unnamed sections in a separate `Road name unavailable` group. Display the road name as the primary label and only alphanumeric road-number designations as secondary labels; suppress numeric-only strings in the UI while retaining all original values in backend estimate data.
- Tradeoffs: The grouping identifies the road, not whether incidents at different positions are the same physical event. It must not collapse events or aggregate their delay values. The display filter is intentionally conservative and may omit valid numeric-only road-number text.

## DEC-026 - Per-road incident-delay summaries remain descriptive
- Status: Confirmed direction
- Context: Users need a concise summary of provider-reported incident delays while preserving the independently calculated route-level traffic delay.
- Decision: Keep every traffic section as an individual incident within its verified-road group. Show the count and type breakdown, and sum only valid nonnegative integer incident delays (including zero). If any event delay is absent or invalid, mark the group sum incomplete and disclose the unavailable count; do not silently count unknown values as zero. Label the sum as combined reported incident delays and state that it is not additional travel time or a decomposition of the route-level delay.
- Tradeoffs: Provider incident reports can overlap or describe portions of conditions reflected in the overall route estimate. Their combined duration is informational and must not be used for schedule calculations.

## DEC-027 - Reverse-geocoded traffic locations remain approximate
- Status: Confirmed direction
- Context: TomTom can provide coordinates for a traffic section without a reliable `IMPORTANT_ROAD_STRETCH` road-name association.
- Decision: Keep route metadata as the only source of verified road names. For sections with no road name or conflicting overlapping road names, optionally call TomTom Search API v2 reverse geocoding at a route-section midpoint. Store the returned street name separately from `road_names`, mark its source as reverse geocoding, and display it only as “Near …” with an “Approximate location” label. Never use this label as a road-group identity. Bound calls per route estimate, use a short timeout and radius, and cache results including misses; lookup failures leave the location unavailable without failing routing.
- Tradeoffs: The reverse geocoder identifies a nearby street at a coordinate and cannot prove that it is the affected road. The process-local cache is lost on restart and does not deduplicate simultaneous lookups across workers; per-estimate caps keep provider use bounded.

## DEC-028 - Approximate traffic locations may group unnamed incidents
- Status: Confirmed direction
- Context: An incident can have a useful reverse-geocoded location even when TomTom has no reliable road-name match for the traffic section.
- Decision: Use verified route road names as the primary grouping key. If absent, group by the normalized reverse-geocoded label, render it as “Near …”, and visibly mark the group as approximate. Keep fallback text in its own schema field and never promote it to verified road metadata. Unresolved sections remain in `Road name unavailable`; delay totals continue to aggregate individual incident reports within each display group.
- Tradeoffs: Grouping by nearby reverse-geocoded text means incidents at separate points on a long road may share a display group. Each incident remains individually listed and no incident identity is inferred from the group.
