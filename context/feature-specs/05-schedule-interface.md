# Spec 05 — Schedule Interface

## Goal

Build the schedule management interface in the existing Next.js application using mock data.

## Implementation

- Create a schedule list page showing each schedule's title, target date/time, time intent, and status.
- Add a schedule detail view.
- Add create and edit forms using the fields supported by the Spec 04 model and schemas.
- Add a cancel action with appropriate confirmation.
- Include loading, empty, success, and error states where relevant.
- Protect schedule pages so only signed-in users can access them.
- Follow `context/ui-context.md` for colors, icons, layout, and styling.
- Keep the interface responsive and accessible.

## Scope Limits

Use temporary mock data only. Do not connect to FastAPI or MySQL, create API endpoints, implement AI extraction, calculate departure times, or add notifications.

Do not imply that schedules are persisted. Clearly treat mock changes as temporary.

## Check When Done

- Schedule list, details, create, edit, and cancel flows work with mock data.
- Empty and populated states render correctly.
- Forms validate required fields and show useful errors.
- Protected access and existing Clerk functionality remain intact.
- Frontend lint, TypeScript checks, and production build pass.
- Update `context/progress-tracker.md` with actual changes and test results.