# Progress Tracker

## Current Spec

**Spec 05 — Schedule Interface** is implemented with temporary client-side mock data. Schedule operations are not connected to FastAPI or MySQL and reset when the page reloads.

### Scope and implementation

- Added protected `/schedules` route using the existing Clerk `auth.protect()` pattern.
- Built responsive upcoming schedule list and detail panel, create/edit form, and cancel confirmation. Form fields follow Spec 04 create/update schemas; frontend validates required values and nonnegative durations.
- Included loading, empty, success, validation error, and cancellation states. The interface labels mock schedules and explains that no changes are persisted. It does not calculate departure/wake-up times or implement notifications.
- Added a root `.pytest_cache/**` ESLint ignore after `npm run lint` failed to scan the inaccessible cache directory. Added `instant = false` to the protected page to follow the existing dashboard convention and support this app's Cache Components prerendering.

### Changed files

- `app/schedules/page.tsx`
- `app/schedules/schedule-workspace.tsx`
- `eslint.config.mjs`
- `context/progress-tracker.md`

### Verification results

- `npm run lint`: **passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed**; `/schedules` is server-rendered behind Clerk protection.
- `git diff --check`: **passed**.
- Interactive browser checks were not performed. Clerk access behavior, responsive rendering, and client-side create/edit/cancel flows are implemented but not manually verified in a browser. Empty state is supported by the component but the initial mock fixture is populated.

### Next step

Spec 05 is complete. Stop here; do not proceed to another spec without an explicit request.

## Completed Specs

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
