import assert from "node:assert/strict";
import test from "node:test";
import { routeGeometryDiagnostic, routeLineDiagnostic, sampleRouteGeometry } from "./route-overlay-diagnostics.js";

const route = {
  route_id: "2",
  duration_seconds: 1234,
  duration_minutes: 21,
  distance_meters: 9876,
  traffic_delay_seconds: 45,
  no_traffic_travel_time_seconds: null,
  historic_traffic_travel_time_seconds: null,
  live_traffic_incidents_travel_time_seconds: null,
  traffic_sections: [],
  road_names: [],
  geometry: Array.from({ length: 10 }, (_, index) => ({ latitude: 14 + index / 100, longitude: 121 + index / 100 })),
};

test("route diagnostic compactly preserves endpoints and renderer samples", () => {
  const raw = routeGeometryDiagnostic(route);
  assert.equal(raw.route_id, "2");
  assert.equal(raw.distance_meters, 9876);
  assert.equal(raw.duration_seconds, 1234);
  assert.equal(raw.duration_minutes, 21);
  assert.equal(raw.geometry_point_count, 10);
  assert.deepEqual(raw.geometry_first_and_last_points, [
    ...route.geometry.slice(0, 3),
    ...route.geometry.slice(-3),
  ]);

  const rendered = routeLineDiagnostic(route, true, (point) => `${point.longitude},${point.latitude}`);
  assert.equal(rendered.selected, true);
  assert.equal(rendered.renderer_line_point_count, 10);
  assert.deepEqual(rendered.renderer_line_first_and_last_points[0], {
    latitude: route.geometry[0].latitude,
    longitude: route.geometry[0].longitude,
    svg_xy: "121,14",
  });
  assert.deepEqual(rendered.renderer_line_first_and_last_points.at(-1), {
    latitude: route.geometry.at(-1)?.latitude,
    longitude: route.geometry.at(-1)?.longitude,
    svg_xy: "121.09,14.09",
  });
});

test("short route diagnostics do not duplicate points in the first/last sample", () => {
  const shortRoute = { ...route, geometry: route.geometry.slice(0, 4) };
  assert.deepEqual(routeGeometryDiagnostic(shortRoute).geometry_first_and_last_points, shortRoute.geometry);
});

test("route geometry samples are evenly spaced and include both endpoints", () => {
  const points = Array.from({ length: 74 }, (_, index) => ({ latitude: index + 0.25, longitude: index + 100.5 }));
  const samples = sampleRouteGeometry(points);

  assert.deepEqual(samples.map(({ index }) => index), [0, 9, 18, 27, 37, 46, 55, 64, 73]);
  assert.equal(samples[0]?.point, points[0]);
  assert.equal(samples.at(-1)?.point, points.at(-1));
});

test("renderer diagnostic samples actual geometry and projection inputs", () => {
  const selected = routeLineDiagnostic(route, true, (point) => `${point.longitude * 2},${point.latitude * 3}`);
  const alternate = routeLineDiagnostic(route, false, (point) => `${point.longitude * 2},${point.latitude * 3}`);

  assert.deepEqual(selected.sampled_geometry_points[0], {
    index: 0,
    latitude: route.geometry[0]?.latitude,
    longitude: route.geometry[0]?.longitude,
    projected_x: (route.geometry[0]?.longitude ?? 0) * 2,
    projected_y: (route.geometry[0]?.latitude ?? 0) * 3,
    belongs_to_selected_route_geometry: true,
  });
  assert.equal(selected.sampled_geometry_points.at(-1)?.index, 9);
  assert.ok(selected.sampled_geometry_points.every((point) => point.belongs_to_selected_route_geometry));
  assert.ok(alternate.sampled_geometry_points.every((point) => !point.belongs_to_selected_route_geometry));
});
