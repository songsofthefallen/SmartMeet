# Spec 09 — AI Schedule Extraction

## Goal
Allow authenticated users to describe a schedule in natural language, extract relevant details through a configurable AI provider, validate them on the backend, and review the resulting schedule before saving.

## Existing Stack
- Frontend: Next.js, TypeScript, React
- Backend: Python, FastAPI, Pydantic
- Authentication: Clerk
- AI provider: configurable OpenAI-compatible API, currently configured for OpenRouter
- Timezone handling: IANA timezones and DST-aware backend validation

## User Flow
1. User enters a natural-language schedule description.
2. Frontend submits the description and selected timezone to the authenticated extraction endpoint.
3. Backend supplies a trusted reference datetime and timezone context to the extraction service.
4. AI extracts the activity, target date/time, arrival or departure intent, and available duration estimates.
5. Backend validates the extraction, resolves local time, and identifies missing, ambiguous, or invalid fields.
6. Frontend displays an editable review form with known values populated.
7. User corrects any fields requiring clarification.
8. User explicitly saves the reviewed schedule through the existing schedule API.

## Extraction Rules
- Support arrival-time and departure-time intent.
- When the model omits a title, infer `Go to <destination>` from a recognizable destination in the user's text; otherwise use `New schedule`. The title remains editable during review.
- Default an omitted model timezone to the timezone selected in the UI.
- Do not silently override a conflicting model timezone; request confirmation when needed.
- Accept an offset-bearing local time only after verifying that the offset matches the relevant IANA timezone and date.
- Normalize a matching offset once before passing the local time to the existing timezone resolver.
- Reject nonexistent DST times and request clarification for repeated or ambiguous local times.
- Preserve other schema-valid extracted fields when deterministic time/offset validation rejects one candidate field. A provider response that fails Pydantic validation is rejected as a whole and returned without an extraction candidate.
- Unknown preparation or travel durations remain unknown; never treat them as zero without explicit product logic.

## Saving and Security
- Extraction does not save a schedule automatically.
- The user reviews and confirms the extracted values.
- Schedule persistence uses the existing authenticated schedule API.
- Provider credentials remain server-side.
- Do not expose API keys, tokens, or sensitive provider response details in user-facing errors or logs.

## Error Handling
- Distinguish missing, ambiguous, invalid, and provider-failure cases.
- Display actionable field-level clarification messages.
- Avoid redundant generic messages when a specific validation message is already available.
- Keep known extracted values in the editable form.

## Verification
- Backend tests cover extraction schemas, provider behavior, timezone resolution, and API integration.
- The two frontend unit tests cover conversion of a backend-normalized local time and rejection of an offset-bearing time that would otherwise be normalized twice. They do not exercise the React workspace.
- Lint, TypeScript checks, production build, and `git diff --check` must pass.
- Live OpenRouter extraction using the configured model and browser end-to-end behavior must be verified separately; automated tests alone do not establish live provider success.

## Scope Limits
- Do not automatically save extracted schedules.
- Do not bypass timezone validation.
- Do not add routing, traffic, weather, or push-notification features as part of this spec unless a separate spec requires them.
