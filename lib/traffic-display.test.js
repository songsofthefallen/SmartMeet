/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { trafficStatusLabel, trafficDataSourceLabel, routeTimeBasisLabel, isTrafficEstimateStale } = require("./traffic-display.js");

assert.equal(trafficStatusLabel("little_or_no_delay"), "Little or no delay");
assert.equal(trafficStatusLabel("some_delay"), "Some traffic delay");
assert.equal(trafficStatusLabel("significant_delay"), "Significant traffic delay");
assert.equal(trafficStatusLabel("unavailable"), "Traffic status unavailable");
assert.equal(trafficStatusLabel(undefined), "Traffic status unavailable");

assert.equal(trafficDataSourceLabel("live_available"), "Live-speed comparison available");
assert.equal(trafficDataSourceLabel("historical_available"), "Historical comparison available");
assert.equal(trafficDataSourceLabel("live_and_historical_available"), "Live-speed and historical comparisons available");
assert.equal(trafficDataSourceLabel("unknown"), "Traffic comparison data unavailable");
assert.equal(routeTimeBasisLabel("scheduled_departure"), "Routed for the scheduled departure time");
assert.equal(routeTimeBasisLabel("scheduled_arrival"), "Routed for the scheduled arrival time");
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:15:01Z")), true);
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:15:00Z")), false);
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:14:59Z")), false);
assert.equal(isTrafficEstimateStale("not-a-date", Date.parse("2026-10-13T01:00:00Z")), false);
process.stdout.write("15 frontend traffic display assertions passed\n");
