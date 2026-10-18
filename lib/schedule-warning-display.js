/* eslint-disable @typescript-eslint/no-require-imports */
const { isTrafficEstimateStale } = require("./traffic-display.js");

const PAST_SCHEDULE_BANNER_TITLE = "Past schedule · Departure time has passed";

function showPastScheduleNotices(isPast) {
  return Boolean(isPast);
}

function showPostDepartureRouteWarning(isPast, routeWarning) {
  return Boolean(routeWarning) && !isPast;
}

function showStaleEstimateWarning(isPast, retrievedAt, now) {
  return !isPast && isTrafficEstimateStale(retrievedAt, now);
}

function showTravelTrafficCard(isPast, hasEstimate, hasRouteLocations = false) {
  return Boolean(isPast || hasEstimate || hasRouteLocations);
}

function historicalEstimateNotice(retrievedAt) {
  return `Historical estimate for reference only, retrieved ${retrievedAt}. It is not current travel guidance.`;
}

module.exports = {
  PAST_SCHEDULE_BANNER_TITLE,
  showPastScheduleNotices,
  showPostDepartureRouteWarning,
  showStaleEstimateWarning,
  showTravelTrafficCard,
  historicalEstimateNotice,
};

