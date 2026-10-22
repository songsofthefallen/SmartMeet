# SmartMeet exploratory testing report

Date: 2026-10-22  
Scope: local frontend at `http://localhost:3000`, FastAPI backend at `http://localhost:8000`, normal browser flow only. No credentials, notification sends, paid API calls, or application-code changes were used.

## Confirmed bug: transient false “Backend unavailable” during reload/navigation

Severity: Low

Status: Confirmed once in the shared browser; intermittent in repeated testing.

Reproduction:

1. Start the documented FastAPI server on port 8000 and Next.js server on port 3000.
2. Open `http://localhost:3000/`.
3. Reload the page while the health check is in flight, or navigate/reload rapidly.
4. Observe the backend status immediately after the reload.

Expected behavior: the status should remain in a neutral checking state until the current health request succeeds or fails. An aborted request belonging to a page being torn down should not be presented as a backend outage.

Actual behavior: the shared-browser run displayed “Backend unavailable” during reload, despite `GET http://localhost:8000/health` returning HTTP 200 when checked directly and the page subsequently reaching “Backend connected.” The controlled screenshot of the unavailable state is [backend-status-unavailable-controlled.png](./backend-status-unavailable-controlled.png). The healthy end state is [backend-status-connected.png](./backend-status-connected.png).

Evidence:

- Shared browser event log: `GET http://localhost:8000/health failed: net::ERR_ABORTED` during reload.
- Direct backend check: `GET http://localhost:8000/health` returned `200 {"status":"ok"}`.
- Five additional local headless reload samples reached “Backend connected” by 250 ms or sooner; their request evidence and status samples are in [backend-status-evidence.json](./backend-status-evidence.json).
- The evidence run also recorded `net::ERR_ABORTED` for the health request associated with the prior navigation. This makes request cancellation the leading explanation, but the exact production trigger was not established.

## Harmless warnings and configuration/environment issues

These were observed but are not being classified as product bugs:

- Clerk development-key warning: expected for the configured development instance; it is not a runtime failure.
- Clerk hosted-page structural-CSS warning: a maintainability warning from Clerk’s component implementation/versioning guidance, not a SmartMeet branding problem.
- Clerk hosted-page CSP console message: `script-src` falls back to `default-src`; observed on the hosted Clerk page and not reproduced as a user-visible failure in the app.
- Clerk telemetry request cancellation: an `ERR_ABORTED` event during navigation; no user-visible impact observed.
- Local startup noise: Uvicorn reload emitted Windows `WinError 5` named-pipe errors, and the sandbox initially blocked Next.js child-process spawning with `EPERM`. Non-reloading FastAPI and the already-running Next.js server worked after startup adjustment. These are local tooling/runtime constraints, not confirmed application defects.
- The Clerk page displayed “SmartMeet.” This is intentional application branding and was not reported as an issue.

## Not reproduced / remains untested

- The unavailable status was not reproduced consistently with a healthy backend: five controlled reload samples transitioned from “Checking backend…” to “Backend connected” within 250 ms.
- The exact timing that causes the shared-browser false unavailable state was not isolated from page teardown/navigation timing.
- Authenticated dashboard behavior, authenticated API requests, schedule creation/edit/cancel, AI extraction, routing, weather, persistence against MySQL, and notification delivery were not exercised because no authentication credentials were supplied and testing was not allowed to bypass authentication.
- No real notification was triggered and no paid provider call was intentionally initiated.
- The application was not modified.
