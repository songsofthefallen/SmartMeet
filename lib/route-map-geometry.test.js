/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { endpointFeatureCollection, routeFeatureCollection, selectedRouteOrFirst } = require("./route-map-geometry.js");

const routes = [
  { route_id: "a", geometry: [{ latitude: 15.1, longitude: 121.2 }, { latitude: 15.2, longitude: 121.3 }] },
  { route_id: "b", geometry: [{ latitude: 16.1, longitude: 122.2 }, { latitude: 16.2, longitude: 122.3 }] },
];
const collection = routeFeatureCollection(routes, "b");
assert.deepEqual(collection.features[0].geometry.coordinates, [[121.2, 15.1], [121.3, 15.2]], "route geometry is passed to GeoJSON in longitude, latitude order without shifting points");
assert.equal(collection.features[1].properties.selected, true, "route selection marks matching geometry for rendering");
assert.equal(selectedRouteOrFirst(routes, "b"), routes[1], "selection resolves the matching route summary");
assert.equal(selectedRouteOrFirst(routes, "missing"), routes[0], "invalid selection falls back to the first route");

const endpoints = endpointFeatureCollection({ latitude: 15.46, longitude: 121.08 }, { latitude: 15.4808, longitude: 121.044 });
assert.deepEqual(endpoints.features.map(({ geometry, properties }) => [properties.label, geometry.coordinates]), [["A", [121.08, 15.46]], ["B", [121.044, 15.4808]]], "distinct endpoint markers use the selected origin and destination coordinates");
assert.equal(routeFeatureCollection([{ route_id: "bad", geometry: [{ latitude: 0, longitude: 181 }, { latitude: 1, longitude: 1 }] }], "bad").features.length, 0, "invalid or incomplete route lines are not drawn");
console.log("route-map-geometry tests passed");
