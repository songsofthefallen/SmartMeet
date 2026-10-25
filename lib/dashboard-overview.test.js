/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const {
  getAvailableWeather,
  getDashboardContentState,
  getDepartureRecommendation,
  getScheduleHref,
  getTrafficSummary,
  getUpcomingSchedules,
  getValidTravelEstimate,
} = require("./dashboard-overview.js");

const now = Date.parse("2026-10-25T00:00:00Z");
const estimate = { duration_seconds: 1800, duration_minutes: 30, retrieved_at: "2026-10-24T23:00:00Z" };
const schedule = {
  id: 1,
  status: "active",
  is_past: false,
  target_datetime: "2026-10-26T08:00:00Z",
  time_intent: "arrival",
  origin_location: { name: "Home" },
  location: { name: "Office" },
  travel_duration_minutes: 30,
  calculated_departure_time: "2026-10-26T07:30:00Z",
  travel_estimate: estimate,
  weather_estimate: { status: "available", summary: "Light rain" },
  traffic_status: "some_delay",
  traffic_delay_minutes: 8,
};

const upcoming = getUpcomingSchedules([
  { ...schedule, id: 3, target_datetime: "2026-10-28T08:00:00Z" },
  { ...schedule, id: 2, target_datetime: "2026-10-26T09:00:00Z" },
  schedule,
  { ...schedule, id: 4, status: "cancelled", target_datetime: "2026-10-26T07:00:00Z" },
  { ...schedule, id: 5, status: "completed", target_datetime: "2026-10-26T06:00:00Z" },
  { ...schedule, id: 6, is_past: true, target_datetime: "2026-10-27T08:00:00Z" },
  { ...schedule, id: 7, target_datetime: "2026-10-25T00:00:00Z" },
  { ...schedule, id: 8, target_datetime: "invalid" },
], now);

assert.deepEqual(upcoming.map((item) => item.id), [1, 2, 3], "future active schedules are chronological; past and inactive schedules are excluded");
assert.equal(getUpcomingSchedules([schedule], now)[0], schedule, "a valid upcoming schedule is selected");
assert.deepEqual(getUpcomingSchedules(null, now), [], "missing schedule arrays produce no upcoming entries");

assert.equal(getValidTravelEstimate(schedule), estimate);
assert.equal(getDepartureRecommendation(schedule), schedule.calculated_departure_time);
for (const invalid of [
  { ...schedule, travel_estimate: null },
  { ...schedule, origin_location: null },
  { ...schedule, location: null },
  { ...schedule, route_availability: "no_drivable_route" },
  { ...schedule, travel_estimate: { ...estimate, duration_seconds: 0 } },
  { ...schedule, travel_estimate: { ...estimate, duration_minutes: -1 } },
  { ...schedule, travel_estimate: { ...estimate, retrieved_at: "invalid" } },
  { ...schedule, calculated_departure_time: "invalid" },
  { ...schedule, travel_duration_minutes: null },
]) {
  assert.equal(getDepartureRecommendation(invalid), null, "missing or invalid route inputs never produce a departure recommendation");
}
assert.equal(getValidTravelEstimate({ ...schedule, travel_estimate: null }), null);
assert.equal(getValidTravelEstimate({ ...schedule, travel_estimate: { ...estimate, duration_seconds: Infinity } }), null);

assert.equal(getAvailableWeather(schedule), schedule.weather_estimate);
assert.equal(getAvailableWeather({ ...schedule, travel_estimate: null }), schedule.weather_estimate, "weather remains independently available when route data is missing");
assert.equal(getValidTravelEstimate({ ...schedule, weather_estimate: { status: "unavailable" } }), estimate, "route remains independently available when weather is unavailable");
assert.equal(getAvailableWeather({ ...schedule, weather_estimate: { status: "unavailable" } }), null);
assert.equal(getAvailableWeather({ ...schedule, weather_estimate: { status: "available", summary: "", advisories: [] } }), null);

assert.deepEqual(getTrafficSummary(schedule), { status: "some_delay", delayMinutes: 8 });
assert.equal(getTrafficSummary({ ...schedule, travel_estimate: null }), null);
assert.equal(getTrafficSummary({ ...schedule, traffic_status: "unavailable", traffic_delay_minutes: null }), null);

assert.equal(getScheduleHref(42), "/schedules?open=42", "Dashboard links open the existing schedule detail route by ID");
assert.equal(getScheduleHref("42"), "/schedules?open=42");

assert.equal(getDashboardContentState("loading", false), "loading", "loading is not treated as empty");
assert.equal(getDashboardContentState("error", false), "error", "API errors are not treated as empty");
assert.equal(getDashboardContentState("ready", true), "upcoming");
assert.equal(getDashboardContentState("ready", false), "empty", "only a successful empty response is an empty state");

console.log("Dashboard selection, availability, links, and view-state checks passed.");
