# Spec 14 — Weather-Aware Buffers

## Goal

Improve travel-time planning by adding a reasonable weather buffer when forecast conditions may make a trip slower. The backend remains authoritative for all time calculations.

## Scope

- Integrate Open-Meteo as the weather provider.
- Use the selected origin, destination, planned travel time, and available route information to retrieve relevant weather forecasts.
- Evaluate forecast conditions using explicit, deterministic backend rules.
- Add a weather buffer to the existing travel buffer when warranted.
- Recalculate suggested times using the existing schedule calculation rules.
- Display the weather summary, additional buffer, and forecast timestamp in the schedule details UI.
- Handle unavailable forecasts safely.

## Behavior

### Weather assessment

- Retrieve forecasts relevant to the planned trip time, using the best available route information.
- Evaluate relevant conditions such as precipitation, heavy rain, snow where applicable, strong winds, and severe weather indicators supported by the provider.
- Use documented, configurable thresholds to determine whether an additional buffer is needed.
- Avoid adding the same weather delay more than once.
- Clearly distinguish forecast conditions from actual live weather.

### Time calculations

- Keep existing base travel and preparation buffers unchanged.
- Calculate the weather buffer separately and add it to the travel buffer only when the configured rules warrant it.
- For `arrive_by`, calculate departure using the target arrival time, travel duration, base travel buffer, and weather buffer. Calculate preparation start using the existing preparation rules.
- For `leave_at`, preserve the user's target departure time. Update estimated arrival using the travel duration and any applicable weather adjustment, without moving the user's selected departure time.
- Never treat an unknown travel duration as zero.
- Do not invent a wake-up time when preparation duration is unknown.
- Keep timezone-aware calculations and future route-time behavior intact.

### Missing or unavailable weather

- If weather data is unavailable, invalid, or outside the provider's forecast coverage, do not invent weather conditions or an additional buffer.
- Preserve the existing routing estimate and base calculations.
- Indicate that weather information is unavailable so users understand that no weather adjustment was applied.
- Handle provider timeouts, errors, and rate limits safely.

### UI

Display:
- Weather summary for the planned trip.
- Whether an additional weather buffer was applied.
- The additional buffer duration, if any.
- Forecast retrieval/update time.
- A clear unavailable state when weather data cannot be retrieved.

Do not imply that forecasts guarantee actual conditions or travel times.

## Constraints

- Keep weather API credentials on the backend.
- Keep weather integration replaceable.
- Keep calculation rules deterministic and testable.
- Reuse existing routing, schedule calculation, authentication, and UI patterns.
- Avoid unrelated features, alternative route selection, and reminder implementation.

## Verification

Add tests for weather thresholds, additional buffer calculations, both time intents, missing or invalid forecasts, provider failures, timezone handling, and preservation of existing behavior.

Run backend tests, frontend tests, lint, TypeScript checks, production build, `git diff --check`, and Alembic checks if applicable.

Update `context/progress-tracker.md` and `context/decisions.md` where necessary.

## Definition of done

Weather-aware buffers work end to end, existing schedule calculations remain correct, failures safely fall back to base calculations, and automated verification passes. Report live API and browser verification separately from automated tests.