const labels = {
  little_or_no_delay: "Little or no delay",
  some_delay: "Some traffic delay",
  significant_delay: "Significant traffic delay",
  unavailable: "Live traffic delay status unavailable",
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

function trafficEstimateType(metrics, routeTimeBasis) {
  const hasHistorical = metrics?.historic_traffic_travel_time_seconds !== null && metrics?.historic_traffic_travel_time_seconds !== undefined;
  if (routeTimeBasis !== "current") return hasHistorical ? "historical" : "unavailable";
  const hasLive = (metrics?.traffic_delay_seconds !== null && metrics?.traffic_delay_seconds !== undefined)
    || (metrics?.live_traffic_incidents_travel_time_seconds !== null && metrics?.live_traffic_incidents_travel_time_seconds !== undefined);
  if (hasHistorical && hasLive) return "live_and_historical";
  if (hasHistorical) return "historical";
  if (hasLive) return "live";
  return "unavailable";
}

function trafficEstimateMessages(metrics, routeTimeBasis) {
  const estimateType = ["live_and_historical", "historical", "live", "unavailable"].includes(metrics?.traffic_estimate_type)
    ? metrics.traffic_estimate_type
    : trafficEstimateType(metrics, routeTimeBasis);
  const historicalSeconds = metrics?.historic_traffic_travel_time_seconds;
  const delaySeconds = metrics?.traffic_delay_seconds;
  const liveSeconds = metrics?.live_traffic_incidents_travel_time_seconds;
  const freeFlowSeconds = metrics?.no_traffic_travel_time_seconds;
  const messages = [];
  if (routeTimeBasis !== "current") {
    if (estimateType === "historical") {
      messages.push("Historical traffic estimate", "Uses typical traffic patterns for the requested day and time; it is not an observation of future traffic.");
    } else {
      messages.push("Traffic estimate unavailable");
    }
    messages.push(delaySeconds === null || delaySeconds === undefined
      ? "Live traffic delay unavailable."
      : `Reported live traffic delay: ${Math.ceil(delaySeconds / 60)} min. This is a current comparison, not an observation of future conditions.`);
    if (historicalSeconds !== null && historicalSeconds !== undefined) messages.push(`Historical travel time: ${Math.ceil(historicalSeconds / 60)} min.`);
    if (freeFlowSeconds !== null && freeFlowSeconds !== undefined) messages.push(`Free-flow comparison: ${Math.ceil(freeFlowSeconds / 60)} min.`);
    return messages;
  }
  if (estimateType === "live_and_historical") messages.push("Current best estimate with live and historical traffic comparisons available.");
  else if (estimateType === "historical") messages.push("Historical traffic comparison available; current best travel time is still an estimate.");
  else if (estimateType === "live") messages.push("Current best estimate with live traffic information available; conditions can change.");
  else messages.push("Traffic estimate unavailable");
  if (historicalSeconds !== null && historicalSeconds !== undefined) messages.push("Historical traffic estimate available.");
  if (delaySeconds === null || delaySeconds === undefined) messages.push("Live traffic delay unavailable.");
  if (historicalSeconds !== null && historicalSeconds !== undefined) messages.push(`Historical travel time: ${Math.ceil(historicalSeconds / 60)} min.`);
  if (liveSeconds !== null && liveSeconds !== undefined) messages.push(`Live-speed comparison: ${Math.ceil(liveSeconds / 60)} min.`);
  if (delaySeconds !== null && delaySeconds !== undefined) messages.push(`Reported live traffic delay: ${Math.ceil(delaySeconds / 60)} min.`);
  if (freeFlowSeconds !== null && freeFlowSeconds !== undefined) messages.push(`Free-flow comparison: ${Math.ceil(freeFlowSeconds / 60)} min.`);
  return messages;
}

function routeTrafficLabel(estimateType) {
  if (estimateType === "historical") return "Historical traffic";
  if (estimateType === "live") return "Live traffic";
  if (estimateType === "live_and_historical") return "Live + historical";
  return "Traffic unavailable";
}

function routeTrafficMetrics(route) {
  if (!route || typeof route !== "object") return [];
  return [
    ["historic_traffic_travel_time_seconds", "Historical travel time", "historical"],
    ["no_traffic_travel_time_seconds", "Free-flow travel time", "free_flow"],
    ["traffic_delay_seconds", "Live traffic delay", "live"],
    ["live_traffic_incidents_travel_time_seconds", "Live traffic incident travel time", "live"],
  ].flatMap(([field, label, source]) => {
    const seconds = route[field];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? [{ field, label, source, seconds }]
      : [];
  });
}

function routeCardExplanation(route, routes, recommendedRouteId) {
  if (!route || !Array.isArray(routes)) return "Estimated travel time shown.";
  if (route.route_id === recommendedRouteId) {
    const next = routes.filter((item) => item.route_id !== recommendedRouteId && Number.isFinite(item.duration_seconds))
      .sort((a, b) => a.duration_seconds - b.duration_seconds)[0];
    if (!next) return "Only available route.";
    const difference = next.duration_seconds - route.duration_seconds;
    if (difference > 0) return `Fastest estimated route — ${formatTrafficDelay(difference)} faster than the next alternative.`;
    return "Fastest estimated route; tied with the next alternative.";
  }
  const recommended = routes.find((item) => item.route_id === recommendedRouteId);
  if (!recommended || !Number.isFinite(recommended.duration_seconds)) return "Estimated travel time shown.";
  const durationDifference = route.duration_seconds - recommended.duration_seconds;
  const distanceDifference = Number.isFinite(route.distance_meters) && Number.isFinite(recommended.distance_meters)
    ? route.distance_meters - recommended.distance_meters
    : null;
  if (durationDifference > 0 && distanceDifference !== null && distanceDifference < 0) {
    return `${(Math.abs(distanceDifference) / 1000).toFixed(1)} km shorter, but ${formatTrafficDelay(durationDifference)} slower. May suit a shorter-distance preference.`;
  }
  if (durationDifference < 0 && distanceDifference !== null && distanceDifference > 0) {
    return `${(distanceDifference / 1000).toFixed(1)} km longer, but ${formatTrafficDelay(Math.abs(durationDifference))} faster.`;
  }
  if (durationDifference > 0) return `${formatTrafficDelay(durationDifference)} slower than the recommended route.`;
  if (durationDifference < 0) return `${formatTrafficDelay(Math.abs(durationDifference))} faster than the recommended route.`;
  return "Same estimated travel time as the recommended route.";
}

function routeTimeBasisLabel(basis) {
  if (basis === "scheduled_departure") return "Routed for the scheduled departure time";
  if (basis === "scheduled_arrival") return "Routed for the scheduled arrival time";
  return "Routed using current conditions";
}

function formatTrafficDelay(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return "Delay unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds} sec`;
  if (remainingSeconds === 0) return `${minutes} min`;
  return `${minutes} min ${remainingSeconds} sec`;
}

function trafficIncidentLabel(type) {
  if (type === "JAM") return "Traffic jam reported";
  if (type === "ROAD_WORK") return "Road work reported";
  if (type === "ROAD_CLOSURE") return "Road closure reported";
  if (type === "OTHER") return "Other traffic event reported";
  return null;
}

function trafficIncidentDetails(section, group) {
  if (!section || typeof section !== "object" || Array.isArray(section)) return null;
  const typeLabel = trafficIncidentLabel(section.incident_type) ?? "Incident type unavailable";
  const delayLabel = formatTrafficDelay(section.delay_seconds);
  const fallback = section.location_source === "reverse_geocoding" && typeof section.approximate_location === "string"
    ? roadNames({ road_names: [section.approximate_location] })[0]
    : undefined;
  const groupIdentities = typeof group?.identity === "string" && group.identity.startsWith("road:")
    ? group.identity.slice("road:".length).split("|")
    : [];
  const fallbackAlreadyInHeading = Boolean(fallback && (
    group?.identity === `approximate:${fallback.identity}` || groupIdentities.includes(fallback.identity)
  ));
  return {
    incident_type_label: typeLabel,
    reported_delay_label: delayLabel,
    location_label: fallback && !fallbackAlreadyInHeading ? `Near ${fallback.label}` : null,
  };
}

function roadNames(section) {
  if (!Array.isArray(section?.road_names)) return [];
  const seen = new Set();
  return section.road_names.flatMap((value) => {
    if (typeof value !== "string") return [];
    const label = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    const identity = label.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!identity || seen.has(identity)) return [];
    seen.add(identity);
    return [{ label, identity }];
  });
}

function trafficRoadDesignations(section) {
  if (!Array.isArray(section?.road_numbers)) return [];
  const seen = new Set();
  return section.road_numbers.flatMap((value) => {
    if (typeof value !== "string") return [];
    const label = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    // Numeric-only values (for example "1") are too ambiguous to display as
    // route designations without country-specific evidence. Keep them in the API.
    if (!/^[A-Z]{1,3}\s*-?\d+[A-Z]?$/i.test(label)) return [];
    const identity = label.toLocaleUpperCase("en-US").replace(/\s+/g, "");
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [label];
  });
}

function groupTrafficSections(sections) {
  const groups = new Map();
  for (const section of Array.isArray(sections) ? sections : []) {
    const names = roadNames(section);
    const approximate = !names.length && section?.location_source === "reverse_geocoding" && typeof section.approximate_location === "string"
      ? roadNames({ road_names: [section.approximate_location] })[0]
      : undefined;
    const identity = names.length
      ? `road:${names.map(({ identity: name }) => name).sort().join("|")}`
      : approximate
        ? `approximate:${approximate.identity}`
        : "road-name-unavailable";
    let group = groups.get(identity);
    if (!group) {
      group = {
        identity,
        road_name: names.length ? names.map(({ label }) => label).join(" · ") : approximate ? `Near ${approximate.label}` : "Road name unavailable",
        is_approximate_location: Boolean(approximate),
        route_designations: [],
        events: [],
      };
      groups.set(identity, group);
    }
    for (const designation of trafficRoadDesignations(section)) {
      if (!group.route_designations.some((existing) => existing.toLocaleUpperCase("en-US") === designation.toLocaleUpperCase("en-US"))) {
        group.route_designations.push(designation);
      }
    }
    // Each provider TRAFFIC section remains its own event, even when grouped
    // under the same road heading.
    group.events.push(section);
  }
  return [...groups.values()].map((group) => {
    const typeCounts = new Map();
    let knownDelaySeconds = 0;
    let unavailableDelayCount = 0;
    for (const event of group.events) {
      const type = trafficIncidentLabel(event?.incident_type) ?? "Incident type unavailable";
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      const delay = event?.delay_seconds;
      if (!Number.isSafeInteger(delay) || delay < 0) {
        unavailableDelayCount += 1;
      } else {
        knownDelaySeconds += delay;
      }
    }
    const delayTotalComplete = unavailableDelayCount === 0 && Number.isSafeInteger(knownDelaySeconds);
    return {
      ...group,
      incident_count: group.events.length,
      incident_type_counts: [...typeCounts].map(([label, count]) => ({ label, count })),
      combined_delay_seconds: delayTotalComplete ? knownDelaySeconds : null,
      known_delay_seconds: knownDelaySeconds,
      unavailable_delay_count: unavailableDelayCount,
      delay_total_complete: delayTotalComplete,
    };
  });
}

function isTrafficEstimateStale(retrievedAt, now = Date.now()) {
  const timestamp = Date.parse(retrievedAt);
  return Number.isFinite(timestamp) && now - timestamp > 15 * 60 * 1000;
}

module.exports = { trafficStatusLabel, trafficDataSourceLabel, trafficEstimateType, trafficEstimateMessages, routeTrafficLabel, routeTrafficMetrics, routeCardExplanation, routeTimeBasisLabel, formatTrafficDelay, trafficIncidentLabel, trafficIncidentDetails, trafficRoadDesignations, groupTrafficSections, isTrafficEstimateStale };
