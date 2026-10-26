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

## DEC-029 - Past schedules do not refresh live route or forecast data
- Context: A schedule target can pass while the saved schedule remains active. A current-time route request or a new weather forecast would misrepresent conditions for that intended trip.
- Decision: Compare the aware intended departure instant (calculated departure when available, otherwise the target instant) with current UTC time at each provider assessment and response. Past schedules skip route and weather requests, retain stored historical estimates, and reject manual route refresh before reserving a refresh attempt. Label past schedules and retained estimates as historical reference only. Editing a target into the future resumes normal routing and weather assessment.
- Persistence: Past status is derived from the target instant; no schema or migration change is needed. Provider estimate JSON remains unchanged when a schedule becomes past.
- Tradeoffs: Past status can change as time passes without a database write, so it is computed on reads and displayed from the API response.

## DEC-030 - AI extracts location descriptions; users confirm TomTom matches
- Context: Natural-language schedules may state distinct origins and destinations. AI text is not a trusted source for coordinates or a unique real-world place.
- Decision: Add required-nullable `origin_description` and `destination_description` fields to the extraction contract. Keep extraction limited to user-stated text. The authenticated frontend uses the existing backend TomTom Search endpoint to fetch candidates and requires explicit user selection before auto-saving any stated location. Empty results and provider failures leave locations unselected. Editing a location description clears its confirmed selection; unrelated edits retain selected `LocationSelection` values.
- Validation/persistence: Locations remain optional under current schedule rules. If a description is extracted, automatic saving waits for its selection; a user can still save a schedule without an optional location, but no unresolved text is persisted as a confirmed coordinate. Existing schedule JSON fields store selected places, so no schema or migration change is needed.
- Scope: No routing, traffic, weather, or deterministic time-calculation behavior changes. The requested spec is in `15-ai-location-extraction.md`, whose internal heading currently says “Spec 16”; implementation follows the content at that path.

## DEC-031 - Explain route calculation timeouts without fabricating estimates
- Context: Long route calculations can exceed the routing provider's compute limit, while the adapter's short request timeout can fail first. A failed manual refresh must not erase a previously saved estimate or be presented as a current estimate.
- Decision: Allow up to 35 seconds for TomTom route calculation, classify only known safe failure categories (timeout, provider compute limit, explicit no-route result), and return actionable backend-authored messages. Surface the safe timeout message in the frontend. Keep provider payloads private and preserve the stored estimate on refresh failure. Do not synthesize a duration or route when TomTom cannot provide one; users can enter travel duration manually.
- Tradeoffs: Slow provider requests may take longer to resolve, and hosting/proxy timeouts may still terminate requests earlier. Exact live failures cannot be attributed without provider response logs.

## DEC-032 - Confirm before saving when no drivable route is found
- Context: Schedule creation previously saved successfully with no route or weather estimate when TomTom explicitly reported that no route existed. Users only encountered an actionable explanation if they later attempted a manual refresh.
- Decision: On create, when routing returns an explicit no-route result, return a confirmation-required response before persistence. The UI explains that traffic and weather estimates will be unavailable and offers saving without a route estimate or reviewing locations. A confirmed retry skips routing; schedules without route data continue using existing unavailable behavior. Other provider failures keep their current non-blocking create behavior.
- Persistence: The confirmation flag is request-only. No migration or schema column is added.

## DEC-033 - Route duration gates trip-time weather forecasts
- Status: Superseded by DEC-034
- Context: Weather forecasts are queried by endpoint coordinates and by the calculated time the schedule is expected to reach each endpoint. Without a route duration, departure/arrival forecast times cannot both be determined, even though origin and destination coordinates are present.
- Historical decision: Initially kept endpoint forecasts unavailable when travel duration was unknown. This did not satisfy the requested independent weather assessment and is superseded.

## DEC-034 - Assess endpoint weather independently of route duration
- Context: Weather lookup needs endpoint coordinates and forecast times, but a missing route estimate does not make weather unavailable. Exact departure and arrival times cannot be derived without a duration.
- Decision: When duration is known, retain forecasts near calculated departure at the origin and arrival at the destination. When duration is unknown, assess both endpoints at the intended event instant and label the results as event-time endpoint snapshots, not trip-timed forecasts. Weather does not depend on traffic observations or route availability.
- UI: When no route estimate exists, hide the upcoming Travel and traffic card and offer a weather-only refresh action. Treat an explicit no-route response from a route refresh as an informational status instead of an error alert. Preserve the past-schedule unavailable-reference behavior.
- Persistence: No schema or migration change; reuse the existing weather estimate JSON.

## DEC-035 - Keep AI clock times separate from timezone offsets
- Context: The AI schema accepts offset-bearing clock times even though extraction asks for local wall time. Rejecting an offset mismatch by clearing the clock value made a supplied time appear missing.
- Decision: Strip and retain the AI-provided offset separately, preserve the wall-clock time, resolve the intended timezone from an explicit IANA timezone or a time-bound departure origin / arrival destination, and otherwise use the selected timezone. A general trip-place mention does not set the event timezone. Validate the model offset against the date-specific IANA offset; when it disagrees, use the local clock and IANA rules to obtain the UTC instant rather than corrupting the clock value.
- Ambiguity: If a time-bound location establishes local time but its timezone cannot be resolved from an explicit zone, recognized IANA city, or model zone, retain the selected timezone and report timezone ambiguity. Existing DST gap/repeated-time clarification remains in force.
- Persistence: No schema or migration change.

## DEC-036 - Persist TomTom route choices in the existing travel estimate
- Context: Spec 16 needs multiple driving route choices and must keep the selected route's duration, incident data, and downstream weather timing together while preserving older schedules.
- Decision: Request up to five TomTom alternatives and store validated route summaries, route-specific geometry, traffic sections, distance, and road labels alongside the selected route fields inside the existing nullable `travel_estimate` JSON. The first provider route is the initial selection. An authenticated schedule update can select one of the stored route IDs; the backend atomically replaces selected estimate fields, updates travel duration, recalculates schedule times, and reassesses weather. Route identity is provider-response index scoped to that saved estimate and is replaced on route refresh or endpoint/time changes.
- Compatibility: Existing estimate JSON without alternatives remains readable. No relational schema change or migration is required. Manually entered durations clear provider estimate metadata as before.
- Tradeoffs: Route alternatives are saved with the estimate snapshot and can be selected without another provider request. A refreshed route set replaces prior IDs. The UI draws a simple geometry preview from provider coordinates; this is not a navigation map.

## DEC-037 - Keep route status and retry visible without an estimate
- Context: Schedule detail previously hid the Travel and traffic card without a saved route estimate and offered only a weather refresh, so routing failures during create could leave users with no visible route recovery path.
- Decision: Show the travel/traffic status card whenever both confirmed endpoints are saved, even if routing is unavailable. For upcoming schedules, expose a route-estimate action when no estimate exists; keep the saved-estimate refresh cooldown behavior unchanged. Show the route chooser for any returned route set, including the single-route case, so Spec 16 is discoverable.
- Compatibility: Location-free schedules keep the existing compact UI. Past schedules retain historical handling and cannot request a live route.

## DEC-038 - Preview and choose routes before creating a schedule
- Context: Showing alternatives only after schedule creation prevents users from choosing a route before saving and makes a failed initial estimate look like a missing travel-duration entry.
- Decision: Add an authenticated, non-persisting route-options request that uses the schedule's target time and intent. In the create form, load and display route choices after both confirmed endpoints, target time, and intent are available. Require a route selection before normal create and before assistant autosave; users can explicitly opt to save without an estimate if routing fails. Create repeats the validated provider lookup and applies the submitted route ID to the matching returned option, rejecting stale/missing route IDs rather than silently substituting another route.
- Tradeoff: Route lookup occurs once for preview and once for create to keep provider data validated server-side without adding durable preview state or a new database migration.

## DEC-039 - Compare route geometries over a TomTom road map
- Context: The existing route chooser rendered each geometry as a line on a blank SVG, so routes with the same road labels were difficult to distinguish geographically.
- Decision: Request one TomTom Static Image road map for the combined route geometry bounds and overlay each route in a distinct color with shared start/destination markers. Show this comparison in both the pre-save chooser and saved schedule details. Fetch images through an authenticated backend endpoint; keep the TomTom key server-side and fall back to route details when map retrieval fails.
- Tradeoffs: This uses a bounded extra map image request per route-comparison view. Familiar map labels and nearby places depend on TomTom coverage and are not guaranteed. No saved schema or database migration is needed.

## DEC-040 - Preserve route endpoints and add selected-route map navigation
- Context: Long TomTom route geometries were truncated by taking only their first 500 points, which could omit the destination and produce misleading route bounds. A per-card miniature route drawing also compressed the map-shaped preview without adding useful geographic context.
- Decision: When route geometry exceeds 500 points, sample evenly across the full provider path and retain both endpoints. Keep one shared road-map comparison with explicit A/Origin and B/Destination markers, and remove the miniature SVG from route cards. Add bounded zoom, drag-to-pan, reset controls, and a selected-route nearby landmark overlay from TomTom Search Along Route for hospitals and schools. Validate/cap provider results and cache them per route geometry for six hours; a landmark lookup failure leaves route selection usable.
- Persistence: Route geometry is already stored in travel-estimate JSON. Landmarks are fetched on demand and are not persisted. No migration is required.
- Tradeoffs: Nearby POIs depend on TomTom's regional data and may be unavailable or omitted. Landmarks describe proximity to the selected route and are not guaranteed stops or navigation guidance.

## DEC-041 - Separate route comparison from saved-route viewing
- Context: Route options and route-changing radio controls remained in saved schedule details, while edit mode did not offer a route preview. This made saved routes interactive and left route choice unavailable during edits.
- Decision: Use the comparison map and selectable route list only in create/edit forms. Saved schedule details render only the persisted selected route and hide route selection controls. Keep the route-estimate refresh and weather-advisory refresh actions in saved details for future active schedules with confirmed endpoints; existing refresh limits and past-schedule restrictions apply. Editing reuses the saved options while its routing context is unchanged; changes to endpoints or scheduled time load fresh options. The preview follows the selected option immediately. On save, a changed routing context is recalculated by the backend and the chosen route is applied before dependent times and weather are recalculated. A route-only choice uses the saved, validated route option snapshot.
- Compatibility: Existing saved schedules with alternatives use `selected_route_id`; if absent or unmatched, show the first available option as a compatibility fallback. No migration is needed.
- Tradeoffs: Edits to endpoints or scheduled time perform the existing server-side route recalculation on save so browser preview data is not trusted as the persisted estimate. Selecting an alternative from an unchanged saved route set does not add a routing request or bypass route-refresh limits.

## DEC-042 - Persist reminders in a MySQL-backed queue
- Status: Confirmed
- Context: The application already uses MySQL and SQLAlchemy, and no separate queue infrastructure or notification delivery provider exists.
- Decision: Persist wake and departure reminder instances in a `reminders` table in the same transaction as schedule create/edit/cancel. Store UTC trigger instants plus the schedule's IANA timezone. Enforce uniqueness on schedule, reminder type, and trigger instant. Preserve sent rows and reconcile pending rows on schedule changes. A standalone worker polls this table.
- Tradeoffs: This avoids adding Redis or a broker, but requires a separately deployed worker and notification provider. Reminder lead times are undefined, so triggers use the calculated wake/departure instants themselves. Past instants are not queued.

## DEC-043 - Claim reminder work with expiring database leases
- Status: Confirmed
- Context: Multiple worker processes and abrupt restarts must not lose due reminders or concurrently process the same current claim.
- Decision: Add a UUID claim token, lease expiry, and next-attempt instant to reminder rows. MySQL workers claim due pending rows in a transaction using `SELECT FOR UPDATE SKIP LOCKED`; an abandoned claim is recovered after lease expiry only while attempts remain. At the configured maximum, an expired final claim is marked failed rather than reclaimed indefinitely. Validate schedule status/timezone/calculated instant before invoking the injected handler. Increment attempts on claim, sanitize persisted errors, and retry temporary failures with capped exponential backoff. Mark sent only when the handler explicitly confirms delivery; the default no-provider handler never confirms.
- Tradeoffs: Leases bound crash recovery but do not provide exactly-once external delivery if a provider accepts a message and the worker crashes before recording confirmation. The reminder ID should be used as an idempotency key when a future provider supports it.

## DEC-044 - Encrypt Web Push subscriptions and treat provider acceptance as confirmation
- Status: Confirmed
- Context: Spec 18 connects the reminder lease worker to browser push services while keeping endpoint tokens and subscription encryption keys private.
- Decision: Store each full subscription payload encrypted with a backend-only Fernet key. Index it by SHA-256 endpoint hash and associate it with the verified Clerk subject; deletion only affects the authenticated owner's row. Use pywebpush with server-side VAPID credentials. Remove subscriptions on provider 404/410. Retry throttling, server errors, and transport failures; fail permanent rejections and missing subscriptions. If at least one endpoint accepts a notification, confirm the reminder instead of retrying successful endpoints and risking duplicates.
- Delivery guarantee: HTTP acceptance by a push service is not device display or user receipt. The database lease prevents simultaneous live claims but cannot prevent duplicate external sends if a provider accepts a request and the worker crashes before recording sent status. A partial multi-device delivery confirms after one acceptance, so another endpoint may miss that instance.
- Tradeoffs: Operators must securely back up the encryption key; replacing/loss of it makes stored subscriptions unreadable. pywebpush is maintained upstream but PyPI currently identifies one maintainer.

## DEC-045 - Manage browser push subscriptions from Dashboard
- Status: Confirmed
- Context: Spec 18 exposes authenticated subscription registration/removal and a one-off test endpoint; the browser needs a user-controlled permission and lifecycle interface.
- Decision: The signed-in Dashboard registers `/service-worker.js`, requests notification permission only after the user selects Enable, reuses an existing browser subscription when possible, and registers its `toJSON()` payload through the existing authenticated API utility. Disable removes the backend endpoint and browser subscription with explicit partial-failure feedback. Push payloads display through the worker and notification clicks focus/navigate to same-origin `/schedules`.
- Configuration: expose only `VAPID_PUBLIC_KEY` as frontend `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; private VAPID and subscription-encryption keys remain in backend configuration.
- Tradeoffs: browser permission, subscription availability, push-service acceptance, and device display remain outside the application's guarantees. No reminder scheduling or schema changes are introduced.

## DEC-046 - Preserve permanent reminder failures and catch up overdue triggers
- Context: Reminder reconciliation runs for ordinary schedule edits as well as timing changes, and a standalone worker may be offline when an already scheduled instant passes.
- Decision: Keep a failed reminder failed while its schedule/type/UTC trigger identity is unchanged; an edit that creates a different trigger creates a distinct pending reminder. Preserve the existing lease worker's catch-up behavior: when it restarts, it processes overdue rows as soon as possible if the schedule is still active and its calculated trigger still matches. Schedule creation/edit still omits triggers already in the past.
- Delivery limit: Catch-up is best effort and depends on the worker, active schedule, valid subscriptions, and push service. A provider acceptance is not proof of device display, and lease recovery cannot guarantee exactly-once sending.
- Persistence: No schema or migration change.

## DEC-047 - Validate push worker configuration before claiming reminders
- Context: VAPID or subscription-encryption configuration errors discovered during delivery could make a reminder permanently fail, and one malformed encrypted subscription could abort delivery to every device for that user.
- Decision: Validate worker VAPID key pairing, subject URI, and Fernet key before opening the worker loop. Reject malformed browser key material at API validation and skip malformed stored subscriptions independently, logging only a subscription ID and fixed diagnostic category. Keep push acceptance behavior unchanged.
- Tradeoffs: A worker with incomplete push configuration exits until corrected; it does not consume attempts or fail queued reminders. Damaged subscriptions remain stored for diagnosis and are ignored until repaired or removed. No schema or migration change.

## DEC-048 - Keep native reminder text concise
- Status: Confirmed
- Context: Chrome and Windows control native notification layout and can clip long bodies; detailed schedule context is available after opening the linked schedule.
- Decision: Put the event name and action in the title. Keep the body to the known departure time and destination for wake reminders; for leave reminders include destination and, when available, arrival time or travel duration. Omit unknown values, cap long labels at word boundaries, and show only the same title/body in Settings with an approximate-layout note.
- Tradeoffs: Preparation duration and other schedule fields remain on the schedule page instead of being repeated in the native notification. The preview cannot guarantee the final platform layout or display.

## DEC-049 - Reuse TomTom static maps for saved-place pin selection
- Status: Superseded for the Saved Places picker by DEC-050; static images remain in use for schedule route previews.
- Context: Saved Places Phase 2 needs a map for manual pin placement, and the existing application already uses TomTom's server-side Static Image API for schedule route previews. No interactive map SDK is installed.
- Decision: Render the pin picker through the existing server-side TomTom static-image adapter. The browser uses a bounded Web Mercator viewport transform for map clicks and pin movement, plus explicit pan/zoom controls. Keep the TomTom key server-side; do not add another map provider, SDK, or dependency. Request reverse geocoding only after the user places/adjusts a pin or explicitly invokes current location, and allow saving coordinates if no address is returned.
- Privacy and cost: Browser coordinates are obtained only after clicking the location button; no coordinates are persisted until user confirmation/save. Do not log coordinates. Each map viewport refresh can consume one existing TomTom Static Image request; reverse geocoding uses the existing TomTom API key and per-API account allowance. Avoid polling and debounce viewport refreshes.
- Persistence: `location_source` accepts `tomtom_search`, `gps`, or `map_pin`. Existing VARCHAR storage accommodates these values; no migration is required.

## DEC-050 - Use TomTom Maps SDK for interactive saved-place selection
- Status: Confirmed
- Context: Static images cannot support continuous map panning or interactive zoom. The project uses Next.js 16 with Turbopack and already uses TomTom for geocoding, routing, and route-preview imagery.
- Decision: Use the official `@tomtom-org/maps-sdk` with its dark street style. Keep a fixed center marker over the interactive map; MapLibre drag gestures pan the map and its center events supply the saved coordinates. Disable built-in wheel zoom and zoom smoothly around the map center; keep accessible zoom buttons. Reverse-geocode after map movement settles and again on confirmation when needed. Use the official MapLibre worker files copied from the installed package before Next.js dev/build because Turbopack does not emit those workers itself.
- Security and setup: the map SDK needs a browser-facing key, which is readable by site visitors. Configure a separate restricted Maps SDK key as `NEXT_PUBLIC_TOMTOM_MAPS_API_KEY`; never reuse or expose backend `TOMTOM_API_KEY`. The workspace has a backend key but no browser SDK key configured.
- Tradeoffs: map tiles and style requests go directly from the browser to TomTom and consume the account's SDK allowance. A restricted browser key and TomTom account/API permissions are required for live map rendering. No Saved Places API, database schema, or migration changes are needed.
## DEC-051 - Dark-only SmartMeet visual foundation

- Decision: use the existing semantic CSS token roles for a dark-only SmartMeet interface with ink and slate surfaces, cool-blue actions and navigation, and distinct accessible status colors. Keep Tailwind v4's CSS-first `@theme inline` mapping and use Lucide React for interface icons.
- Shared authenticated routes use an App Router route group so Dashboard, Schedules, Saved Places, and Settings share navigation without changing their public URL paths. Clerk-protected return destinations take precedence; Dashboard is the fallback after sign-in or sign-up.
- Scope for the first design phase is the global design foundation, authenticated shell/navigation, and route shells. Existing schedule, notification, Saved Places, route, weather, and map behavior remains in place.

## DEC-052 - Report browser subscription and account registration separately
- Context: Web Push exposes the current browser's `PushSubscription`, and the backend supports authenticated registration and removal, but no read endpoint to check whether an existing browser subscription is registered to the current SmartMeet account.
- Decision: Settings show browser permission, local browser subscription, and account registration as distinct states. Existing local subscriptions remain "not verified" for the account until the authenticated registration call succeeds in the current page session. A test push is available only after that confirmed registration.
- Consequence: Returning users with an existing browser subscription may need to select Register this browser once per page session before sending a test. Do not infer backend registration or delivery from browser permission alone.