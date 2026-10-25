/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { getUpcomingSchedules, getValidTravelEstimate, getDepartureRecommendation, getAvailableWeather, getTrafficSummary } = require("./dashboard-overview.js");

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

assert.deepEqual(getUpcomingSchedules([
  { ...schedule, id: 2, target_datetime: "2026-10-27T08:00:00Z" },
  schedule,
  { ...schedule, id: 3, target_datetime: "2026-10-25T00:00:00Z" },
  { ...schedule, id: 4, status: "cancelled" },
  { ...schedule, id: 5, status: "completed" },
  { ...schedule, id: 6, is_past: true },
  { ...schedule, id: 7, target_datetime: "invalid" },
], now).map((item) => item.id), [1, 2]);
assert.equal(getValidTravelEstimate(schedule), estimate);
assert.equal(getValidTravelEstimate({ ...schedule, travel_estimate: null }), null);
assert.equal(getValidTravelEstimate({ ...schedule, location: null }), null);
assert.equal(getValidTravelEstimate({ ...schedule, route_availability: "no_drivable_route" }), null);
assert.equal(getValidTravelEstimate({ ...schedule, travel_estimate: { ...estimate, duration_seconds: 0 } }), null);
assert.equal(getDepartureRecommendation(schedule), schedule.calculated_departure_time);
assert.equal(getDepartureRecommendation({ ...schedule, time_intent: "departure" }), null);
assert.equal(getDepartureRecommendation({ ...schedule, travel_estimate: null }), null);
assert.equal(getDepartureRecommendation({ ...schedule, calculated_departure_time: null }), null);
assert.equal(getAvailableWeather(schedule), schedule.weather_estimate);
assert.equal(getAvailableWeather({ ...schedule, weather_estimate: { status: "unavailable" } }), null);
assert.deepEqual(getTrafficSummary(schedule), { status: "some_delay", delayMinutes: 8 });
assert.equal(getTrafficSummary({ ...schedule, travel_estimate: null }), null);
assert.equal(getTrafficSummary({ ...schedule, traffic_status: "unavailable", traffic_delay_minutes: null }), null);
assert.equal(getAvailableWeather({ ...schedule, weather_estimate: { status: "available", summary: "", advisories: [] } }), null);

console.log("Dashboard schedule filtering and supported estimate display checks passed.");
