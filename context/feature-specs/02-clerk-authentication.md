# Spec 02 — Clerk Authentication

## Goal
Integrate Clerk authentication into the existing Next.js app and securely verify users in FastAPI.

## Implementation
- Configure sign-up, sign-in, and sign-out.
- Protect `/dashboard` and display the signed-in user's identity.
- Forward the Clerk session token to FastAPI as a Bearer token.
- Create reusable FastAPI authentication verification and a protected `GET /auth/me` endpoint returning the verified Clerk user ID.
- Keep `GET /health` public.
- Configure required environment variables and preserve restricted CORS settings.

## Security
- Never trust user IDs supplied by the frontend.
- Reject missing, invalid, or expired tokens with HTTP 401.
- Never expose secret keys or session tokens.
- Follow official documentation compatible with installed versions.

## Scope Limits
Do not implement database persistence, schedules, AI features, or notifications.

## Check When Done
- Authentication and protected routes work.
- FastAPI accepts valid tokens and rejects invalid ones.
- Automated tests pass.
- Spec 01 functionality remains intact.
- Update `context/progress-tracker.md` with actual changes and test results.