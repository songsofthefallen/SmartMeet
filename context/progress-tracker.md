# Progress Tracker

## Current Phase
Spec 01 — local application foundation completed and verified.

## Current Goal
Establish a repeatable local Next.js + FastAPI foundation and verify its health endpoint.

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
- No application dependencies were installed during this change; existing Node dependencies and globally available Python packages were used for verification.

## In Progress
- None

## Next Up
1. Define Spec 02 for Clerk authentication and the trusted identity boundary between Next.js and FastAPI.
2. Verify the Clerk-to-FastAPI token verification approach before implementation.

## Open Questions
- Which Clerk token-forwarding and verification approach will be used for FastAPI?
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
- Undecided: Clerk token verification details, deployment topology, durable background scheduler, Web Push library/key setup, maps/weather providers.
- Proposed: AI extracts intent; backend validates and calculates.
- Proposed: isolate provider integrations behind adapters.
- Proposed: reminder delivery should be idempotent where feasible.

## Session Notes
- Do not copy Ghost AI's Next.js/Clerk/Prisma/Liveblocks/Trigger.dev architecture by default.
- Never store real API keys in these context files.
- Update this tracker after meaningful implementation changes and keep status factual.
- Spec 01 is completed and verified. Backend tests, health endpoint, CORS, frontend status transitions, lint, TypeScript checks, and production build have been verified.
