# Spec 11 — End-to-End Assistant Workflow

## Goal
Connect AI extraction, clarification, validation, saving, time calculations, and schedule management into one complete workflow.

## Requirements
1. Users can submit natural-language schedule requests.
2. The AI extracts schedule details, and the backend validates them.
3. Ask focused clarification questions when required information is missing or ambiguous.
4. Preserve known values while the user answers clarification questions.
5. Automatically save schedules once all required fields are valid.
6. Display calculated departure and wake-up times using Spec 10.
7. Allow users to edit or cancel saved schedules.
8. Show accurate loading, success, and error states.
9. Prevent duplicate schedules from repeated submissions.
10. Preserve Clerk authentication, user ownership, timezone validation, and existing unknown-duration behavior.

## Error Handling
- Never save incomplete or invalid schedules.
- Never show success before the backend confirms the save.
- Preserve user input when saving fails where possible.
- Do not expose API keys or sensitive provider errors.

## Scope Limits
- Reuse existing APIs, services, and database models.
- Avoid migrations and dependencies unless necessary.
- Do not implement routing, weather, geocoding, or notifications.
- Do not rebuild features that already work.

## Acceptance Criteria
- A valid request is saved automatically after validation.
- An incomplete request asks for clarification without saving.
- Saved schedules persist after refreshing.
- Calculated times are correct.
- Editing and cancellation work.
- Existing authentication and ownership protections remain intact.

## Verification
Run backend and frontend tests, lint, TypeScript checks, production build, and `git diff --check`. Test the complete workflow in the browser and report anything not verified.