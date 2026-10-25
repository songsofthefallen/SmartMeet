function getUpcomingSchedules(schedules, now = Date.now()) {
  if (!Array.isArray(schedules)) return [];
  return schedules
    .filter((schedule) =>
      schedule &&
      schedule.status === "active" &&
      schedule.is_past === false &&
      Number.isFinite(Date.parse(schedule.target_datetime)) &&
      Date.parse(schedule.target_datetime) > now
    )
    .sort((left, right) => Date.parse(left.target_datetime) - Date.parse(right.target_datetime));
}

function getValidTravelEstimate(schedule) {
  const estimate = schedule?.travel_estimate;
  if (!estimate || schedule.route_availability === "no_drivable_route") return null;
  if (!schedule.origin_location || !schedule.location) return null;
  if (!Number.isFinite(estimate.duration_seconds) || estimate.duration_seconds <= 0) return null;
  if (!Number.isFinite(estimate.duration_minutes) || estimate.duration_minutes <= 0) return null;
  if (!Number.isFinite(Date.parse(estimate.retrieved_at))) return null;
  return estimate;
}

function getDepartureRecommendation(schedule) {
  if (schedule?.time_intent !== "arrival") return null;
  const estimate = getValidTravelEstimate(schedule);
  if (!estimate || !Number.isFinite(schedule.travel_duration_minutes) || schedule.travel_duration_minutes <= 0) return null;
  if (!Number.isFinite(Date.parse(schedule.calculated_departure_time))) return null;
  return schedule.calculated_departure_time;
}

function getAvailableWeather(schedule) {
  const weather = schedule?.weather_estimate;
  if (!weather || weather.status !== "available") return null;
  if (typeof weather.summary !== "string" || (!weather.summary.trim() && !weather.advisories?.length)) return null;
  return weather;
}

function getTrafficSummary(schedule) {
  const estimate = getValidTravelEstimate(schedule);
  if (!estimate) return null;
  const delayMinutes = Number.isFinite(schedule.traffic_delay_minutes) && schedule.traffic_delay_minutes > 0
    ? schedule.traffic_delay_minutes
    : null;
  if (schedule.traffic_status === "unavailable" && delayMinutes === null) return null;
  return {
    status: schedule.traffic_status,
    delayMinutes,
  };
}

module.exports = { getUpcomingSchedules, getValidTravelEstimate, getDepartureRecommendation, getAvailableWeather, getTrafficSummary };
