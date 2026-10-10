# Spec 08 — Schedule Intent and Validation

## Goal

Define and implement consistent schedule intent, required and optional fields, input validation, timezone handling, and autosave eligibility.

The app must distinguish between a user who needs to arrive at a particular time and a user who wants to leave at a particular time. It must not silently guess missing information or treat unknown durations as zero.

This spec builds on the existing schedule UI, FastAPI API, SQLAlchemy model, and database schema.

## Read First

Read these files before making changes:

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture-context.md`
- `context/ai-workflow-rules.md`
- `context/code-standards.md`
- `context/ui-context.md`
- `context/progress-tracker.md`
- `context/decisions.md`
- `context/specs/05-schedule-interface.md`
- `context/specs/06-schedule-api.md`
- `context/specs/07-ui-api-integration.md`
- The current schedule model, Pydantic schemas, API routes, frontend schedule forms, and related tests.

Follow the repository's existing naming conventions, architecture, and installed skills. Consult official documentation when necessary.

## Requirements

### 1. Schedule intent

Support two explicit schedule intents:

- `arrive_by`: The user wants to arrive at a destination by a specified date and time.
- `leave_at`: The user wants to leave at a specified date and time.

Represent intent explicitly in the schedule data model and API schemas if the existing implementation does not already support it.

Use the existing project's naming conventions where appropriate. Do not create duplicate fields or enums if equivalent structures already exist.

The interface must make the selected intent clear to the user.

### 2. Required and optional information

Define and enforce a consistent distinction between required and optional schedule information.

Required information must include:

- A valid schedule intent.
- A valid target date and time.
- A valid timezone or an explicitly defined, reliable timezone source.

Preserve existing required fields, such as a schedule title, if the current implementation requires them.

Preparation duration and transport duration must be represented explicitly when provided.

An unknown transport duration must remain unknown. Do not silently substitute zero or pretend the travel duration is known.

Optional information must not prevent saving a schedule unless an existing product requirement explicitly makes that information mandatory.

### 3. Missing and ambiguous information

Do not silently choose an intent when the user's intended meaning is ambiguous.

If the interface cannot determine the intent, require the user to select arrival or departure before the schedule becomes eligible for autosave.

Show clear validation messages for missing required fields.

Do not introduce natural-language or AI-based interpretation in this spec. AI extraction and clarification behavior will be implemented separately.

### 4. Date and time validation

Validate all date and time inputs consistently on the frontend and backend.

Requirements:

- Reject malformed or impossible date/time values.
- Require an unambiguous timezone interpretation.
- Preserve the user's intended local date and time when storing and retrieving schedules.
- Reject nonexistent local times during daylight-saving transitions when applicable.
- Handle ambiguous local times during daylight-saving transitions explicitly rather than silently choosing one.
- Avoid accidentally changing the selected time when converting between frontend, API, and database representations.
- Handle dates crossing midnight correctly when validating date/time values.

Do not reject a schedule merely because its time is in the past unless an existing, documented product rule requires that behavior.

Use the existing timezone strategy where possible. Document any necessary change before introducing a competing strategy.

### 5. Autosave eligibility

A schedule may autosave only when all required fields are valid.

Before autosaving:

- Confirm the intent is selected.
- Confirm the target date and time are valid.
- Confirm the timezone is resolved.
- Confirm other existing required fields are valid.
- Prevent invalid or incomplete form values from being persisted as a valid schedule.

Optional fields may remain empty or unknown when the schema permits it.

Autosave must use the existing API integration. Do not create duplicate schedules through repeated saves or accidentally overwrite a different schedule.

Display appropriate saving, saved, and error states using the existing UI patterns. If a save fails, preserve the user's entered values and allow retrying.

Do not report a schedule as saved until the API confirms success.

### 6. API and persistence consistency

Ensure frontend types, backend Pydantic schemas, SQLAlchemy models, and database persistence agree on the schedule intent and field semantics.

If the existing database schema needs changes:

- Create an Alembic migration.
- Preserve existing schedules where possible.
- Define a safe migration strategy for existing records.
- Do not modify the live database manually to bypass migrations.

Keep user-scoped access control and Clerk authentication intact.

### 7. Tests

Add or update focused tests for:

- Both schedule intents.
- Missing or invalid intent.
- Missing required fields.
- Valid optional fields and unknown transport duration.
- Invalid dates and times.
- Timezone conversion and round trips.
- Nonexistent and ambiguous local times where applicable.
- Autosave eligibility for valid and invalid forms.
- API validation and persistence.
- Save failures and retry behavior.
- Existing schedule creation, retrieval, update, and cancellation behavior.

Use the existing testing conventions and fixtures.

## Scope Limits

Do not implement:

- AI or LLM-based natural-language extraction.
- Automatic intent inference from free-text descriptions.
- The final deterministic preparation and transport time-calculation engine.
- Traffic or routing integrations.
- Weather integrations.
- Web Push notifications.
- Unrelated UI redesigns or new dependencies without a clear need.

This spec defines schedule meaning and validation. It does not calculate departure or preparation times from arrival times and durations.

## Quality Requirements

- Keep changes small and consistent with the existing architecture.
- Avoid duplicated validation logic where a shared helper or schema validator is appropriate.
- Treat backend validation as authoritative; frontend validation improves usability but is not a security boundary.
- Preserve existing authentication, user-scoped queries, and API error handling.
- Do not weaken validation or security to make tests pass.
- Do not claim browser verification or database verification unless actually performed.
- Do not log secrets, JWTs, or sensitive configuration values.

## Verification

Run the relevant backend tests and frontend checks. At minimum, run the applicable commands from the project configuration for:

- Backend tests.
- Frontend linting.
- TypeScript type checking.
- Production build.
- `git diff --check`.

Run migration checks if the schema changes.

Test the relevant schedule flows manually in the browser when the environment allows it. If browser verification cannot be performed, report that limitation clearly.

Inspect the final diff to ensure the changes remain within scope.

## Definition of Done

- Schedule intent is explicit and consistently represented.
- Required and optional fields have clear semantics.
- Unknown durations remain unknown.
- Date, time, and timezone validation is consistent across frontend and backend.
- Autosave only occurs for valid schedules and accurately reflects API success or failure.
- Existing authenticated, user-scoped schedule operations continue working.
- Relevant automated tests and project checks pass.
- Required migrations are created and verified if needed.
- `context/progress-tracker.md` is updated with completed work, verification results, and outstanding issues.
- Any necessary architectural decision is recorded in `context/decisions.md`.
- The final report distinguishes verified behavior from anything not tested.

## Progress Update

After implementation and verification, update `context/progress-tracker.md` with:

- Spec 08 status.
- Main files and behaviors changed.
- Tests and checks run, including their actual results.
- Migration status, if applicable.
- Browser verification status.
- Known limitations and remaining work.

Do not mark this spec complete if required behavior or verification remains outstanding.

## Final Report

Provide a concise report covering:

1. What changed.
2. Files changed.
3. Validation and autosave behavior implemented.
4. Tests and checks run, with results.
5. Migration details, if applicable.
6. Anything not verified or still unresolved.
7. Confirmation that the progress tracker was updated.