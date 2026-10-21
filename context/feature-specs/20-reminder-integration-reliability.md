# Spec 20 — Reminder Reliability

## Goal
Ensure reminders remain accurate when schedules change, workers restart, or push delivery fails.

## Requirements
1. **Schedule synchronization:** Create, update, and cancel reminders when schedules are created, edited, cancelled, or deleted. Prevent duplicate and obsolete reminders.
2. **Timing:** Use backend-calculated times and correct time zones. Define how overdue reminders are handled.
3. **Worker recovery:** Verify leases, concurrent workers, crash recovery, and bounded retries work correctly.
4. **Push delivery:** Handle expired subscriptions, multiple devices, and users without valid subscriptions. Record provider acceptance accurately without claiming the device displayed the notification.
5. **Errors and logs:** Record useful, sanitized errors without exposing secrets.
6. **Tests:** Add regression tests for schedule changes, duplicate prevention, worker recovery, retries, subscription failures, and time-zone edge cases.

## Acceptance Criteria
- Schedule changes synchronize reminders correctly.
- Obsolete reminders are not sent.
- Worker restarts and temporary failures recover safely.
- Permanent failures are recorded without endless retries.
- Multiple devices and invalid subscriptions are handled correctly.
- Existing authentication, scheduling, and push functionality still works.
- Relevant tests, lint, TypeScript checks, production build, and `git diff --check` pass.

## Rules
- Read `AGENTS.md`, relevant context files, the progress tracker, decisions, and Specs 17–19.
- Inspect existing code and fix actual gaps; do not rebuild working features.
- Avoid database schema changes unless necessary. Never modify applied migrations.
- Update the progress tracker and report changed files, test results, migration status, and remaining manual checks.
- Do not claim exactly-once delivery or confirmed device display without evidence.