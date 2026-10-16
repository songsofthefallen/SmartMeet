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

module.exports = { trafficStatusLabel, trafficDataSourceLabel, routeTimeBasisLabel, formatTrafficDelay, trafficIncidentLabel, trafficIncidentDetails, trafficRoadDesignations, groupTrafficSections, isTrafficEstimateStale };
