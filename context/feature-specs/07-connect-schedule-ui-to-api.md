# Spec 07 — Connect Schedule UI to API

## Goal

Replace the schedule interface's mock data with real FastAPI requests and persistent MySQL-backed schedules.

## Implementation

- Connect the schedule list and detail views to the existing schedule API.
- Wire create, edit, and cancel actions to the corresponding endpoints.
- Use the Clerk session token as a Bearer token for authenticated API requests.
- Configure CORS for the required frontend origin, HTTP methods, and headers without allowing arbitrary origins.
- Show accurate loading, empty, success, and error states.
- Update the UI only after the API confirms a successful operation.
- Handle expired sessions, unauthorized responses, missing schedules, and network failures.
- Preserve the existing UI design and responsive behavior.

## Scope Limits

Do not implement AI extraction, departure/wake-up calculations, routing, weather, notifications, or new database models. Do not duplicate backend validation or ownership logic in the frontend as a substitute for server enforcement.

## Check When Done

- Schedules load from the API instead of mock data.
- Create, edit, and cancel operations persist successfully.
- Refreshing the page retains saved schedules.
- Authentication and API failures are handled without false success messages.
- Users cannot access other users' schedules through the UI or API.
- Relevant backend tests, frontend lint, TypeScript checks, and production build pass.
- Update `context/progress-tracker.md` with actual changes and test results.
- Verify a complete workflow against MySQL if the configured database is available; distinguish this from SQLite tests.