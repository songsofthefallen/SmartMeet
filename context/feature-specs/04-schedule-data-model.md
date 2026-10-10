# Spec 04 — Schedule Data Model

## Goal

Create the initial schedule database model using SQLAlchemy and manage schema changes with Alembic.

## Implementation

- Create a SQLAlchemy `Schedule` model using the existing database setup from Spec 03.
- Include an ID, Clerk user ID, title/description, time intent, target datetime, timezone, preparation duration, optional travel duration, optional calculated departure/wake-up time, status, and creation/update timestamps.
- Use appropriate database types, constraints, and indexes.
- Do not create a separate users table; Clerk manages user identities.
- Add Alembic and configure it to use the existing database URL and SQLAlchemy metadata.
- Create an initial migration for the schedules table.
- Add Pydantic schemas for schedule creation, updates, and responses where appropriate.
- Document how to apply migrations and verify the resulting schema.

## Scope Limits

Do not implement schedule CRUD endpoints, AI extraction, time calculations, frontend changes, or notifications. Do not change Clerk authentication or Spec 03 database behavior.

## Check When Done

- The SQLAlchemy model and Pydantic schemas are defined and validated.
- Alembic can detect model metadata and generate migrations.
- The initial migration creates the schedules table.
- Automated model/schema tests pass.
- Verify the migration against MySQL if the configured database is available; clearly report if this remains unverified.
- Existing database and authentication tests still pass.
- Update `context/progress-tracker.md` with actual changes and test results.