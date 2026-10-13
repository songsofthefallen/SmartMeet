# Spec 10 — Deterministic Time Calculations

## Goal

Implement deterministic backend calculations for suggested departure and wake-up times using schedule intent, target datetime, preparation duration, travel duration, and configurable time buffers.

The AI extracts schedule information, but the backend is responsible for calculating times.

## Context

The application already supports:
- Clerk authentication.
- Persistent schedules using MySQL and SQLAlchemy.
- Schedule creation, editing, cancellation, and retrieval.
- Arrival and departure time intent.
- Timezone-aware schedule validation.
- AI extraction and clarification.

This spec builds on those existing features without replacing them.

## Scope

### In Scope
- Calculate suggested departure times for arrival-based schedules.
- Calculate suggested wake-up or preparation-start times when sufficient information is available.
- Support departure-based schedules.
- Apply explicit configurable preparation and travel buffers.
- Handle unknown preparation or travel durations safely.
- Use timezone-aware datetime calculations.
- Return calculated results through the backend API.
- Display available results in the schedule interface.
- Recalculate results when relevant schedule fields change.
- Add automated tests.

### Out of Scope
- AI-generated time calculations.
- Live routing or traffic estimates.
- Weather-aware adjustments.
- Push notifications.
- Background reminder scheduling.
- Automatic schedule saving changes.
- Location geocoding.

## Calculation Rules

### 1. Arrival Intent

For a schedule where the user specifies when they must arrive:

Suggested departure time = Target arrival time - Travel duration - Travel buffer

Suggested wake-up/preparation-start time = Suggested departure time - Preparation duration - Preparation buffer

Only calculate values when the required durations are known.

Example:

Target arrival: 8:00 AM  
Travel duration: 90 minutes  
Travel buffer: 0 minutes  
Preparation duration: 60 minutes  
Preparation buffer: 0 minutes

Results:
- Suggested departure: 6:30 AM
- Suggested wake-up/preparation start: 5:30 AM

### 2. Departure Intent

For a schedule where the user specifies when they must leave:

Suggested departure time = Target departure time

Suggested wake-up/preparation-start time = Target departure time - Preparation duration - Preparation buffer

Do not subtract travel duration from an explicitly specified departure time.

### 3. Buffers

Support explicit nonnegative values for:
- Travel buffer in minutes.
- Preparation buffer in minutes.

Both default to zero for the initial implementation.

Do not invent extra time without an explicit rule or user-provided value.

Buffer defaults should be configurable through backend settings or an existing appropriate configuration mechanism.

### 4. Unknown Durations

- Unknown duration is represented as null, not zero.
- Do not calculate an arrival-based departure recommendation without a known travel duration.
- When preparation duration is unknown, do not calculate a preparation-start recommendation. For arrival intent with unknown travel duration, departure remains unavailable, but a preparation-start suggestion may be calculated from the target arrival time minus the known preparation duration and preparation buffer; label that basis clearly and do not imply a departure estimate.
- A departure-based schedule can still show its specified departure time when travel duration is unknown.
- Return an explicit reason when a calculation cannot be completed.
- Do not fabricate travel or preparation estimates.

### 5. Timezone Handling

- Use the schedule's validated timezone and target datetime.
- Perform duration arithmetic using timezone-aware instants.
- Convert calculated results back into the schedule's IANA timezone for display.
- Support calculations crossing midnight or changing calendar dates.
- Preserve existing DST validation rules.
- Do not silently resolve ambiguous or nonexistent user-entered local times.

## Backend Responsibilities

- Implement a reusable deterministic calculation service.
- Keep calculation logic independent from the AI provider.
- Reuse existing schedule models, schemas, and timezone utilities where appropriate.
- Expose calculated results through the existing schedule API where practical.
- Avoid unnecessary database schema changes.
- Ensure calculations update when relevant schedule fields are edited.
- Return null values and explicit unavailable reasons where appropriate.
- Preserve authentication and user ownership checks.

## Frontend Responsibilities

- Display suggested departure time when available.
- Display suggested wake-up/preparation-start time when available.
- Show the correct local date and timezone for each result.
- Clearly distinguish calculated suggestions from user-entered target times.
- For departure intent, show the selected target as “Departure time,” followed by backend-calculated estimated arrival and wake-up/preparation start; do not label the target departure as a suggestion. For arrival intent, retain “Suggested departure” and wake-up/preparation-start labels. Explain unavailable values using the backend's unknown-duration state without substituting zero.
- Explain unavailable results without displaying misleading times.
- Refresh calculated results after schedule updates.
- Follow the existing UI context and component patterns.

## Validation and Error Handling

- Reject negative durations and buffers.
- Do not confuse missing durations with zero-minute durations.
- Handle invalid or incomplete schedules using existing validation rules.
- Never report a calculation as available when its required inputs are missing.
- Do not let calculation failures corrupt saved schedules.

## Testing Requirements

Add automated tests for:

1. Arrival intent with known travel and preparation durations.
2. Departure intent with known preparation duration.
3. Nonzero travel and preparation buffers.
4. Unknown travel duration.
5. Unknown preparation duration.
6. Explicit zero-minute durations.
7. Calculations crossing midnight.
8. Calculations crossing a DST transition.
9. Invalid negative values.
10. Recalculation after schedule edits.
11. Correct API serialization and timezone display.
12. Preservation of Clerk authentication and schedule ownership.

## Acceptance Criteria

- Arrival schedules produce the correct suggested departure time when travel duration is known.
- Wake-up/preparation-start suggestions are correct when required durations are available.
- Departure schedules preserve the user's explicit departure time.
- Buffers are applied exactly once.
- Unknown durations never silently become zero.
- Results use the correct timezone and local date.
- Results update after schedule edits.
- Existing schedule CRUD and AI extraction continue working.
- Backend and frontend checks pass.

## Implementation Constraints

- Keep calculations deterministic and backend-owned.
- Do not use an LLM to perform time arithmetic.
- Reuse existing architecture and utilities.
- Avoid new dependencies unless clearly necessary.
- Keep database changes minimal.
- Do not implement Spec 11 or later features.
- Update the progress tracker after implementation and verification.

## Verification

- Run backend automated tests.
- Run frontend tests where applicable.
- Run frontend lint.
- Run TypeScript checks.
- Run the production build.
- Run `git diff --check`.
- Report any unverified browser behavior separately.
