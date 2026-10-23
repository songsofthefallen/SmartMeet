function isSelectedLocation(location) {
  return Boolean(
    location &&
    typeof location.name === "string" && location.name.trim() &&
    typeof location.latitude === "number" && Number.isFinite(location.latitude) &&
    typeof location.longitude === "number" && Number.isFinite(location.longitude) &&
    location.latitude >= -90 && location.latitude <= 90 &&
    location.longitude >= -180 && location.longitude <= 180,
  );
}

function hasRouteLocations(origin, destination) {
  return isSelectedLocation(origin) && isSelectedLocation(destination);
}

function hasWeatherLocation(origin, destination) {
  return isSelectedLocation(origin) || isSelectedLocation(destination);
}

function weatherPointState(location, status, forecast) {
  if (!isSelectedLocation(location)) return "missing";
  if (status === "unavailable") return "unavailable";
  if (forecast) return "available";
  return "unavailable";
}

module.exports = { hasRouteLocations, hasWeatherLocation, isSelectedLocation, weatherPointState };
