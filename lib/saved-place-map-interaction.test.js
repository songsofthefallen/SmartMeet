/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { centerFromMap, initialMapView, isValidCoordinate, mapFailureMessage, subscribeToMapCenter, wheelZoom, zoomAroundCenter } = require("./saved-place-map-interaction.js");

const listeners = new Map();
const fakeMap = {
  center: { lat: 14.6, lng: 121 },
  zoom: 10,
  getCenter() { return this.center; },
  getZoom() { return this.zoom; },
  easeTo(options) { this.lastZoom = options; },
  on(event, callback) { listeners.set(event, callback); },
  off(event, callback) { if (listeners.get(event) === callback) listeners.delete(event); },
};

const received = [];
let moveStarts = 0;
const unsubscribe = subscribeToMapCenter(fakeMap, (coordinate) => received.push(coordinate), () => { moveStarts++; });
listeners.get("movestart")();
assert.equal(moveStarts, 1, "movement start can cancel pending settled work");
fakeMap.center = { lat: 14.61, lng: 120.99 };
listeners.get("move")();
assert.deepEqual(received.at(-1), { latitude: 14.61, longitude: 120.99 }, "map movement updates selected center coordinates");
fakeMap.center = { lat: 14.62, lng: 120.98 };
listeners.get("moveend")();
assert.deepEqual(received.at(-1), { latitude: 14.62, longitude: 120.98 }, "panning settles at its final center coordinate");
unsubscribe();
assert.equal(listeners.size, 0, "map interaction listeners are cleaned up");

assert.deepEqual(initialMapView({ latitude: 35.7, longitude: 139.7 }), { center: [139.7, 35.7], zoom: 16 }, "GPS coordinates initialize longitude/latitude map center");
assert.deepEqual(initialMapView(null), { center: [120.9842, 14.5995], zoom: 12 }, "new map selections start from a useful default center");
assert.ok(wheelZoom(10, -120) > 10, "wheel up zooms in");
assert.ok(wheelZoom(10, 120) < 10, "wheel down zooms out");
assert.equal(wheelZoom(19.9, -1200), 20, "wheel zoom respects maximum");
assert.equal(wheelZoom(0.1, 1200), 0, "wheel zoom respects minimum");
zoomAroundCenter(fakeMap, -120);
assert.deepEqual(fakeMap.lastZoom.center, fakeMap.center, "wheel zoom is anchored to map center");
assert.ok(fakeMap.lastZoom.zoom > fakeMap.zoom, "wheel zoom applies the computed zoom to the SDK map");
assert.deepEqual(centerFromMap({ lat: 95, lng: 0 }), { latitude: 0, longitude: 0 }, "invalid SDK centers are rejected safely");
assert.equal(isValidCoordinate(90, 180), true);
assert.equal(isValidCoordinate(90.01, 0), false);
assert.match(mapFailureMessage("missing-key"), /NEXT_PUBLIC_TOMTOM_MAPS_API_KEY/);
assert.match(mapFailureMessage("webgl"), /WebGL/);
assert.match(mapFailureMessage("provider"), /Network panel/);
assert.match(mapFailureMessage("INVALID_CREDENTIALS"), /key/);
assert.match(mapFailureMessage("INSUFFICIENT_PERMISSIONS"), /permissions and allowed domains/);
assert.match(mapFailureMessage("NETWORK_NOT_AVAILABLE"), /DNS, TLS/);
assert.match(mapFailureMessage("STYLE_LOAD_FAILED"), /failed style request/);
assert.match(mapFailureMessage("WEBGL_CONTEXT_LOST"), /WebGL/);
console.log("Saved place map panning, center updates, wheel zoom, GPS initialization, coordinate validation, and failure tests passed.");
