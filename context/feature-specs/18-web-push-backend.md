# Spec 18: Web Push Backend Delivery

## Goal
Connect the existing reminder worker to a real Web Push provider so due reminders can be delivered to users' browsers.

## Requirements

1. **Push subscriptions:** Add backend support to register, store, and remove browser push subscriptions associated with the authenticated user. Validate ownership and never expose subscription secrets unnecessarily.

2. **Web Push provider:** Implement a delivery service using a maintained Python Web Push library and VAPID authentication. Keep private keys and secrets on the backend.

3. **Worker integration:** Replace the unconfigured delivery handler with the real provider. Send the appropriate wake-up or departure reminder when the worker processes a due reminder.

4. **Delivery outcomes:** Mark a reminder `sent` only when the provider accepts the push request successfully. Handle expired or invalid subscriptions, temporary provider errors, and permanent failures appropriately.

5. **Retries and duplicates:** Reuse the existing claim, lease, and retry mechanisms. Avoid duplicate sends where possible, and document the limitations of delivery guarantees.

6. **Security:** Require authentication to register or remove subscriptions, associate subscriptions with the correct user, validate incoming data, and never log subscription secrets or private keys.

7. **Configuration:** Document the required VAPID public key, private key, and contact subject as backend environment variables. Provide safe setup instructions without committing secrets.

## Acceptance Criteria
- An authenticated browser can register and remove its push subscription.
- The backend can send a test notification to a valid subscription.
- The worker can deliver a due reminder through the real provider.
- Provider failures are handled safely without falsely marking reminders as sent.
- Expired subscriptions are handled appropriately.
- Existing reminder scheduling, leases, retries, and cancellation remain functional.

## Testing
Add tests for subscription ownership, successful delivery, invalid subscriptions, provider failures, and worker integration. Mock external push requests in automated tests.

Run backend tests, frontend checks where relevant, linting, TypeScript checks, production build, and `git diff --check`. Inspect existing models and migrations before making schema changes.

Update the progress tracker and decisions document. Report actual test results, migration status, environment setup, and remaining manual verification honestly.