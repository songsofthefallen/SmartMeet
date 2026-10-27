/**
 * @typedef {{ latitude: number, longitude: number }} RouteGeometryPoint
 * @typedef {import("./schedule-api").RouteAlternativeEstimate} RouteAlternativeEstimate
 */

/** @template T @param {T[]} points @param {number} [count] @returns {T[]} */
export function sampleRoutePoints(points, count = 3) {
  if (points.length <= count * 2) return points;
  return [...points.slice(0, count), ...points.slice(-count)];
}

/** @template T @param {T[]} points @param {number} [count] @returns {{ index: number, point: T }[]} */
export function sampleRouteGeometry(points, count = 9) {
  if (points.length === 0 || count < 1) return [];
  if (points.length <= count) {
    return points.map((point, index) => ({ index, point }));
  }
  if (count === 1) return [{ index: 0, point: points[0] }];
  return Array.from({ length: count }, (_, sampleIndex) => {
    const index = Math.round(sampleIndex * (points.length - 1) / (count - 1));
    return { index, point: points[index] };
  });
}

/** @param {RouteAlternativeEstimate} route */
export function routeGeometryDiagnostic(route) {
  const geometry = route.geometry ?? [];
  return {
    route_id: route.route_id,
    distance_meters: route.distance_meters,
    duration_seconds: route.duration_seconds,
    duration_minutes: route.duration_minutes,
    geometry_point_count: geometry.length,
    geometry_first_and_last_points: sampleRoutePoints(geometry),
  };
}

/**
 * @param {RouteAlternativeEstimate} route
 * @param {boolean} selected
 * @param {(point: RouteGeometryPoint) => string} project
 */
export function routeLineDiagnostic(route, selected, project) {
  const geometry = route.geometry ?? [];
  return {
    ...routeGeometryDiagnostic(route),
    selected,
    renderer_line_point_count: geometry.length,
    sampled_geometry_points: sampleRouteGeometry(geometry).map(({ index, point }) => {
      const [projected_x, projected_y] = project(point).split(",").map(Number);
      return {
        index,
        latitude: point.latitude,
        longitude: point.longitude,
        projected_x,
        projected_y,
        belongs_to_selected_route_geometry: selected,
      };
    }),
    renderer_line_first_and_last_points: sampleRoutePoints(geometry).map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude,
      svg_xy: project(point),
    })),
  };
}
