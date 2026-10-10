# Progress Tracker

## Current Spec

**Spec 04 — Schedule Data Model** is implemented and verified. The initial migration was applied to the configured MySQL database, and Alembic reports no metadata differences.

### Scope and implementation

- Added `backend/models.py` with SQLAlchemy 2.x declarative metadata, a Clerk-owned `Schedule` table, enum values, nonnegative duration constraints, user/status indexes, and timestamps. No users table was introduced.
- Added `backend/schemas.py` with create, partial update, and ORM response schemas. Inputs reject extra fields, invalid enum values, negative durations, naive datetimes, and invalid IANA timezones. The create contract does not accept a Clerk user ID; the authenticated service must supply ownership from trusted identity.
- Added `backend/alembic.ini`, `backend/alembic/env.py`, the migration template, and initial revision `20261010_0001`. Alembic imports `Base.metadata` and reads the same `DATABASE_URL` through the Spec 03 validator; it loads ignored `backend/.env` for its CLI.
- Added Alembic, Pydantic, and python-dotenv requirements. Documented migration commands and MySQL datetime behavior in `README.md`.
- Existing Spec 03 `database.py`, Clerk authentication, and `/health` behavior were not modified. No CRUD endpoints, calculations, frontend behavior, or notifications were added.

### Changed files

- `backend/models.py`
- `backend/schemas.py`
- `backend/alembic.ini`
- `backend/alembic/env.py`
- `backend/alembic/script.py.mako`
- `backend/alembic/versions/20261010_0001_create_schedules.py`
- `backend/tests/test_schedules.py`
- `backend/requirements.txt`
- `README.md`
- `context/progress-tracker.md`

### Verification results

- `python -m pytest -p no:cacheprovider tests` from `backend/`: **passed, 26 tests**, including model/schema tests and the existing database, authentication, and health tests.
- Schedule model persistence tests use in-memory SQLite and are unit checks only; the live MySQL result below is separately verified.
- `python -m alembic upgrade head`: **applied successfully** to configured MySQL. The database had no prior `schedules` or `alembic_version` table; the migration created the schedule table and version table without deleting or resetting existing data.
- `python -m alembic current`: **20261010_0001 (head)**.
- `python -m alembic check`: **passed; no new upgrade operations detected** against live MySQL metadata.
- MySQL inspection confirmed all 14 expected schedule columns, two indexes, and four check constraints. `SHOW CREATE TABLE schedules` confirmed the resulting MySQL DDL.
- `python -m alembic upgrade head --sql`: generated MySQL-dialect SQL successfully. This was a supplementary compile check, not used as proof of a live migration.
- `git diff --check`: no whitespace errors; Git emitted line-ending conversion notices for edited text files.
- Frontend checks: **not run**, because no frontend files or behavior changed.

### Environment and manual verification

For another environment, set `DATABASE_URL` in ignored `backend/.env`, using `mysql+pymysql://user:password@host:3306/database`; create the database and grant the application account access first, and URL-encode reserved characters in credentials. Install `backend/requirements.txt`, then run `python -m alembic upgrade head` from `backend/`. MySQL `DATETIME` does not preserve offsets: submit aware datetimes and store UTC instants alongside the IANA timezone field. Migration behavior has been verified on the currently configured MySQL instance; behavior on other MySQL versions/configurations remains unverified.

### Next step

Spec 04 is complete. Proceed to a later feature spec only when explicitly requested.

## Completed Specs

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
