# Progress Tracker

## Current Phase
Spec 02 — Clerk authentication implemented and locally verified; Clerk instance setup and live sign-in remain unverified.

## Current Goal
Integrate Clerk sign-in/sign-up in Next.js and verify Clerk-issued identity tokens in FastAPI, while preserving Spec 01.

## Verified Completed
- Discussed a small FastAPI prototype that accepts natural-language input and calls an LLM API.
- Experimented with an OpenRouter key and configurable model.
- Defined the project concept: parse arrival/departure intent, calculate reminders, and later enrich estimates with travel/weather data.
- Drafted the project context files.
- Confirmed project preferences for Next.js frontend, MySQL + SQLAlchemy, Clerk authentication, auto-save after validation, both arrival/departure time intent, web push notifications, and learning plus a usable MVP.
- Web Push is preferred over page-only timers because page timers cannot reliably notify when a tab is closed; delivery still depends on browser/device support and permission.
- These context updates do not mean the corresponding product features have been implemented.
- Preserved the existing root-level Next.js TypeScript application and added a separate `backend/` FastAPI app.
- Added `GET /health`, a configurable frontend health-status indicator, local CORS configuration, Python requirements, safe environment examples, Python ignore rules, and local setup/test instructions.
- Replaced the starter's build-time Google Fonts fetch with a system font fallback after the initial production build failed because the environment could not reach Google Fonts.
- Added backend health and local CORS tests; the frontend handles checking, connected, and unavailable states, including a five-second timeout and invalid response handling.
- Added `@clerk/nextjs` 7.9.13, `ClerkProvider`, Clerk sign-in/sign-up pages and controls, sign-out through `UserButton`, bare Next.js 16 `proxy.ts` Clerk middleware, and a server-protected `/dashboard` page.
- The dashboard requests a Clerk session token and sends it to FastAPI as a Bearer token; the displayed user ID comes only from the verified `/auth/me` response.
- Added reusable FastAPI `verify_clerk_token` dependency. It verifies RS256 signature, expiry/issued-at, required claims, configured issuer, and configured-origin `azp` when present. `/auth/me` returns the verified token subject; `/health` remains public.
- CORS now permits the `Authorization` header while retaining configured frontend origins and GET-only methods.
- Added generated-RSA authentication tests for valid identity, bad signature, expired token, wrong issuer, untrusted authorized party, missing/malformed authorization, missing server configuration, and public health access.
- Added frontend and backend Clerk configuration placeholders to environment examples; no real keys or tokens were read, created, or committed.

## Verification Results
- `python -m pytest` (from `backend/`): passed, 2 tests. Pytest emitted a cache-directory permission warning in this environment.
- Started the API with `python -m uvicorn main:app --host 127.0.0.1 --port 8000`: started successfully.
- `npm run dev`: started the Next.js development server successfully at `http://localhost:3000`.
- Live `GET http://127.0.0.1:8000/health`: returned HTTP 200 and `{"status":"ok"}`.
- Live health request with `Origin: http://localhost:3000`: returned the expected `Access-Control-Allow-Origin: http://localhost:3000` header.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed after excluding Python-generated cache/virtual-environment files from ESLint traversal.
- `npm run build`: passed, including compilation, type checking, and static page generation.
- Manually verified in the browser that the frontend shows Backend connected while FastAPI is running and Backend unavailable after FastAPI is stopped.
- `python -m pytest -p no:cacheprovider tests` (from `backend/`): passed, 12 tests (10 authentication cases and 2 Spec 01 health/CORS tests).
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed with Next.js 16.4.0 and `@clerk/nextjs` 7.9.13.
- Next.js 16 prerender constraints around auth-aware and path-aware Clerk components were addressed with Suspense boundaries; the protected dashboard is request-time rendered.
- Clerk sign-in against a configured Clerk instance was not manually verified because this workspace has no configured instance keys. Unit tests use locally generated RSA keys and do not prove the configured Clerk instance will issue matching tokens.
- An inaccessible pytest-created temporary directory initially blocked test discovery and Turbopack scanning; it was removed, ignored by `.gitignore`, and the final checks passed afterward.

## In Progress
- Manual Clerk instance configuration and browser sign-in verification.

## Next Up
1. In local development only, configure the Clerk keys and FastAPI verification values listed below, start both apps, and verify registration, sign-in, dashboard identity, and sign-out in a browser.
2. Stop after Spec 02; do not start later feature work until explicitly requested.

## Open Questions
- Live Clerk instance/browser verification remains outstanding. For deployment, which frontend origins and Clerk issuer values will be configured?
- How will deployment origins, CORS, and CSRF protections be configured where applicable?
- Which durable scheduler/queue will trigger reminders?
- Which Web Push library and key-management approach will be used?
- What exact fields are mandatory before auto-save?
- What timezone should be used by default, and how can the user change it?
- What preparation and arrival buffers should be defaults?
- How should requests in the past be handled?
- Should a schedule with no known travel duration still be saved?
- Should recurring schedules be supported in the MVP?
- Is browser push (service worker + push subscription) required, or is an in-app/page-open reminder acceptable initially?
- Which maps/traffic and weather providers are planned for later?
- Browser-level verification remains to be done in an environment with an available browser to observe the connected and unavailable UI states.

## Architecture Decisions
- Confirmed direction: Next.js frontend and Python/FastAPI backend.
- Confirmed direction: use Clerk for authentication; FastAPI must verify trusted identity before private data access.
- Confirmed direction: use MySQL with SQLAlchemy.
- Confirmed direction: automatically save only after required fields pass validation.
- Confirmed direction: support arrival and departure wording; clarify ambiguity.
- Confirmed direction: Web Push with a service worker is preferred over page-only timers; exact implementation is undecided.
- Confirmed priority: learn software engineering while delivering a usable MVP.
- Spec 02 implementation: Next.js forwards the Clerk session token in a Bearer header; FastAPI manually verifies RS256 tokens using the configured Clerk JWT public key, exact issuer, and allowed frontend origins. Configure these values per Clerk instance and deployment.
- Undecided: deployment topology and production origins, durable background scheduler, Web Push library/key setup, maps/weather providers.
- Proposed: AI extracts intent; backend validates and calculates.
- Proposed: isolate provider integrations behind adapters.
- Proposed: reminder delivery should be idempotent where feasible.

## Session Notes
- Do not copy Ghost AI's Next.js/Clerk/Prisma/Liveblocks/Trigger.dev architecture by default.
- Never store real API keys in these context files.
- Update this tracker after meaningful implementation changes and keep status factual.
- Spec 01 is completed and verified. Backend tests, health endpoint, CORS, frontend status transitions, lint, TypeScript checks, and production build have been verified.

## Spec 02 Environment Variables and Manual Setup
- Frontend `.env.local`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (development publishable key), `CLERK_SECRET_KEY` (development secret key, server-only), and existing `NEXT_PUBLIC_API_BASE_URL`.
- Backend `backend/.env`: `CLERK_JWT_KEY` (Clerk instance JWT verification public key in PEM format), `CLERK_ISSUER` (exact issuer from a Clerk session token), and existing `FRONTEND_ORIGINS` (comma-separated allowed browser origins; also used to validate `azp`).
- Manual setup: create or select a Clerk development instance, copy its development keys into ignored local environment files, configure the JWT public key and exact issuer, then start Next.js and FastAPI and verify sign-up/sign-in/sign-out and the dashboard's verified ID in a browser.
- No actual Clerk user/session was created or tested in this implementation. Do not put production keys in local examples or tests.
