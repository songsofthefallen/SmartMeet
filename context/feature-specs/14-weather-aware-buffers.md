# Spec 14 — Weather Advisories

## Goal

Warn users about forecast conditions at their selected origin and destination that might affect a trip. Weather is informational and never changes route duration or deterministic schedule calculations.

## Behavior

- Reuse Open-Meteo and assess hourly conditions at the selected origin near calculated departure and destination near calculated arrival.
- Preserve routing provider duration and traffic information as the travel estimate. Preserve the user's configured travel and preparation buffers as independent deterministic inputs.
- Use the existing initial advisory rules: precipitation at least 2.5 mm/hour, heavy rain at least 7.5 mm/hour, snowfall at least 1 cm/hour, wind at least 50 km/hour, and WMO thunderstorm codes 95, 96, or 99. These are application thresholds, not provider severity guarantees.
- Create endpoint-specific advisories with the condition and sampled forecast hour. Warn that conditions may affect the trip; do not describe them as measured delays or guaranteed effects.
- When no threshold is met, state that no significant concerns were detected at the selected route endpoints. Clarify that forecasts do not cover every location along the route.
- If the forecast is unavailable, show “Weather information is temporarily unavailable.” Do not infer clear weather or change schedule calculations.
- Preserve bounded provider timeouts, safe fallback behavior, and sanitized diagnostics.
- Keep reading legacy JSON weather-buffer properties for compatibility with existing schedules, but omit them from new estimates and API responses. No data cleanup or table migration is required.

## UI

- Label the section “Weather advisory,” separate it visually from route duration and traffic delay, and show condition, affected endpoint, and approximate forecast time.
- Show endpoint forecast detail where available, and distinguish forecast data from observations.
- Never display weather minutes or claim that weather changed a calculated time.

## Verification

- Cover rain, heavy rain, strong winds, thunderstorms, clear conditions, unavailable forecasts, both schedule intents, unchanged calculated times and configured buffers, routing, and existing API behavior.
- Run backend and frontend tests, lint, TypeScript, production build, `git diff --check`, and Alembic checks as applicable.
- Record live provider and browser checks separately from automated results.
