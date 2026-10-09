# Code Standards

## General
- Keep modules small and single-purpose.
- Fix root causes rather than stacking workarounds.
- Separate transport, validation, business rules, persistence, and external-provider concerns.
- Prefer clarity over premature abstraction.
- Use type hints for public functions and important data structures.

## Python / FastAPI
- Use Pydantic models for request and response contracts.
- Keep route handlers thin; put business rules in services.
- Use a repository/data-access layer where it provides a useful boundary around persistence.
- Use dependency injection for shared clients/resources as the application grows.
- Use SQLAlchemy for MySQL persistence; keep session lifecycle and transaction boundaries explicit.
- Return predictable response shapes and suitable status codes.
- Map expected provider errors to safe user-facing responses; never expose raw tracebacks.
- Configure request timeouts and handle expected exceptions explicitly.

## Next.js
- Keep provider secrets and trusted server-side logic out of browser bundles.
- Use client components only when browser interactivity or browser APIs are needed.
- Browser Notification APIs must be accessed in an appropriate client-side context.
- Validate data at API boundaries; frontend validation improves UX but does not replace backend validation.
- Use Clerk's supported Next.js integration for authentication UI/session management.
- FastAPI must verify trusted Clerk identity server-side before accessing private resources.
- Authentication and authorization must be enforced server-side as well as reflected in the UI.

## Validation and Time
- Validate all user input and external provider responses.
- Use timezone-aware datetimes for absolute instants.
- Keep event-local time, timezone, and resolved instant distinct where needed.
- Write unit tests for parsing, duration arithmetic, schedule edits, and reminder rescheduling.
- Make rounding rules and buffer semantics explicit.

## Secrets and Configuration
- Load secrets from environment variables or a secret manager.
- Provide `.env.example` with placeholder values, never real keys.
- Add `.env` and local secret files to `.gitignore`.
- Never print full API keys or include them in errors, screenshots, context files, or commits.

## Testing
- Test pure calculations independently from external APIs.
- Mock external providers in unit tests.
- Add integration tests for extraction, validation, authentication, and persistence.
- Test unauthorized cross-user access and invalid/expired auth tokens.
- Test duplicate reminder jobs, retries, schedule edits, cancellations, and expired push subscriptions when reminders are implemented.
- Do not mark features complete unless relevant tests or manual verification have been recorded.
