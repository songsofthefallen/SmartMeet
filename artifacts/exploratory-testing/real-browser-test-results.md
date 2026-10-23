# SmartMeet real-browser exploratory testing

Date: 2026-10-22  
Browser: controlled Playwright browser with manually authenticated Clerk session  
Scope: local app at `http://localhost:3000`; no credentials entered by automation; no real notifications sent.

## Results

| Feature | Result | Evidence / notes |
|---|---|---|
| Existing Clerk session and dashboard | Pass | Manual sign-in completed by the user. `/dashboard` loaded and displayed a verified Clerk user ID. Dashboard screenshot was captured in the controlled browser. |
| Backend status on authenticated pages | Pass | Dashboard and schedules showed `Backend connected`. Earlier status artifacts remain in [backend-status-evidence.json](./backend-status-evidence.json). |
| Notification settings UI | Pass / limited | Dashboard displayed `Permission is blocked` and explained how to enable notifications. No permission bypass or notification send was attempted. |
| Valid natural-language schedule extraction | Blocked | One explicit departure request returned HTTP 503. The UI preserved the description and showed `Schedule extraction is temporarily unavailable` with retry/manual continuation. No further retries were made. |
| Manual schedule creation | Pass | Created disposable `Exploratory browser test`, departure Oct 24, 2026 10:00 AM, Asia/Manila, preparation 30 minutes. UI showed `Schedule saved.` |
| Calculated departure/wake times | Pass | Manual departure displayed 10:00 AM; preparation start displayed 9:30 AM. Estimated arrival was correctly unavailable without travel duration. |
| Missing/invalid input validation | Pass | Submitting an empty form focused the required target-time field. A preparation value of `-5` was rejected by native validity (`min=0`, `validity.valid=false`) and no request was sent. |
| Edit and persistence | Pass | Changed title to `Exploratory browser test edited` and preparation to 45 minutes. UI showed `Schedule updated.` and recalculated preparation start to 9:15 AM. |
| Location search and selection | Pass | Searching `Makati City` returned TomTom results. Selected `Makati City, National Capital Region, Philippines`; the edit form displayed the selected place and a Change action. The edit was discarded afterward. |
| Disposable schedule cleanup | Pass | The only schedule created in this session was cancelled through the confirmation dialog. UI showed `Schedule cancelled.` and 0 active schedules. |
| Sign-out | Pass | Clerk sign-out returned the browser to the public home page with Sign in/Create account controls. |
| Protected-route enforcement after sign-out | Pass | Navigating to `/dashboard` redirected to the Clerk sign-in page with the dashboard redirect URL. |
| Ambiguous natural-language time handling | Blocked | Could not reach extraction behavior because the configured extraction provider returned HTTP 503 before parsing the request. |

## Confirmed issue / configuration blocker

The configured natural-language extraction request returned HTTP 503 Service Unavailable. The frontend handled this safely by preserving the input and offering retry/manual continuation. This is currently a provider/configuration availability blocker, not a confirmed frontend data-loss bug. Supporting browser evidence: console reported `Failed to load resource: the server responded with a status of 503 (Service Unavailable)` immediately after clicking Extract draft.

## Console and network notes

- Repeated Clerk development-key and hosted Clerk structural-CSS warnings were observed; they did not block authenticated use.
- Clerk hosted-page CSP fallback and telemetry `ERR_ABORTED` messages were observed during navigation; no user-visible failure was associated with them.
- The earlier backend-health abort evidence is retained in [backend-status-evidence.json](./backend-status-evidence.json); the status flicker fix was verified separately by automated tests before this browser pass.
- No additional application console error was observed during manual schedule CRUD, location selection, cancellation, or sign-out.

## Screenshot evidence

The controlled browser screenshot tool captured the authenticated dashboard, extraction 503 state, saved schedule/calculated-times state, cancellation state, and post-sign-out protected-route redirect during this pass. The tool did not expose persistent workspace paths for those live captures. Previously persisted screenshots remain available at [backend-status-connected.png](./backend-status-connected.png) and [backend-status-unavailable-controlled.png](./backend-status-unavailable-controlled.png).

No application code was modified during this browser-testing pass. The disposable schedule was cancelled before finishing.

## Follow-up: authenticated dashboard check

Date: 2026-10-23 (Asia/Manila)

- The first Playwright navigation to `/dashboard` in a fresh isolated Chrome context redirected to the Clerk sign-in page. No sign-in retries, token interception, credential entry, or authentication bypass were performed by automation.
- The user signed in manually in that same controlled Chrome window. The dashboard then loaded and showed the authenticated identity success state. The user ID is intentionally omitted from this report.
- The dashboard identity component obtains the Clerk session token and calls the backend `GET /auth/me` endpoint with a Bearer header. It only displays the verified-identity state after an HTTP-success response and a valid identity payload. The rendered success state therefore confirms that an authenticated API request worked; the exact HTTP status was not captured.
- Playwright performed the initial navigation. After the manual sign-in, the Playwright process handle was not available for instrumentation in this session, so the dashboard state was verified through the controlled window's accessibility tree. No further feature flows were run.
