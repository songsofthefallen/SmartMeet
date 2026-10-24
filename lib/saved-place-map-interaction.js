function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function centerFromMap(center) {
  const coordinate = { latitude: center.lat, longitude: center.lng };
  return isValidCoordinate(coordinate.latitude, coordinate.longitude)
    ? coordinate
    : { latitude: 0, longitude: 0 };
}

/** @returns {{center: [number, number], zoom: number}} */
function initialMapView(coordinate) {
  if (coordinate && isValidCoordinate(coordinate.latitude, coordinate.longitude)) {
    return { center: [coordinate.longitude, coordinate.latitude], zoom: 16 };
  }
  return { center: [0, 0], zoom: 2 };
}

function wheelZoom(currentZoom, deltaY, minimum = 0, maximum = 20) {
  const change = Math.max(-2, Math.min(2, -deltaY * 0.002));
  return Math.max(minimum, Math.min(maximum, currentZoom + change));
}

function subscribeToMapCenter(map, onCenterChange, onMoveStart = () => {}) {
  const update = () => onCenterChange(centerFromMap(map.getCenter()));
  map.on("movestart", onMoveStart);
  map.on("move", update);
  map.on("moveend", update);
  return () => {
    map.off("movestart", onMoveStart);
    map.off("move", update);
    map.off("moveend", update);
  };
}

function zoomAroundCenter(map, deltaY) {
  const center = map.getCenter();
  const zoom = wheelZoom(map.getZoom(), deltaY);
  map.easeTo({ center, zoom, duration: 100 });
  return zoom;
}

function mapFailureMessage(kind) {
  if (kind === "missing-key") return "Interactive map setup is incomplete. Configure NEXT_PUBLIC_TOMTOM_MAPS_API_KEY with a restricted TomTom Maps SDK key.";
  if (kind === "webgl") return "The interactive map could not be initialized. Check browser WebGL support and TomTom map configuration.";
  return "TomTom could not load the map. Check the SDK key and connection, then retry.";
}

module.exports = { centerFromMap, initialMapView, isValidCoordinate, mapFailureMessage, subscribeToMapCenter, wheelZoom, zoomAroundCenter };
