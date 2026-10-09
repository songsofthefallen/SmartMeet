# Project Overview — Deadline Notifier

## Summary
Deadline Notifier is a web app that helps users plan when to leave and when to wake up for an event. Users can describe plans in natural language, such as “I need to be at school at 7 tomorrow” or “I need to leave school at 5.” The app interprets whether the stated time is an arrival or departure time, resolves locations, estimates travel time when supported, calculates suggested departure/wake-up times, and reminds the user.

## Problem
People may underestimate preparation time, travel time, traffic, or weather-related delays and arrive late or leave too early.

## Product Goals
1. Let users enter schedules in natural language.
2. Interpret whether the user specifies arrival time, departure time, or an unclear time intent.
3. Convert requests into explicit, validated schedule fields.
4. Ask a targeted clarification only when required information is missing or ambiguous.
5. Automatically save a schedule when required fields are valid, with a visible success result and an option to edit/cancel.
6. Calculate suggested departure and wake-up times using explicit backend rules.
7. Persist schedules for authenticated users.
8. Send browser notifications for upcoming reminders, subject to browser permission and support.
9. Later, improve estimates using routing/traffic and weather data.

## Core User Flow
1. User signs in.
2. User enters a natural-language schedule.
3. AI extracts candidate fields and time intent.
4. Backend validates the output and resolves any required ambiguity.
5. If valid, the schedule is saved automatically; if not, the app asks a focused follow-up question.
6. The backend calculates any supported estimates.
7. The user sees the saved schedule and can edit or cancel it.
8. Browser notifications remind the user when supported and permission has been granted.

## Proposed MVP Scope
- Next.js frontend.
- Python/FastAPI backend.
- Clerk authentication from the start; no custom authentication system.
- AI extraction behind configurable provider/model settings.
- Pydantic validation and explicit handling of missing/ambiguous fields.
- Automatic saving once required fields pass validation.
- Persistent schedule storage, with database technology to be decided.
- Initial deterministic time calculation using explicit/default durations.
- Web Push notifications using a service worker and push subscriptions, with permission and unsupported-browser states.
- Clear loading, success, clarification, and error states.

## Later Features
- Saved place aliases such as Home, School, Gym, and Work.
- Geocoding and route/travel-time APIs.
- Traffic-aware estimates.
- Weather-aware buffers.
- Recalculation when conditions change.
- More notification channels or native mobile support.
- Calendar integrations and recurring schedules if prioritized.

## Out of Scope for Initial MVP
- Guaranteeing arrival times or perfect traffic predictions.
- Automatically changing the user's device alarm clock.
- Treating browser notifications as guaranteed delivery while the browser/device is unavailable.
- Advanced calendar integrations before the core scheduling flow works.
- Billing/subscriptions.
- Mobile-native applications.

## Success Criteria
- A user can sign in and submit a natural-language schedule.
- The system distinguishes arrival time from departure time when clear and asks when ambiguous.
- A valid schedule is saved without requiring an extra confirmation step.
- Missing information is not silently invented.
- Schedule calculations are deterministic and tested.
- Saved schedules persist across server restarts and are scoped to the correct user.
- Browser notification behavior and permission requirements are clearly communicated.
- Provider failures do not corrupt schedules or falsely report success.

## Product Questions
- How will FastAPI verify Clerk-issued identity tokens?
- Which durable scheduler/queue will trigger Web Push notifications?
- What exactly makes a schedule valid enough to auto-save?
- What default preparation and arrival buffers should apply?
- What should happen when the request is valid but travel duration is unavailable?
- Should recurring schedules be supported in the MVP?
