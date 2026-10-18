# Spec 16: Alternative Route Selection

## 1. Goal

Allow users to choose from multiple driving routes between their selected origin and destination instead of automatically using only TomTom's default fastest route.

This is intended for students and commuters who may prefer a different road or route that better matches their usual journey.

## 2. How It Should Work

1. The user selects a confirmed origin and destination.
2. The backend requests multiple route options from the existing TomTom Routing API.
3. The frontend displays the available routes for comparison.
4. The user selects their preferred route.
5. The backend uses the selected route as the source of truth for the saved travel estimate and dependent schedule calculations.

TomTom may return fewer alternatives than requested. The application must handle one or more available routes gracefully.

## 3. Requirements

### Route alternatives
- Request alternative routes using the existing TomTom Routing API integration.
- Request a reasonable number of alternatives, up to TomTom's supported maximum of five alternatives.
- Preserve existing traffic-aware routing and departure/arrival-time behavior.
- Process each returned route independently and validate its response fields.
- Do not fabricate alternatives when TomTom returns none.

### Route selection UI
- Display each available route as a selectable option.
- Show travel duration and distance, plus route-level traffic delay when available.
- Show meaningful road names or route characteristics when the provider supplies reliable information.
- Clearly identify the currently selected route.
- Handle loading, provider errors, and cases where no alternatives are available.
- Do not label a route as a jeepney, bus, or train itinerary. These are driving routes only.

### Selected-route consistency
The selected route must determine:
- Travel duration and estimated arrival or departure calculations, according to the existing time intent.
- The route geometry and traffic incident details displayed to the user.
- The timing used for the existing weather advisory.
- Any dependent suggested departure or wake-up time.

Changing the selected route must refresh or recalculate dependent estimates. Do not retain traffic or weather information from a different route as if it belonged to the selected one.

### Persistence
- Inspect the existing schedule and routing data model before deciding how to persist the selection.
- Preserve the selected route and its required metadata when a schedule is saved, using the smallest appropriate schema change if necessary.
- Existing schedules must continue to work when they have no stored selected-route metadata.
- Follow existing authentication, user-scoping, validation, and refresh-rate-limit rules.

## 4. Out of Scope

- Jeepney, bus, train, or multimodal public-transport itineraries.
- AI extraction changes.
- Changes to existing deterministic time-calculation formulas.
- Changes to weather advisory thresholds or traffic-delay semantics.
- A full navigation system with turn-by-turn guidance.

## 5. Acceptance Criteria

- The backend requests and correctly processes multiple routes when available.
- Users can compare the available routes and select one.
- The selected route consistently drives the saved estimate, traffic information, weather advisory timing, and dependent schedule calculations.
- Switching routes does not mix information from different routes.
- Missing alternatives and provider failures are handled without crashing or fabricating routes.
- Existing schedules, authentication, traffic refresh limits, and location-free workflows remain compatible.

## 6. Testing and Verification

Add or update tests for:
- Multiple alternatives, a single route, and no alternatives.
- Invalid or incomplete provider responses and provider failures.
- Route selection and persistence.
- Recalculation of dependent schedule times.
- Traffic and weather data matching the selected route.
- Compatibility with existing schedules and refresh limits.

Run relevant backend and frontend tests, ESLint, TypeScript checks, production build, and `git diff --check`.

Inspect the actual database schema before adding a migration. Never modify an existing applied migration to introduce a new schema change.

Update the progress tracker and decisions document where appropriate. Report test results, migration status, and remaining manual verification honestly.