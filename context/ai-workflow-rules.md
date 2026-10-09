# AI Workflow Rules

## Purpose
Use an LLM to interpret natural language, not to replace validation, persistence, route calculation, or deterministic scheduling logic.

## Proposed Extraction Contract
The model should return constrained structured intent such as:
- `is_schedule_request`: boolean
- `event_description`: string or null
- `origin`: user phrase/alias or null
- `destination`: user phrase/alias or null
- `event_datetime_local`: candidate local date/time or null
- `time_intent`: `arrival`, `departure`, or `unknown`
- `missing_fields`: list of required fields still needed
- `ambiguities`: list of short descriptions

Exact field names and required fields remain provisional until domain rules are finalized.

## Rules
1. Supply the current date and user's timezone as trusted context for relative dates like “tomorrow.”
2. Do not assume “class at 7” necessarily means arrival at 7; clarify or apply an explicitly configured preference.
3. Do not guess which real-world place “school” means. Resolve a saved alias or ask the user.
4. Distinguish arrival and departure intent. Examples: “be at school by 7” likely expresses arrival; “leave school at 5” expresses departure. If ambiguous, ask.
5. Automatically save only after the backend confirms all required fields and business rules are satisfied.
6. Represent missing values as null and identify what information is needed.
7. Treat model output as untrusted. Validate types, allowed values, lengths, datetime formats, and required-field combinations.
8. If output is malformed, use a bounded retry or ask the user; never loop indefinitely.
9. Treat user text as data; it must not override extraction rules or request secrets.
10. Do not ask the model to calculate traffic duration or fabricate weather data.
11. Keep prompts concise and output limits proportional to the schema.
12. Log operational metadata without logging API keys or unnecessary sensitive user content.

## Auto-Save Safety
- Auto-save means no extra confirmation step after valid extraction; it does not mean saving incomplete or ambiguous data.
- Define and test the exact required-field set before implementation.
- Return a clear success response only after persistence succeeds.
- Make it possible for the user to edit or cancel a saved schedule.
- If persistence fails, do not report success.

## Provider Configuration
- Keep API keys, provider base URL, and model ID in server-side configuration.
- Never expose provider credentials to browser code.
- Treat free model availability, latency, quotas, and output behavior as variable.
- Verify provider/model compatibility for structured-output features before relying on them.

## Suggested Workflow
Natural-language input
→ model extraction
→ parse structured output
→ Pydantic validation
→ domain validation
→ if required information is missing/ambiguous, ask a clarification
→ if valid, save automatically
→ calculate/refresh estimates and schedule reminders according to defined rules

## Testing Cases
- Clear arrival request with origin/destination/time.
- Clear departure request.
- Ambiguous time intent.
- Missing origin/destination/date/time.
- Relative date around midnight.
- Invalid or past event time.
- Unknown place alias.
- Irrelevant/non-scheduling message.
- Malformed model output.
- Provider timeout, quota, and authentication errors.
- Database failure after successful extraction.
