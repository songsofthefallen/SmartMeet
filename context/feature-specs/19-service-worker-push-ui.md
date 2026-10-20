# Spec 19 — Service Worker and Push Notification UI

## Goal
Connect the existing Spec 18 Web Push backend to the Next.js frontend.

## Requirements
1. Register a service worker and handle incoming push notifications and notification clicks.
2. Add a notification settings UI with states for unsupported browser, permission denied, disabled, enabled, and errors.
3. Let signed-in users explicitly enable notifications, register or reuse their browser subscription, and send it to the existing authenticated backend endpoint.
4. Let users disable notifications and remove their backend/browser subscription, handling partial failures.
5. Add a test-notification button using the existing Spec 18 endpoint.
6. Expose only the public VAPID key to the frontend. Never expose private keys or other backend secrets.
7. Use existing authentication, API utilities, UI components, and backend contracts.
8. Add automated tests and document setup and manual verification.

## Out of Scope
- Changing reminder scheduling, worker retry logic, or database schema.
- Rebuilding existing authentication or push backend functionality.
- Unrelated features.

## Acceptance Criteria
- Users can enable, test, and disable browser push notifications.
- UI states and errors are accurate.
- Notifications display correctly and clicking them opens or focuses the app.
- Existing functionality remains intact.
- Relevant tests, lint, TypeScript checks, production build, and `git diff --check` pass.
- Update the progress tracker and report manual verification still required.

## Implementation Rules
Read `AGENTS.md`, relevant context files, Spec 18, and the current implementation first. Inspect actual API contracts before editing. Keep changes scoped to this spec. Do not claim real push delivery is verified by mocked tests.