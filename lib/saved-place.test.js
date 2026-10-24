/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { savedPlaceLocation } = require("./saved-place.js");

const place = {
  id: 9, alias: "Work", display_name: "Office", latitude: 14.6, longitude: 121.0,
  formatted_address: "Makati, Philippines", locality: "Makati", region: "Metro Manila",
  country: "Philippines", timezone: "Asia/Manila", location_source: "tomtom_search",
  created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z",
};
const origin = savedPlaceLocation(place);
const destination = savedPlaceLocation({ ...place, alias: "School", display_name: "Campus", latitude: 14.61, longitude: 120.99 });
assert.deepEqual(origin, {
  name: "Office", locality: "Makati", region: "Metro Manila", country: "Philippines",
  latitude: 14.6, longitude: 121, timezone: "Asia/Manila",
});
assert.deepEqual(destination, {
  name: "Campus", locality: "Makati", region: "Metro Manila", country: "Philippines",
  latitude: 14.61, longitude: 120.99, timezone: "Asia/Manila",
});
console.log("Saved place selection tests passed.");
