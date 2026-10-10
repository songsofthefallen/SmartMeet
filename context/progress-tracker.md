# Progress Tracker

## Current Spec

**Spec 03 — Database Foundation** is implemented and unit verified. Live MySQL connectivity has not been verified because no configured MySQL instance was used.

### Scope and implementation

- Added `backend/database.py` with lazy, process-reused SQLAlchemy engine (`pool_pre_ping=True`), reusable session factory, FastAPI `get_db` dependency that closes each session, and a `SELECT 1` connectivity check.
- Reads `DATABASE_URL` from the backend environment and validates that it is a complete `mysql+pymysql` URL. Missing or malformed configuration produces a clear, credential-safe configuration error; the request dependency returns a generic 503 response.
- Added SQLAlchemy 2.x and PyMySQL requirements, a placeholder database URL in `backend/.env.example`, and setup notes in `README.md`.
- Preserved Clerk authentication and the existing `GET /health` response. No schedule models, tables, migrations, CRUD endpoints, or frontend database features were added.

### Changed files

- `backend/database.py`
- `backend/requirements.txt`
- `backend/.env.example`
- `backend/tests/test_database.py`
- `README.md`
- `context/progress-tracker.md`

### Verification results

- `python -m pytest -p no:cacheprovider tests` from `backend/`: **passed, 21 tests** (9 database tests and 12 existing authentication/health tests).
- Database tests use in-memory SQLite for the connectivity query and session lifecycle; they do not require MySQL.
- `git diff --check`: no whitespace errors; Git reported line-ending conversion notices for edited text files.
- Live MySQL connectivity: **not verified**. No MySQL integration result is claimed.
- Frontend checks: **not run**, because no frontend files or behavior changed.

### Environment and manual verification

Set `DATABASE_URL` in ignored `backend/.env`, using the form `mysql+pymysql://user:password@host:3306/database`. Create the MySQL database and grant an application account access before use. URL-encode reserved characters in credentials. Call `check_database_connection()` in the backend environment to verify the live connection.

### Next step

Verify against a configured local MySQL instance. Do not begin a later feature spec until it is explicitly requested.

## Completed Specs

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
- Configure MySQL and verify a live connection using `check_database_connection()`.
- Browser verification of frontend connected/unavailable states was previously recorded, but can be repeated when the development environment changes.

## Tracker Maintenance Rule

For each feature-spec change, keep this tracker synchronized with the spec's actual scope and results. The active section should describe only the current spec. When moving to another spec, move the prior spec out of the active section into **Completed Specs**, with its implementation summary, changed files, actual verification results, and outstanding verification clearly recorded. Do not claim external or manual checks that were not performed. Preserve product decisions and open verification items without duplicating a completed spec as the current goal.
