## Current Spec

**Spec 07 - Connect Schedule UI to API** is implemented. The schedule workspace now loads persisted schedules and uses the authenticated API for details, create, update, and cancel operations. UI success states follow confirmed API responses.

### Scope and implementation

- Added `lib/schedule-api.ts` for Bearer-authenticated schedule API calls, runtime response validation, and safe messages for validation, session, missing-record, server, and network errors.
- Replaced the schedule mock fixtures and local-only mutations with API requests. Loading, API failure, empty, success, save, and cancel states reflect server responses; failed requests do not update local schedule data or report success.
- Date/time input is converted using the selected IANA timezone to an offset-aware instant; nonexistent local times are rejected. The timezone selector lists browser-supported IANA zones with current GMT offsets and defaults to Asia/Manila. No departure or wake-up calculations were added.
- Follow-up timezone fix: request datetimes are normalized to UTC before persistence, and responses serialize naive MySQL DATETIME values as explicit UTC. This corrects Manila 08:00 being returned as a timezone-less midnight value; no schema migration was needed.
- Expanded FastAPI CORS from GET-only to the required GET, POST, and PATCH methods. `FRONTEND_ORIGINS` remains an explicit allowlist; request headers remain limited to Accept, Authorization, and Content-Type; credentials remain disabled. Added preflight tests for the configured local origin and rejection of an untrusted origin.
- No database schema, ownership enforcement, or authentication verification changes were made.

### Changed files

- `app/schedules/schedule-workspace.tsx` - loads and mutates schedules through the API, with server-confirmed UI state and a timezone selector.
- `backend/schemas.py` - normalizes submitted timestamps to UTC and serializes stored UTC values with an explicit UTC marker.
- `backend/tests/test_schedules.py` and `backend/tests/test_schedule_api.py` - cover timezone normalization and API timestamp round trips.
- `lib/schedule-api.ts` - typed authenticated API client and response/error validation.
- `backend/main.py` - allows only the API's required cross-origin methods for configured origins.
- `backend/tests/test_health.py` - verifies allowed schedule preflight and rejected untrusted origin.
- `context/progress-tracker.md` - records Spec 07 results and outstanding verification.

### Verification results

- `python -m pytest -p no:cacheprovider` from `backend/`: **passed, 37 tests**.
- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**; `/schedules` remains Clerk-protected and dynamically rendered.
- A local interactive browser workflow was not verified: `npm run dev` exited with `spawn EPERM`; `npm run start` found port 3000 already in use, and browser discovery returned no available browser.
- A Manila 08:00 create/read/update/cancel round trip passed against configured MySQL using a generated test Clerk key and an outer transaction rolled back after verification; no schedule row was retained. The response consistently returned the instant as 00:00Z, which displays as 08:00 in Asia/Manila. This verifies the database/API path, not a real Clerk browser session.
- API preflight behavior is covered by backend tests. Production frontend-origin configuration and live browser CORS behavior remain deployment-specific and unverified. `git diff --check` passed.

### Next step

Spec 07 is complete. Stop here; proceed only to the next explicitly requested spec.

## Completed Specs

### Spec 06 - Schedule API

Implemented and verified with authenticated `POST`/`GET /schedules`, `GET`/`PATCH /schedules/{id}`, and `POST /schedules/{id}/cancel`. All reads and mutations are scoped to the verified Clerk subject; the owner is never accepted from the client. Missing and other-user records share the same 404 response. Mutations commit, refresh, and safely roll back on SQLAlchemy persistence failures.

**Changed files:** `backend/main.py`, `backend/routers/schedules.py`, `backend/tests/test_schedule_api.py`, and this tracker.

**Recorded verification:** backend suite passed with 34 tests at Spec 06 completion. API tests used signed test JWTs and isolated in-memory SQLite. MySQL was not modified or exercised for that spec. CORS allowed only GET at the time; Spec 07 expands this allowlist for schedule writes.

### Spec 05 - Schedule Interface

Implemented with temporary mock data. Added the protected `/schedules` interface with list/detail, create/edit forms, cancel confirmation, responsive layouts, loading/empty/success/error states, and client-side field validation. Mock changes were explicitly described as temporary and did not persist. The interface was not connected to the API during Spec 05.

**Recorded verification:** `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Interactive browser flows were not verified; the initial fixture was populated, so the empty state was not manually checked.


### Spec 04 — Schedule Data Model

Implemented and verified. Added the SQLAlchemy schedule model, Pydantic create/update/response schemas, initial Alembic migration, dependencies, and migration documentation. The model includes Clerk ownership, time intent, timezone-aware target time, durations, optional calculated fields, status, timestamps, constraints, and indexes. It did not add CRUD routes, calculations, or frontend behavior. Backend suite passed (26 tests); Alembic applied to configured MySQL, current revision was `20261010_0001`, `alembic check` found no metadata differences, and inspection confirmed 14 columns, two indexes, and four checks. Other MySQL versions/configurations remain unverified.

### Spec 03 — Database Foundation

**Implemented and unit verified; live MySQL connectivity and migration were not part of its original verification.** Added `backend/database.py` with a lazy reused SQLAlchemy engine (`pool_pre_ping=True`), session factory, FastAPI `get_db` dependency, and safe `SELECT 1` connectivity check. It validates `DATABASE_URL` as a complete `mysql+pymysql` URL and returns credential-safe configuration errors. Added SQLAlchemy/PyMySQL, a placeholder in `backend/.env.example`, database tests, and initial setup notes in `README.md`.

**Recorded checks at completion:** backend tests passed (21 tests); SQLite was used for connectivity/session lifecycle tests, so MySQL was not verified then. Spec 04 subsequently verified connectivity and applied its migration on the configured MySQL database.

### Spec 01 — Local Foundation and Health Check

**Implemented and verified.** Kept the existing root Next.js TypeScript app and added the separate FastAPI backend, public `GET /health`, configured local CORS, frontend backend-status states, environment examples, Python ignore rules, and local setup/test instructions. Replaced the starter's build-time Google Fonts fetch with a system font fallback after the build could not reach Google Fonts.

**Recorded checks:** backend health/CORS tests passed; FastAPI and Next.js development servers started; live `/health` returned HTTP 200 with `{"status":"ok"}` and the expected local CORS header; frontend connected/unavailable states were manually checked; lint, TypeScript, and production build passed. Initial pytest cache permission and font-network issues were resolved before the recorded final checks.

### Spec 02 — Clerk Authentication

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
