# Spec 17: Reminder Model and Scheduling Rules

## Goal
Create a reliable reminder system that schedules notifications for users based on their saved schedules.

## Requirements

1. **Reminder records:** Store each reminder's schedule, intended trigger time, timezone, status, and delivery information needed for tracking.

2. **Reminder timing:** Calculate reminder times using the existing backend schedule calculations and the user's timezone. Store timestamps consistently and handle timezone changes and daylight saving time correctly.

3. **Rescheduling:** When a schedule's relevant date, time, or other reminder-related details change, update its pending reminders so they no longer use outdated times.

4. **Cancellation:** When a schedule is cancelled or no longer requires reminders, cancel its pending reminders. Already-sent reminders must not be sent again.

5. **Duplicate prevention:** Prevent duplicate reminders when schedules are edited, requests are retried, or background jobs run more than once.

6. **Background processing:** Choose a durable scheduler or queue suitable for the existing FastAPI and database architecture. Reminder jobs must survive application restarts and recover safely after failures.

7. **Status tracking:** Track pending, sent, cancelled, and failed reminders, including retry behavior where appropriate.

## Acceptance Criteria
- Reminders trigger at the intended time in the correct timezone.
- Schedule edits reschedule pending reminders.
- Cancelled schedules do not trigger pending reminders.
- Retries and repeated jobs do not create duplicate deliveries.
- Missed jobs and application restarts are handled safely.
- Reminder records are protected by the existing user and schedule ownership rules.

## Testing
Test reminder creation, timezone handling, rescheduling, cancellation, duplicate prevention, retries, and recovery after restart.

Run relevant backend and frontend tests, linting, TypeScript checks, production build, and `git diff --check`.

Inspect the existing models and architecture before adding migrations or selecting a scheduler. Update the progress tracker and decisions document, and report remaining manual verification honestly.