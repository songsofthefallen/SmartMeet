/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const {
  PAST_SCHEDULE_BANNER_TITLE,
  showPastScheduleNotices,
  showPostDepartureRouteWarning,
  showStaleEstimateWarning,
  historicalEstimateNotice,
} = require("./schedule-warning-display.js");

assert.equal(PAST_SCHEDULE_BANNER_TITLE, "Past schedule · Departure time has passed");
assert.equal(showPastScheduleNotices(true), true);
assert.equal(showPastScheduleNotices(false), false);

const historicalNotice = historicalEstimateNotice("Oct 17, 2026, 8:30:00 AM");
assert.match(historicalNotice, /Historical estimate for reference only/);
assert.match(historicalNotice, /retrieved Oct 17, 2026, 8:30:00 AM/);
assert.match(historicalNotice, /not current travel guidance/);

const afterDepartureWarning = "This traffic estimate was retrieved after the intended departure time.";
assert.equal(showPostDepartureRouteWarning(true, afterDepartureWarning), false);
assert.equal(showPostDepartureRouteWarning(false, afterDepartureWarning), true);
assert.equal(showPostDepartureRouteWarning(false, null), false);

const now = Date.parse("2026-10-17T00:30:00Z");
const staleEstimate = "2026-10-17T00:00:00Z";
const freshEstimate = "2026-10-17T00:20:00Z";
assert.equal(showStaleEstimateWarning(true, staleEstimate, now), false);
assert.equal(showStaleEstimateWarning(false, staleEstimate, now), true);
assert.equal(showStaleEstimateWarning(false, freshEstimate, now), false);
assert.equal(showPastScheduleNotices(true), true, "past schedule banner remains visible");
assert.match(historicalNotice, /Historical estimate for reference only/, "historical estimate notice remains visible");
