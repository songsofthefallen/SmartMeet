# Spec 03 — Database Foundation

## Goal

Set up MySQL and SQLAlchemy in the existing FastAPI backend.

## Implementation

- Configure SQLAlchemy database connectivity using environment variables.
- Add a reusable database engine, session factory, and database session dependency.
- Add a simple database connectivity check.
- Add a safe `.env.example` for database configuration.
- Keep database credentials out of source control.
- Use the existing project structure and installed dependencies where possible.

## Scope Limits

Do not create schedule models, user tables, migrations, CRUD endpoints, or frontend database features. Do not change Clerk authentication or the existing `/health` response.

## Check When Done

- FastAPI can connect to the configured MySQL database.
- Database sessions are created and closed correctly.
- Missing or invalid database configuration produces a clear error without exposing credentials.
- Automated tests pass.
- Existing health and authentication tests still pass.
- Update `context/progress-tracker.md` with actual changes and test results.