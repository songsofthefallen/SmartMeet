# Architecture Context — Deadline Notifier

## Status
This is a proposed architecture, not a description of a fully implemented system. Keep undecided technologies and behavior marked as proposed.

## Confirmed Direction
- Frontend: Next.js.
- Backend: Python + FastAPI.
- Database: MySQL.
- ORM: SQLAlchemy.
- Authentication: Clerk, rather than implementing password/session management from scratch.
- AI integration: provider/model configurable; current experimentation used an OpenAI-compatible client with OpenRouter.
- Notifications: use a reliable web push approach suitable for a website, rather than relying only on timers in an open page.
- Schedule intent: support arrival-time and departure-time wording, clarify when intent is ambiguous.
- Saving: automatically save once required fields pass validation.

## Proposed System Flow
Next.js browser UI
→ authenticated Next.js/FastAPI request boundary (exact deployment/proxy arrangement undecided)
→ FastAPI router
→ request/schema validation
→ AI extraction service
→ Pydantic and domain validation
→ clarification when required
→ schedule service
→ saved-place lookup and external data providers as needed
→ deterministic time calculation
→ database persistence
→ reminder scheduling mechanism
→ browser notification delivery path

## Responsibilities

### Next.js Frontend
- Authentication UI and protected pages.
- Collect natural-language schedule input.
- Show loading, clarification, success, and error states.
- Display extracted intent, calculated estimates, and saved schedules.
- Support editing and cancellation.
- Request browser notification permission only in a user-understandable context.
- Never hold provider secrets.
- Use server/client boundaries intentionally; browser APIs such as Notification require client-side code.

### FastAPI API Layer
- Validate request shapes.
- Verify user identity from a trusted authentication integration.
- Enforce per-user access to schedules.
- Call services and return consistent response shapes.
- Avoid embedding domain calculations in route handlers.
- Do not trust a user ID supplied in a request body as proof of identity.

### Authentication (Clerk)
- Use Clerk for sign-in/sign-up and identity rather than building a custom authentication system.
- The Next.js frontend should use Clerk's supported Next.js integration.
- FastAPI must independently verify a trusted Clerk-issued token or another explicitly documented server-to-server identity mechanism before serving private data.
- Never trust a user ID supplied in a request body or an unsigned identity header.
- Keep authorization in the backend: every schedule query and mutation must be scoped to the authenticated Clerk user ID.
- Exact token forwarding, verification library/configuration, and local development setup must be confirmed against current Clerk documentation before implementation.

### AI Extraction Service
- Convert natural language into constrained structured intent.
- Interpret time intent as arrival, departure, or unknown.
- Identify missing fields and ambiguities.
- Do not invent coordinates, traffic durations, weather, or provider facts.
- Treat user input as data, not as instructions that override the extraction task.
- Be replaceable independently from scheduling logic.

### Schedule Service
- Enforce required fields and domain rules.
- Resolve saved-place aliases.
- Orchestrate provider calls.
- Calculate departure/wake-up times using explicit rules.
- Automatically persist only after required fields pass validation.
- Update/cancel reminder jobs when schedules change.

### Repository / Persistence
- Isolate database operations from route handlers and calculations.
- Enforce ownership boundaries.
- Use transactions for related schedule/reminder updates where supported.
- Database and ORM remain undecided; do not assume SQLite, PostgreSQL, SQLAlchemy, or another choice until recorded.

### External Provider Adapters
- Wrap AI, geocoding/routing, weather, and notification dependencies behind clear interfaces where useful.
- Apply timeouts, error mapping, and bounded retries where safe.
- Make unavailable data explicit rather than treating it as accurate.

### Reminder Scheduling and Web Push
- Prefer Web Push with a service worker and push subscription so reminders can be delivered without relying on a page timer remaining active.
- This still depends on browser/device support, user permission, connectivity, subscription validity, and push-service behavior; do not promise perfect delivery.
- A backend durable scheduler must trigger due reminders and send push messages. The scheduler/queue technology remains undecided.
- Store subscriptions securely and associate them with the authenticated user; support subscription expiration/revocation.
- Persist reminder state and make delivery idempotent where feasible.
- Schedule edits/cancellations must update or invalidate pending reminders.
- Keep an in-app schedule view as a fallback when notifications are unavailable or permission is denied.

## Proposed Core Data Concepts
These are conceptual entities only; exact schema and database technology are undecided.

- `User`: identity reference and preferences.
- `SavedPlace`: user-owned alias, display name, address/coordinates, timezone where applicable.
- `Schedule`: user reference, description, origin/destination, intended time, time intent, timezone, status, and timestamps.
- `TravelEstimate`: duration, provider, retrieval time, and traffic inclusion status.
- `Reminder`: schedule reference, type, due time, delivery status, and idempotency identifier.
- `UserPreference`: preparation duration, arrival buffer, timezone, and notification preferences.

Avoid persisting redundant provider data unless it supports explanation, debugging, or historical context.

## Time Calculation Invariant
The user's intended local event time and timezone are the source of truth. The schedule's intent must distinguish arrival from departure.

For an arrival-time event:
- `departure_time = arrival_time - travel_duration - arrival_buffer`
- `wake_time = departure_time - preparation_duration`

For a departure-time event:
- `departure_time = user_requested_departure_time`
- `wake_time = departure_time - preparation_duration`

These are proposed starting formulas. Define the meaning of each buffer before implementation. Do not add a traffic/weather buffer twice if the routing provider's duration already accounts for it. If travel duration is unavailable, do not fabricate a precise departure estimate.

## Reliability and Security Invariants
1. Never trust raw model output without schema and business-rule validation.
2. Never trust external API output without checking status, shape, units, and timestamp.
3. Do not claim a traffic/weather-adjusted estimate if the lookup failed.
4. Schedule edits/cancellations must update or invalidate pending reminders.
5. Reminder delivery must be idempotent where possible.
6. Timezone and daylight-saving behavior must be explicit; use timezone-aware datetimes.
7. Provider keys remain server-side and outside source control.
8. Every schedule query/mutation must be scoped to the authenticated user.
9. The app must distinguish estimates from guarantees.
10. Browser notifications are permission-dependent and may not be delivered while the app is closed unless a suitable push architecture is implemented.

## Error Handling
- AI unavailable: explain the failure and allow retry or manual entry.
- Required fields missing: ask a targeted clarification question.
- Time intent ambiguous: ask whether the time is arrival or departure.
- Place unresolved: ask the user to choose or enter a location.
- Routing unavailable: show no precise travel-adjusted estimate unless a documented fallback is selected.
- Weather unavailable: omit weather adjustment and disclose that data is unavailable.
- Notification permission denied/unsupported: show the schedule in-app and explain the limitation.
- Authentication failure: reject protected requests.
- Persistence failure: do not claim the schedule was saved.
- Notification provider unavailable: record failure and retry according to a defined policy.

## Open Architecture Decisions
- Clerk token forwarding and verification details between Next.js and FastAPI.
- Deployment topology and CORS/CSRF strategy where applicable.
- Durable reminder scheduler/queue and Web Push implementation details.
- Maps/geocoding/traffic provider.
- Weather provider.
- Default preparation and arrival buffers.
- Whether a user must provide origin/destination for every schedule or can use aliases.
