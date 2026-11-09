/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { trafficStatusLabel, trafficDataSourceLabel, trafficEstimateType, trafficEstimateMessages, routeTrafficLabel, routeTrafficMetrics, routeCardExplanation, routeTimeBasisLabel, formatTrafficDelay, trafficIncidentLabel, trafficIncidentDetails, trafficRoadDesignations, groupTrafficSections, isTrafficEstimateStale } = require("./traffic-display.js");

assert.equal(trafficStatusLabel("little_or_no_delay"), "Little or no delay");
assert.equal(trafficStatusLabel("some_delay"), "Some traffic delay");
assert.equal(trafficStatusLabel("significant_delay"), "Significant traffic delay");
assert.equal(trafficStatusLabel("unavailable"), "Live traffic delay status unavailable");
assert.equal(trafficStatusLabel(undefined), "Live traffic delay status unavailable");

assert.equal(trafficDataSourceLabel("live_available"), "Live-speed comparison available");
assert.equal(trafficDataSourceLabel("historical_available"), "Historical comparison available");
assert.equal(trafficDataSourceLabel("live_and_historical_available"), "Live-speed and historical comparisons available");
assert.equal(trafficDataSourceLabel("unknown"), "Traffic comparison data unavailable");
assert.equal(routeTimeBasisLabel("scheduled_departure"), "Routed for the scheduled departure time");
assert.equal(routeTimeBasisLabel("scheduled_arrival"), "Routed for the scheduled arrival time");
const historicalOnly = { historic_traffic_travel_time_seconds: 840, no_traffic_travel_time_seconds: 780, traffic_delay_seconds: null, live_traffic_incidents_travel_time_seconds: null };
assert.equal(trafficEstimateType(historicalOnly, "scheduled_departure"), "historical");
assert.deepEqual(trafficEstimateMessages(historicalOnly, "scheduled_departure"), [
  "Historical traffic estimate",
  "Uses typical traffic patterns for the requested day and time; it is not an observation of future traffic.",
  "Live traffic delay unavailable.",
  "Historical travel time: 14 min.",
  "Free-flow comparison: 13 min.",
]);
assert.equal(trafficEstimateType({ no_traffic_travel_time_seconds: 780 }, "scheduled_departure"), "unavailable");
const currentWithBoth = { ...historicalOnly, traffic_delay_seconds: 60, live_traffic_incidents_travel_time_seconds: 900 };
assert.equal(trafficEstimateType(currentWithBoth, "current"), "live_and_historical");
assert.equal(trafficEstimateType(currentWithBoth, "scheduled_departure"), "historical", "future classifications must not label live comparison fields as future observations");
assert.ok(trafficEstimateMessages(currentWithBoth, "scheduled_departure").includes("Reported live traffic delay: 1 min. This is a current comparison, not an observation of future conditions."));
assert.equal(trafficEstimateType({}, "current"), "unavailable");
assert.equal(routeTrafficLabel("historical"), "Historical traffic");
assert.equal(routeTrafficLabel("live"), "Live traffic");
assert.equal(routeTrafficLabel("live_and_historical"), "Live + historical");
assert.equal(routeTrafficLabel("unavailable"), "Traffic unavailable");
assert.deepEqual(routeTrafficMetrics({
  historic_traffic_travel_time_seconds: 840,
  no_traffic_travel_time_seconds: 780,
  traffic_delay_seconds: null,
  live_traffic_incidents_travel_time_seconds: null,
}), [
  { field: "historic_traffic_travel_time_seconds", label: "Historical travel time", source: "historical", seconds: 840 },
  { field: "no_traffic_travel_time_seconds", label: "Free-flow travel time", source: "free_flow", seconds: 780 },
]);
assert.deepEqual(routeTrafficMetrics({ traffic_delay_seconds: 60, live_traffic_incidents_travel_time_seconds: 900 }), [
  { field: "traffic_delay_seconds", label: "Live traffic delay", source: "live", seconds: 60 },
  { field: "live_traffic_incidents_travel_time_seconds", label: "Live traffic incident travel time", source: "live", seconds: 900 },
]);
assert.deepEqual(routeTrafficMetrics({ historic_traffic_travel_time_seconds: null, no_traffic_travel_time_seconds: null, traffic_delay_seconds: undefined }), [], "missing optional metrics are omitted");
const comparedRoutes = [
  { route_id: "fastest", duration_seconds: 600, distance_meters: 9000 },
  { route_id: "selected-alternative", duration_seconds: 656, distance_meters: 4700 },
];
assert.equal(routeCardExplanation(comparedRoutes[0], comparedRoutes, "fastest"), "Fastest estimated route — 56 sec faster than the next alternative.");
assert.equal(routeCardExplanation(comparedRoutes[1], comparedRoutes, "fastest"), "4.3 km shorter, but 56 sec slower. May suit a shorter-distance preference.");
assert.equal(routeCardExplanation(comparedRoutes[0], [comparedRoutes[0]], "fastest"), "Only available route.");
assert.equal(routeCardExplanation({ route_id: "missing", duration_seconds: 10, distance_meters: null }, [{ route_id: "missing", duration_seconds: 10, distance_meters: null }], null), "Estimated travel time shown.");
const routeWorkspaceSource = readFileSync("app/schedules/schedule-workspace.tsx", "utf8");
assert.match(routeWorkspaceSource, /<details className=.*?Traffic details/s, "traffic metrics use a native expandable details section");
assert.match(routeWorkspaceSource, /<summary className=.*?Traffic details/s, "the details section has an accessible summary control");
assert.doesNotMatch(routeWorkspaceSource, /<details[^>]*\bopen(?:=|\s|>)/, "traffic details start collapsed and expand through the native summary control");
assert.match(routeWorkspaceSource, /selected=\{selectedRouteId === route\.route_id\} onSelect=\{setSelectedRouteId\}/, "selection remains independent from the recommended route");
assert.match(routeWorkspaceSource, /recommendedRouteId=\{currentRouteRecommendation\?\.recommended_route_id/, "recommended status remains driven by the backend recommendation");
assert.match(routeWorkspaceSource, /routeTrafficMetrics\(route\)/, "only actual optional metrics are rendered in traffic details");
assert.equal(formatTrafficDelay(299), "4 min 59 sec");
assert.equal(formatTrafficDelay(600), "10 min");
assert.equal(formatTrafficDelay(61), "1 min 1 sec");
assert.equal(formatTrafficDelay(0), "0 sec");
assert.equal(trafficIncidentLabel("JAM"), "Traffic jam reported");
assert.equal(trafficIncidentLabel("ROAD_WORK"), "Road work reported");
assert.equal(trafficIncidentLabel("ROAD_CLOSURE"), "Road closure reported");
assert.equal(trafficIncidentLabel(undefined), null);
assert.deepEqual(trafficRoadDesignations({ road_numbers: ["AH26", "1", "E3", "AH26", "Route 1", ""] }), ["AH26", "E3"]);
const groupedTraffic = groupTrafficSections([
  { road_names: ["Epifanio Delos Santos Avenue"], road_numbers: ["AH26", "1"], incident_type: "JAM", delay_seconds: 300 },
  { road_names: ["  epifanio   delos santos avenue  "], road_numbers: ["AH26"], incident_type: "ROAD_WORK", delay_seconds: 61 },
  { road_names: ["Cavitex"], road_numbers: ["AH26", "E3"], incident_type: "OTHER", delay_seconds: 90 },
  { road_names: [], road_numbers: ["E3"], approximate_location: "Ortigas Avenue", location_source: "reverse_geocoding", start_coordinates: { latitude: 14.582, longitude: 121.0579 }, incident_type: "JAM", delay_seconds: null },
]);
assert.equal(groupedTraffic.length, 3);
assert.equal(groupedTraffic[0].road_name, "Epifanio Delos Santos Avenue");
assert.deepEqual(groupedTraffic[0].route_designations, ["AH26"]);
assert.equal(groupedTraffic[0].events.length, 2, "same-road events share a heading but remain separate");
assert.deepEqual(groupedTraffic[0].events.map((event) => [event.incident_type, event.delay_seconds]), [["JAM", 300], ["ROAD_WORK", 61]]);
assert.equal(groupedTraffic[0].incident_count, 2);
assert.deepEqual(groupedTraffic[0].incident_type_counts, [{ label: "Traffic jam reported", count: 1 }, { label: "Road work reported", count: 1 }]);
assert.equal(groupedTraffic[0].combined_delay_seconds, 361);
assert.equal(formatTrafficDelay(groupedTraffic[0].combined_delay_seconds), "6 min 1 sec");
assert.equal(groupedTraffic[0].delay_total_complete, true);
assert.equal(groupedTraffic[1].road_name, "Cavitex");
assert.deepEqual(groupedTraffic[1].route_designations, ["AH26", "E3"]);
assert.equal(groupedTraffic[1].events.length, 1);
assert.equal(groupedTraffic[2].road_name, "Near Ortigas Avenue");
assert.equal(groupedTraffic[2].is_approximate_location, true);
assert.equal(groupedTraffic[2].events.length, 1);
assert.equal(groupedTraffic[2].events[0].delay_seconds, null);
assert.equal(groupedTraffic[2].events[0].approximate_location, "Ortigas Avenue");
assert.equal(groupedTraffic[2].events[0].location_source, "reverse_geocoding", "fallback label stays event metadata and does not become a verified road group");
assert.equal(groupedTraffic[2].incident_count, 1);
assert.equal(groupedTraffic[2].combined_delay_seconds, null, "missing incident delay is not counted as zero");
assert.equal(groupedTraffic[2].unavailable_delay_count, 1);
assert.equal(groupedTraffic[2].delay_total_complete, false);
const approximateGroups = groupTrafficSections([
  { road_names: ["Verified Road"], approximate_location: "Verified Road nearby", location_source: "reverse_geocoding", delay_seconds: 45, incident_type: "JAM" },
  { road_names: [], approximate_location: "Roxas Boulevard", location_source: "reverse_geocoding", delay_seconds: 80, incident_type: "JAM" },
  { road_names: [], approximate_location: "  roxas   boulevard ", location_source: "reverse_geocoding", delay_seconds: 40, incident_type: "ROAD_WORK" },
  { road_names: [], approximate_location: "NLEX Segment 10 Harbor Link", location_source: "reverse_geocoding", delay_seconds: 20, incident_type: "JAM" },
  { road_names: [], approximate_location: null, location_source: "unavailable", delay_seconds: 10, incident_type: "OTHER" },
]);
assert.equal(approximateGroups.length, 4);
assert.equal(approximateGroups[0].road_name, "Verified Road", "verified route names take priority over fallbacks");
assert.equal(approximateGroups[0].is_approximate_location, false);
assert.equal(approximateGroups[1].identity, "approximate:roxas boulevard");
assert.equal(approximateGroups[1].road_name, "Near Roxas Boulevard");
assert.equal(approximateGroups[1].is_approximate_location, true);
assert.equal(approximateGroups[1].events.length, 2);
assert.equal(approximateGroups[1].combined_delay_seconds, 120);
assert.equal(approximateGroups[1].incident_type_counts.length, 2);
assert.equal(approximateGroups[2].road_name, "Near NLEX Segment 10 Harbor Link");
assert.equal(approximateGroups[2].events.length, 1, "different approximate labels remain separate groups");
assert.equal(approximateGroups[3].road_name, "Road name unavailable");
assert.equal(approximateGroups[3].is_approximate_location, false);
const approximateIncidentDetails = trafficIncidentDetails(approximateGroups[1].events[0], approximateGroups[1]);
assert.equal(approximateIncidentDetails.location_label, null, "group heading already contains the same approximate location");
assert.equal(approximateIncidentDetails.incident_type_label, "Traffic jam reported");
assert.equal(approximateIncidentDetails.reported_delay_label, "1 min 20 sec");
const verifiedIncidentDetails = trafficIncidentDetails({ road_names: ["Verified Road"], approximate_location: "Verified Road", location_source: "reverse_geocoding", incident_type: "ROAD_WORK", delay_seconds: 0 }, approximateGroups[0]);
assert.equal(verifiedIncidentDetails.location_label, null, "do not repeat a location already represented by the verified heading");
const additionalIncidentDetails = trafficIncidentDetails({ approximate_location: "Nearby Junction", location_source: "reverse_geocoding", incident_type: null, delay_seconds: null }, approximateGroups[0]);
assert.equal(additionalIncidentDetails.location_label, "Near Nearby Junction", "show an incident-specific location when it adds context");
assert.equal(additionalIncidentDetails.incident_type_label, "Incident type unavailable");
assert.equal(additionalIncidentDetails.reported_delay_label, "Delay unavailable");
assert.equal(trafficIncidentDetails({}, approximateGroups[3]).incident_type_label, "Incident type unavailable", "missing optional fields get visible fallbacks");
assert.equal(trafficIncidentDetails({}, approximateGroups[3]).reported_delay_label, "Delay unavailable");
assert.equal(trafficIncidentDetails(null, approximateGroups[3]), null, "malformed events are omitted instead of creating a blank list row");
const preservedGroupTotal = approximateGroups[1].combined_delay_seconds;
trafficIncidentDetails(approximateGroups[1].events[0], approximateGroups[1]);
assert.equal(approximateGroups[1].combined_delay_seconds, preservedGroupTotal, "incident detail formatting does not change group totals");
const zeroAndUnavailable = groupTrafficSections([
  { road_names: ["Test Road"], incident_type: "JAM", delay_seconds: 0 },
  { road_names: ["Test Road"], incident_type: "JAM", delay_seconds: undefined },
  { road_names: ["Test Road"], incident_type: "ROAD_CLOSURE", delay_seconds: -1 },
  { road_names: ["Test Road"], incident_type: "OTHER", delay_seconds: 1.5 },
]);
assert.equal(zeroAndUnavailable[0].incident_count, 4, "zero-delay sections remain incidents");
assert.equal(zeroAndUnavailable[0].known_delay_seconds, 0);
assert.equal(zeroAndUnavailable[0].unavailable_delay_count, 3, "missing and invalid values are unavailable");
assert.equal(zeroAndUnavailable[0].delay_total_complete, false);
assert.equal(formatTrafficDelay(undefined), "Delay unavailable");
assert.equal(formatTrafficDelay(-1), "Delay unavailable");
assert.equal(formatTrafficDelay(1.5), "Delay unavailable");
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:15:01Z")), true);
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:15:00Z")), false);
assert.equal(isTrafficEstimateStale("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:14:59Z")), false);
assert.equal(isTrafficEstimateStale("not-a-date", Date.parse("2026-10-13T01:00:00Z")), false);
process.stdout.write("Frontend traffic display tests passed\n");
