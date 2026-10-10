# Spec 06 — Schedule API

## Goal

Implement authenticated FastAPI endpoints for managing schedules stored in MySQL.

## Implementation

- Add endpoints to create, list, retrieve, update, and cancel schedules.
- Use the SQLAlchemy model, Pydantic schemas, and database dependency from previous specs.
- Require verified Clerk authentication for every schedule endpoint.
- Derive the owner from the verified Clerk user ID; never trust a user ID supplied by the frontend.
- Ensure users can access and modify only their own schedules.
- Validate request data and return consistent HTTP status codes and error responses.
- Commit successful changes and handle database errors safely.
- Preserve existing `/health` and `/auth/me` behavior.

## Scope Limits

Do not connect the frontend to these endpoints, implement AI extraction, calculate departure or wake-up times, or add notifications. Do not change the database schema unless a necessary defect is found; document it and stop for approval instead.

## Check When Done

- Create, list, retrieve, update, and cancel endpoints work.
- Unauthenticated requests are rejected.
- Users cannot access or modify another user's schedules.
- Validation, missing records, and database failures are handled safely.
- Automated API tests pass.
- Existing database, authentication, and health tests still pass.
- Update `context/progress-tracker.md` with actual changes and test results.