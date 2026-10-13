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
