const labels = {
  little_or_no_delay: "Little or no delay",
  some_delay: "Some traffic delay",
  significant_delay: "Significant traffic delay",
  unavailable: "Traffic status unavailable",
};

function trafficStatusLabel(status) {
  return labels[status] ?? labels.unavailable;
}

function trafficDataSourceLabel(source) {
  if (source === "live_available") return "Live-speed comparison available";
  if (source === "historical_available") return "Historical comparison available";
  if (source === "live_and_historical_available") return "Live-speed and historical comparisons available";
  return "Traffic comparison data unavailable";
}

function routeTimeBasisLabel(basis) {
  if (basis === "scheduled_departure") return "Routed for the scheduled departure time";
  if (basis === "scheduled_arrival") return "Routed for the scheduled arrival time";
  return "Routed using current conditions";
}

function isTrafficEstimateStale(retrievedAt, now = Date.now()) {
  const timestamp = Date.parse(retrievedAt);
  return Number.isFinite(timestamp) && now - timestamp > 15 * 60 * 1000;
}

module.exports = { trafficStatusLabel, trafficDataSourceLabel, routeTimeBasisLabel, isTrafficEstimateStale };
