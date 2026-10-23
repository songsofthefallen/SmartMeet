/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { hasRouteLocations, hasWeatherLocation, isSelectedLocation, weatherPointState } = require("./location-aware-state.js");

const origin = { name: "Tokyo Station", latitude: 35.6812, longitude: 139.7671 };
const destination = { name: "Manila", latitude: 14.5995, longitude: 120.9842 };

assert.equal(hasRouteLocations(null, null), false);
assert.equal(hasRouteLocations(origin, null), false);
assert.equal(hasRouteLocations(null, destination), false);
assert.equal(hasRouteLocations(origin, destination), true);
assert.equal(isSelectedLocation({ name: "Typed text only" }), false);
assert.equal(hasWeatherLocation(null, null), false);
assert.equal(hasWeatherLocation(origin, null), true);
assert.equal(hasWeatherLocation(null, destination), true);
assert.equal(weatherPointState(origin, "available", { condition: "Clear" }), "available");
assert.equal(weatherPointState(origin, "unavailable", null), "unavailable");
assert.equal(weatherPointState(null, "unavailable", null), "missing");

console.log("Location-aware route and weather state tests passed.");
