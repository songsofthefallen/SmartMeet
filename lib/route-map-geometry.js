export const ROUTE_COLORS = ["#2563EB", "#DC2626", "#7C3AED", "#059669", "#D97706", "#DB2777"];

export function isValidMapCoordinate(point) {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

export function routeFeatureCollection(routes, selectedRouteId) {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route, index) => {
      const coordinates = (route.geometry ?? []).filter(isValidMapCoordinate).map(({ latitude, longitude }) => [longitude, latitude]);
      return coordinates.length > 1 ? [{
        type: "Feature",
        properties: { route_id: route.route_id, color: ROUTE_COLORS[index % ROUTE_COLORS.length], selected: route.route_id === selectedRouteId },
        geometry: { type: "LineString", coordinates },
      }] : [];
    }),
  };
}

export function endpointFeatureCollection(origin, destination, fallback = []) {
  const start = origin ?? fallback[0];
  const end = destination ?? fallback.at(-1);
  return {
    type: "FeatureCollection",
    features: [
      ...(start && isValidMapCoordinate(start) ? [{ type: "Feature", properties: { label: "A", color: "#047857" }, geometry: { type: "Point", coordinates: [start.longitude, start.latitude] } }] : []),
      ...(end && isValidMapCoordinate(end) ? [{ type: "Feature", properties: { label: "B", color: "#D97706" }, geometry: { type: "Point", coordinates: [end.longitude, end.latitude] } }] : []),
    ],
  };
}

export function selectedRouteOrFirst(routes, selectedRouteId) {
  return routes.find((route) => route.route_id === selectedRouteId) ?? routes[0];
}
