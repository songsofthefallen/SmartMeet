# Spec 21 — Edge Cases and Production Readiness

## Goal
Identify and fix remaining edge cases that could cause incorrect schedules, missed reminders, data inconsistencies, or confusing errors.

## Requirements

1. **Time and scheduling:** Test past-due reminders, time-zone changes, daylight-saving transitions, and invalid or ambiguous times. Preserve existing calculation rules.

2. **Push subscriptions:** Handle expired, revoked, malformed, and duplicate subscriptions. Ensure one device's failure does not unnecessarily block other devices.

3. **Worker and database failures:** Verify behavior during database outages, worker restarts, expired leases, and repeated provider failures. Avoid losing pending reminders or retrying permanently failed work indefinitely.

4. **Schedule consistency:** Verify schedule edits, cancellations, and deletions cannot cause obsolete reminders to be delivered. Preserve user ownership and authorization.

5. **API and UI errors:** Return actionable, sanitized errors for expected failures. Avoid misleading success messages and generic errors when a useful safe explanation is available.

6. **Configuration and security:** Validate required environment variables at startup, keep secrets out of frontend bundles and logs, and document required local configuration.

7. **Testing:** Add regression tests for confirmed gaps, including boundary conditions and failure recovery.

## Acceptance Criteria

- Identified edge cases have appropriate, tested behavior.
- Invalid configuration fails clearly without exposing secrets.
- API errors and UI status messages accurately reflect outcomes.
- Existing schedule calculations, authentication, reminders, and push delivery remain intact.
- Relevant backend/frontend tests, lint, TypeScript checks, production build, and `git diff --check` pass.
- The progress tracker documents completed fixes and remaining risks.

## Rules

- Read `AGENTS.md`, relevant context files, the progress tracker, decisions, and Specs 17–20.
- Inspect the existing implementation before changing code. Reuse existing protections and avoid duplicating completed work.
- Fix only demonstrated gaps; do not rewrite working features.
- Do not modify applied migrations. Add a new migration only when necessary and explain why.
- Do not claim production readiness or guaranteed delivery without evidence.
- Report changed files, test results, migration status, remaining limitations, and manual checks.