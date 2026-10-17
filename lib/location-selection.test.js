/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { shouldInvalidateLocationSelection } = require("./location-selection.js");

const confirmed = { name: "University of Santo Tomas", latitude: 14.6091, longitude: 120.9896 };
assert.equal(shouldInvalidateLocationSelection(confirmed, "University of Santo Tomas"), false);
assert.equal(shouldInvalidateLocationSelection(confirmed, "UST Manila"), true);
assert.equal(shouldInvalidateLocationSelection(null, "Santa Maria, Bulacan"), false);
console.log("Location selection invalidation tests passed.");
