/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { savedPlacesViewState } = require("./saved-places-view.js");

assert.equal(savedPlacesViewState(true, null, false), "loading");
assert.equal(savedPlacesViewState(false, null, false), "empty");
assert.equal(savedPlacesViewState(false, "Service unavailable", false), "error");
assert.equal(savedPlacesViewState(false, null, true), "list");
console.log("Saved places loading, empty, error, and list states passed.");
