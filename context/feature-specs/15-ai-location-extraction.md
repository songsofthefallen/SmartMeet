# Spec 16: AI Origin/Destination Extraction and Location Resolution

## 1. Goal

Improve AI schedule extraction so users can describe where they are travelling from and where they are going in natural language.

**Example:**

“I need to go to school at University of Santo Tomas from Santa Maria, Bulacan tomorrow. I need to arrive by 8 AM, and it takes 60 minutes to prepare.”

The system should extract the schedule details and identify the origin and destination.

## 2. How It Should Work

1. **Extract:** The AI identifies the origin, destination, date, target time, time intent, and any provided durations.
2. **Resolve:** The backend searches for matching places using the existing TomTom Search integration.
3. **Confirm:** If multiple places match, the user selects the correct one instead of the system guessing.
4. **Save:** Once the required information is valid, the existing schedule creation and autosave workflow continues.

Keep AI extraction separate from location resolution. The AI identifies place descriptions; TomTom provides real location candidates.

## 3. Requirements

- Extract origin and destination separately.
- Ask targeted questions when required information is missing.
- Show selectable candidates when a location is ambiguous.
- Never invent coordinates or save an unresolved location as confirmed.
- Preserve confirmed locations when the user edits unrelated schedule details.
- If the user changes a location, resolve the new description and invalidate the old selection.
- Reuse the existing location models, API, TomTom service, and schedule workflow.
- Keep API keys on the backend.
- Preserve existing authentication, autosave, idempotency, routing, and time calculations.
- Schedules that do not require locations must continue working as they do today.

## 4. Out of Scope

Do not implement alternative driving routes, public-transit routing, or changes to traffic, weather, and time-calculation logic. Those are separate features.

## 5. Acceptance Criteria

- The example prompt correctly extracts its origin, destination, and schedule details.
- Missing or ambiguous locations are handled through targeted questions or candidate selection.
- Provider failures and empty search results do not create fabricated locations.
- Confirmed locations survive unrelated edits.
- Changing a location triggers a new resolution.
- Existing schedule creation and routing behavior remain functional.

## 6. Testing and Implementation

Before coding, inspect the existing extraction flow, location schemas, TomTom Search service, and frontend selection UI.

Add tests for extraction, missing and ambiguous locations, provider failures, selection preservation, and compatibility with the existing schedule workflow.

Run relevant backend and frontend tests, linting, TypeScript checks, production build, and `git diff --check`. Add a database migration only if inspection shows one is necessary.

Update the progress tracker and report test results and any remaining manual checks honestly.