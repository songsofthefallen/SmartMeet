# Spec 12 — Location and Geocoding

## Goal
Resolve user-provided place names or addresses into validated geographic coordinates for future routing and travel-time estimates.

## Requirements
- Support locations such as school names, business names, landmarks, and street addresses.
- Use TomTom Search API Fuzzy Search for place/address results. Enable `typeahead` for interactive partial queries; keep the provider integration replaceable.
- Keep the TomTom API key server-side in `backend/.env` as `TOMTOM_API_KEY`. Never pass the key to the frontend.
- Return the matched place name, locality/region/country when available, latitude, longitude, and timezone when available.
- Handle no results, multiple matches, invalid input, and provider/API failures.
- Ask the user to choose when results are ambiguous. Never silently select an uncertain match.
- Preserve the selected location in the schedule so later routing can reuse its coordinates.
- Validate coordinates and avoid exposing API secrets.
- Keep existing authentication, schedule ownership, time calculations, and autosave behavior intact.

## Scope
- Implement the backend TomTom Search adapter and validated response schemas.
- Use the authenticated location-search endpoint for place lookup and typeahead.
- Integrate location search and selection into the existing schedule assistant UI.
- Add tests for successful results, no matches, ambiguous results, invalid input, provider failures, and authentication.
- Do not implement routing, traffic, weather buffers, or notifications.

## Acceptance Criteria
- A user can search for a place and select the correct result.
- Ambiguous results require explicit user selection.
- Missing or failed search results produce a useful message and do not create an invalid location.
- Selected coordinates persist with the schedule and remain available after refresh.
- Existing schedule creation, editing, calculations, and cancellation still work.

## Verification
Run backend tests, frontend tests, lint, TypeScript checks, production build, and `git diff --check`. Verify location search and schedule persistence in the browser.
