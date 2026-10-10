## Current Spec

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
