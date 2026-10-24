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
  return { center: [120.9842, 14.5995], zoom: 12 };
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
  if (kind === "INVALID_CREDENTIALS") return "TomTom rejected the map key. Check that it is active and enabled for Maps SDK requests.";
  if (kind === "INSUFFICIENT_PERMISSIONS") return "The TomTom key cannot load this map. Check Maps SDK permissions and allowed domains.";
  if (kind === "NETWORK_NOT_AVAILABLE") return "The map could not reach TomTom. Check the network, DNS, TLS, or browser blocking, then retry.";
  if (kind === "RATE_LIMITED") return "TomTom temporarily limited map requests. Wait a moment, then retry.";
  if (kind === "LIVE_SERVICE_NOT_AVAILABLE") return "TomTom map services are temporarily unavailable. Retry in a moment.";
  if (kind === "WEBGL_CONTEXT_LOST" || kind === "WEBGL_UNSUPPORTED") return "The browser could not draw the map with WebGL. Check browser and graphics acceleration settings.";
  if (kind === "STYLE_LOAD_FAILED") return "TomTom could not load the map style. Check the browser Network panel for the failed style request.";
  return "TomTom could not load map data. Check the browser Network panel for failed style, tile, sprite, or glyph requests.";
}

module.exports = { centerFromMap, initialMapView, isValidCoordinate, mapFailureMessage, subscribeToMapCenter, wheelZoom, zoomAroundCenter };
