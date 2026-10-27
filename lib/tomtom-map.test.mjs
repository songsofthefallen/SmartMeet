import assert from "node:assert/strict";
import { smartMeetMapOptions } from "./tomtom-map.ts";

const container = {};
const pickerOptions = smartMeetMapOptions(container, "restricted-browser-key", [121.08, 15.46], 16, false);
assert.equal(pickerOptions.style, "streetDark");
assert.equal(pickerOptions.apiKey, "restricted-browser-key");
assert.equal(pickerOptions.mapLibre.container, container);
assert.deepEqual(pickerOptions.mapLibre.center, [121.08, 15.46]);
assert.equal(pickerOptions.mapLibre.scrollZoom, false, "Saved Places keeps its centered custom wheel-zoom behavior");
assert.equal(pickerOptions.mapLibre.dragPan, true);

const routeOptions = smartMeetMapOptions(container, "restricted-browser-key", [121.08, 15.46], 12, true);
assert.equal(routeOptions.style, pickerOptions.style);
assert.equal(routeOptions.apiKey, pickerOptions.apiKey);
assert.equal(routeOptions.mapLibre.scrollZoom, true, "route maps support native wheel zoom");
console.log("TomTom map configuration tests passed");
