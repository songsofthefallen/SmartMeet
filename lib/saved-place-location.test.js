/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { isValidCoordinate, requestCurrentLocation } = require("./saved-place-location.js");
async function run() {
  const success = await requestCurrentLocation({ getCurrentPosition(resolve, _reject, options) {
    assert.equal(options.timeout, 12000);
    resolve({ coords: { latitude: 14.61, longitude: 121.02 } });
  } });
  assert.deepEqual(success, { latitude: 14.61, longitude: 121.02 });
  for (const [browserCode, expected] of [[1, "denied"], [3, "timeout"], [2, "unavailable"]]) {
    await assert.rejects(requestCurrentLocation({ getCurrentPosition(_resolve, reject) { reject({ code: browserCode }); } }), (error) => error.code === expected);
  }
  await assert.rejects(requestCurrentLocation(null), (error) => error.code === "unavailable");
  assert.equal(isValidCoordinate(90, 180), true);
  assert.equal(isValidCoordinate(90.01, 0), false);
  assert.equal(isValidCoordinate(0, -180.01), false);
  console.log("Saved place geolocation and coordinate validation tests passed.");
}
void run();
