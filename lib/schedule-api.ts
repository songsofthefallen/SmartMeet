export type ScheduleIntent = "arrival" | "departure";
export type ScheduleStatus = "active" | "cancelled" | "completed";
export type LocationSelection = {
  name: string;
  locality: string | null;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
};
export type SavedPlace = { id: number; alias: string; display_name: string; latitude: number; longitude: number; formatted_address: string | null; locality: string | null; region: string | null; country: string | null; timezone: string | null; location_source: "tomtom_search"; created_at: string; updated_at: string };
export type SavedPlaceInput = Omit<SavedPlace, "id" | "created_at" | "updated_at">;
export type WeatherPointForecast = {
  condition: string;
  weather_code: number;
  precipitation_mm: number;
  snowfall_cm: number;
  wind_speed_kmh: number;
};
export type WeatherAdvisory = {
  condition: string;
  endpoint: "origin" | "destination";
  forecast_at: string;
};
export type TrafficSectionEstimate = {
  severity: "little_or_no_delay" | "some_delay" | "significant_delay" | null;
  delay_seconds: number | null;
  start_point_index: number | null;
  end_point_index: number | null;
  road_names: string[];
  road_numbers: string[];
  approximate_location: string | null;
  location_source: "verified_route_metadata" | "reverse_geocoding" | "unavailable";
  incident_type: "JAM" | "ROAD_WORK" | "ROAD_CLOSURE" | "OTHER" | null;
  start_coordinates: { latitude: number; longitude: number } | null;
  end_coordinates: { latitude: number; longitude: number } | null;
};
export type RouteAlternativeEstimate = { route_id: string; duration_seconds: number; duration_minutes: number; distance_meters: number | null; traffic_delay_seconds: number | null; no_traffic_travel_time_seconds: number | null; historic_traffic_travel_time_seconds: number | null; live_traffic_incidents_travel_time_seconds: number | null; traffic_sections: TrafficSectionEstimate[]; road_names: string[]; geometry?: { latitude: number; longitude: number }[] };
export type RouteLandmarkEstimate = { name: string; category: "hospital" | "school"; latitude: number; longitude: number };

export type Schedule = {
  id: number;
  is_past: boolean;
  title: string;
  description: string | null;
  location: LocationSelection | null;
  origin_location: LocationSelection | null;
  travel_estimate: { duration_seconds: number; duration_minutes: number; provider: string; retrieved_at: string; traffic_included: boolean; route_time_basis: "current" | "scheduled_departure" | "scheduled_arrival"; traffic_delay_seconds: number | null; no_traffic_travel_time_seconds: number | null; historic_traffic_travel_time_seconds: number | null; live_traffic_incidents_travel_time_seconds: number | null; traffic_sections: TrafficSectionEstimate[]; selected_route_id?: string; alternatives?: RouteAlternativeEstimate[] } | null;
  weather_estimate: { status: "available" | "unavailable"; summary: string; retrieved_at: string | null; forecast_at: string | null; origin_forecast_at?: string | null; destination_forecast_at?: string | null; origin_weather?: WeatherPointForecast | null; destination_weather?: WeatherPointForecast | null; conditions: string[]; advisories: WeatherAdvisory[]; origin_status?: "available" | "unavailable" | null; destination_status?: "available" | "unavailable" | null; origin_message?: string | null; destination_message?: string | null } | null;
  route_availability?: "no_drivable_route" | null;
  traffic_delay_minutes: number | null;
  traffic_status: "little_or_no_delay" | "some_delay" | "significant_delay" | "unavailable";
  traffic_data_source: "live_available" | "historical_available" | "live_and_historical_available" | "unknown";
  time_intent: ScheduleIntent;
  target_datetime: string;
  timezone: string;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
  calculated_departure_time: string | null;
  calculated_arrival_time: string | null;
  calculated_wake_time: string | null;
  departure_unavailable_reason: string | null;
  arrival_unavailable_reason: string | null;
  wake_unavailable_reason: string | null;
  route_warning: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
};

export type ScheduleInput = {
  title?: string;
  description: string | null;
  location: LocationSelection | null;
  origin_location: LocationSelection | null;
  time_intent: ScheduleIntent;
  target_datetime: string;
  timezone: string;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
  idempotency_key?: string | null;
  selected_route_id?: string;
};
export type ScheduleUpdateInput = Partial<ScheduleInput> & { selected_route_id?: string };

export type ScheduleExtraction = {
  is_schedule_request: boolean;
  time_intent: ScheduleIntent | null;
  target_date_local: string | null;
  target_time_local: string | null;
  timezone: string | null;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
  origin_description: string | null;
  destination_description: string | null;
  time_intent_ambiguous: boolean;
  ambiguities: string[];
};

export type ScheduleExtractionReview = {
  status: "ready_for_review" | "needs_clarification";
  extraction: ScheduleExtraction | null;
  resolved_target_datetime: string | null;
  missing_fields: string[];
  ambiguous_fields: string[];
  invalid_fields: string[];
};

export class ScheduleApiError extends Error {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    status: number | null,
    retryAfterSeconds: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.code = code;
    this.name = "ScheduleApiError";
  }
}

export type ScheduleRequestOptions = { signal?: AbortSignal };

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchedule(value: unknown): value is Schedule {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    (value.route_availability === undefined || value.route_availability === null || value.route_availability === "no_drivable_route") &&
    typeof value.is_past === "boolean" &&
    typeof value.title === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    (value.location === null || isLocation(value.location)) &&
    ((value.origin_location ?? null) === null || isLocation(value.origin_location)) &&
    ((value.travel_estimate ?? null) === null || (isRecord(value.travel_estimate) && typeof value.travel_estimate.duration_seconds === "number" && typeof value.travel_estimate.duration_minutes === "number" && typeof value.travel_estimate.provider === "string" && typeof value.travel_estimate.retrieved_at === "string" && typeof value.travel_estimate.traffic_included === "boolean" && ["current", "scheduled_departure", "scheduled_arrival"].includes(value.travel_estimate.route_time_basis as string) && (typeof value.travel_estimate.traffic_delay_seconds === "number" || value.travel_estimate.traffic_delay_seconds === null) && (typeof value.travel_estimate.no_traffic_travel_time_seconds === "number" || value.travel_estimate.no_traffic_travel_time_seconds === null) && (typeof value.travel_estimate.historic_traffic_travel_time_seconds === "number" || value.travel_estimate.historic_traffic_travel_time_seconds === null) && (typeof value.travel_estimate.live_traffic_incidents_travel_time_seconds === "number" || value.travel_estimate.live_traffic_incidents_travel_time_seconds === null) && Array.isArray(value.travel_estimate.traffic_sections) && value.travel_estimate.traffic_sections.every(isTrafficSectionEstimate) && (value.travel_estimate.alternatives === undefined || (Array.isArray(value.travel_estimate.alternatives) && value.travel_estimate.alternatives.every((option) => isRecord(option) && typeof option.route_id === "string" && typeof option.duration_seconds === "number" && typeof option.duration_minutes === "number" && (typeof option.distance_meters === "number" || option.distance_meters === null) && Array.isArray(option.traffic_sections) && option.traffic_sections.every(isTrafficSectionEstimate) && Array.isArray(option.road_names)))))) &&
    ((value.weather_estimate ?? null) === null || (isRecord(value.weather_estimate) && ["available", "unavailable"].includes(value.weather_estimate.status as string) && typeof value.weather_estimate.summary === "string" && (typeof value.weather_estimate.retrieved_at === "string" || value.weather_estimate.retrieved_at === null) && (typeof value.weather_estimate.forecast_at === "string" || value.weather_estimate.forecast_at === null) && (value.weather_estimate.origin_forecast_at === undefined || typeof value.weather_estimate.origin_forecast_at === "string" || value.weather_estimate.origin_forecast_at === null) && (value.weather_estimate.destination_forecast_at === undefined || typeof value.weather_estimate.destination_forecast_at === "string" || value.weather_estimate.destination_forecast_at === null) && (value.weather_estimate.origin_weather === undefined || value.weather_estimate.origin_weather === null || isWeatherPointForecast(value.weather_estimate.origin_weather)) && (value.weather_estimate.destination_weather === undefined || value.weather_estimate.destination_weather === null || isWeatherPointForecast(value.weather_estimate.destination_weather)) && [value.weather_estimate.origin_status, value.weather_estimate.destination_status].every((status) => status === undefined || status === null || status === "available" || status === "unavailable") && [value.weather_estimate.origin_message, value.weather_estimate.destination_message].every((message) => message === undefined || message === null || typeof message === "string") && (value.weather_estimate.destination_weather === undefined || value.weather_estimate.destination_weather === null || isWeatherPointForecast(value.weather_estimate.destination_weather)) && Array.isArray(value.weather_estimate.conditions) && Array.isArray(value.weather_estimate.advisories) && value.weather_estimate.advisories.every((item) => isRecord(item) && typeof item.condition === "string" && (item.endpoint === "origin" || item.endpoint === "destination") && typeof item.forecast_at === "string"))) &&
    ((typeof value.traffic_delay_minutes === "number" || value.traffic_delay_minutes === null) && ["little_or_no_delay", "some_delay", "significant_delay", "unavailable"].includes(value.traffic_status as string) && ["live_available", "historical_available", "live_and_historical_available", "unknown"].includes(value.traffic_data_source as string)) &&
    (value.time_intent === "arrival" || value.time_intent === "departure") &&
    typeof value.target_datetime === "string" &&
    typeof value.timezone === "string" &&
    (typeof value.preparation_duration_minutes === "number" || value.preparation_duration_minutes === null) &&
    (typeof value.travel_duration_minutes === "number" || value.travel_duration_minutes === null) &&
    (typeof value.calculated_departure_time === "string" || value.calculated_departure_time === null) &&
    ((value.calculated_arrival_time ?? null) === null || typeof value.calculated_arrival_time === "string") &&
    (typeof value.calculated_wake_time === "string" || value.calculated_wake_time === null) &&
    (typeof value.departure_unavailable_reason === "string" || value.departure_unavailable_reason === null) &&
    ((value.arrival_unavailable_reason ?? null) === null || typeof value.arrival_unavailable_reason === "string") &&
    (typeof value.wake_unavailable_reason === "string" || value.wake_unavailable_reason === null) &&
    ((value.route_warning ?? null) === null || typeof value.route_warning === "string") &&
    (value.status === "active" || value.status === "cancelled" || value.status === "completed") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isLocation(value: unknown): value is LocationSelection {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" &&
    (typeof value.locality === "string" || value.locality === null) &&
    (typeof value.region === "string" || value.region === null) &&
    (typeof value.country === "string" || value.country === null) &&
    typeof value.latitude === "number" && value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === "number" && value.longitude >= -180 && value.longitude <= 180 &&
    (typeof value.timezone === "string" || value.timezone === null);
}

function isWeatherPointForecast(value: unknown): value is WeatherPointForecast {
  return isRecord(value) && typeof value.condition === "string" && typeof value.weather_code === "number" &&
    typeof value.precipitation_mm === "number" && typeof value.snowfall_cm === "number" &&
    typeof value.wind_speed_kmh === "number";
}

function isTrafficSectionEstimate(value: unknown): value is TrafficSectionEstimate {
  if (!isRecord(value)) return false;
  const coordinateValid = (point: unknown) => point === null || (isRecord(point) && typeof point.latitude === "number" && typeof point.longitude === "number");
  return (value.severity === null || ["little_or_no_delay", "some_delay", "significant_delay"].includes(value.severity as string)) &&
    (typeof value.delay_seconds === "number" || value.delay_seconds === null) &&
    (typeof value.start_point_index === "number" || value.start_point_index === null) &&
    (typeof value.end_point_index === "number" || value.end_point_index === null) &&
    Array.isArray(value.road_names) && value.road_names.every((name) => typeof name === "string") &&
    Array.isArray(value.road_numbers) && value.road_numbers.every((number) => typeof number === "string") &&
    (value.approximate_location === undefined || value.approximate_location === null || typeof value.approximate_location === "string") &&
    (value.location_source === undefined || ["verified_route_metadata", "reverse_geocoding", "unavailable"].includes(value.location_source as string)) &&
    (value.incident_type === null || ["JAM", "ROAD_WORK", "ROAD_CLOSURE", "OTHER"].includes(value.incident_type as string)) &&
    coordinateValid(value.start_coordinates) && coordinateValid(value.end_coordinates);
}

function isLocationSearch(value: unknown): value is { results: LocationSelection[] } {
  return isRecord(value) && Array.isArray(value.results) && value.results.every(isLocation);
}

function isSavedPlace(value: unknown): value is SavedPlace {
  return isRecord(value) && typeof value.id === "number" && typeof value.alias === "string" &&
    typeof value.display_name === "string" && typeof value.latitude === "number" && typeof value.longitude === "number" &&
    isNullableString(value.formatted_address) && isNullableString(value.locality) && isNullableString(value.region) &&
    isNullableString(value.country) && isNullableString(value.timezone) && value.location_source === "tomtom_search" &&
    typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isSavedPlaceList(value: unknown): value is SavedPlace[] {
  return Array.isArray(value) && value.every(isSavedPlace);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isScheduleExtraction(value: unknown): value is ScheduleExtraction {
  if (!isRecord(value)) return false;
  return (
    typeof value.is_schedule_request === "boolean" &&
    (value.time_intent === "arrival" || value.time_intent === "departure" || value.time_intent === null) &&
    isNullableString(value.target_date_local) &&
    isNullableString(value.target_time_local) &&
    isNullableString(value.timezone) &&
    (typeof value.preparation_duration_minutes === "number" || value.preparation_duration_minutes === null) &&
    (typeof value.travel_duration_minutes === "number" || value.travel_duration_minutes === null) &&
    isNullableString(value.origin_description) &&
    isNullableString(value.destination_description) &&
    typeof value.time_intent_ambiguous === "boolean" &&
    isStringList(value.ambiguities)
  );
}

function isScheduleExtractionReview(value: unknown): value is ScheduleExtractionReview {
  if (!isRecord(value)) return false;
  return (
    (value.status === "ready_for_review" || value.status === "needs_clarification") &&
    (value.extraction === null || isScheduleExtraction(value.extraction)) &&
    isNullableString(value.resolved_target_datetime) &&
    isStringList(value.missing_fields) &&
    isStringList(value.ambiguous_fields) &&
    isStringList(value.invalid_fields)
  );
}

function validationMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const messages = detail.flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.msg !== "string") return [];
    const location = Array.isArray(item.loc) ? item.loc.filter((part): part is string | number => typeof part === "string" || typeof part === "number").slice(1).join(" ") : "";
    return [location ? `${location}: ${item.msg}` : item.msg];
  });
  return messages.length ? messages.join(". ") : null;
}

async function request<T>(
  path: string,
  token: string | null,
  method = "GET",
  body?: unknown,
  validate?: (value: unknown) => value is T,
  options: ScheduleRequestOptions = {},
): Promise<T> {
  if (!token) throw new ScheduleApiError("Your session is unavailable. Refresh the page or sign in again.", 401);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ScheduleApiError("Request cancelled.", null, null, "cancelled");
    }
    throw new ScheduleApiError("Could not reach the schedule service. Check your connection and try again.", null);
  }

  let payload: unknown;
  try {
    payload = response.status === 204 ? null : await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) throw new ScheduleApiError("Your session expired or could not be verified. Refresh the page and sign in again.", 401);
    if (response.status === 404) throw new ScheduleApiError("This schedule is no longer available. Refresh the schedule list and try again.", 404);
    if (response.status === 409 && isRecord(payload)) {
      if (isRecord(payload.detail) && typeof payload.detail.code === "string" && typeof payload.detail.message === "string") {
        throw new ScheduleApiError(payload.detail.message, 409, null, payload.detail.code);
      }
      throw new ScheduleApiError(typeof payload.detail === "string" ? payload.detail : validationMessage(payload.detail) ?? "The request conflicts with the current account state.", 409);
    }
    if (response.status === 422 && isRecord(payload)) {
      if (isRecord(payload.detail) && typeof payload.detail.code === "string" && typeof payload.detail.message === "string") {
        throw new ScheduleApiError(payload.detail.message, 422, null, payload.detail.code);
      }
      throw new ScheduleApiError(validationMessage(payload.detail) ?? "Check the schedule fields and try again.", 422);
    }
    if (response.status === 429) {
      const retryHeader = response.headers.get("Retry-After");
      const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
      const detail = isRecord(payload) && typeof payload.detail === "string" ? payload.detail : "Route refresh is temporarily limited. Try again later.";
      throw new ScheduleApiError(detail, 429, retryAfter);
    }
    if (response.status === 504 && isRecord(payload) && typeof payload.detail === "string") {
      throw new ScheduleApiError(payload.detail, 504);
    }
    if (response.status >= 500 && isRecord(payload) && typeof payload.detail === "string") {
      throw new ScheduleApiError(payload.detail, response.status);
    }
    if (response.status >= 500) throw new ScheduleApiError("The schedule service could not complete that request. Try again later.", response.status);
    throw new ScheduleApiError("The schedule request was rejected. Check the details and try again.", response.status);
  }

  if (validate && !validate(payload)) {
    throw new ScheduleApiError("The schedule service returned an invalid response. Try again later.", response.status);
  }
  return payload as T;
}

function isScheduleList(value: unknown): value is Schedule[] {
  return Array.isArray(value) && value.every(isSchedule);
}

function isRouteOptions(value: unknown): value is { alternatives: RouteAlternativeEstimate[] } {
  if (!isRecord(value) || !Array.isArray(value.alternatives) || value.alternatives.length === 0) return false;
  return value.alternatives.every((option) => isRecord(option) &&
    typeof option.route_id === "string" &&
    typeof option.duration_seconds === "number" && Number.isFinite(option.duration_seconds) && option.duration_seconds > 0 &&
    typeof option.duration_minutes === "number" && Number.isFinite(option.duration_minutes) && option.duration_minutes > 0 &&
    typeof option.distance_meters === "number" && Number.isFinite(option.distance_meters) && option.distance_meters > 0 &&
    (option.traffic_delay_seconds === null || (typeof option.traffic_delay_seconds === "number" && Number.isFinite(option.traffic_delay_seconds) && option.traffic_delay_seconds >= 0)) &&
    Array.isArray(option.traffic_sections) && option.traffic_sections.every(isTrafficSectionEstimate) &&
    Array.isArray(option.road_names) &&
    (option.geometry === undefined || (Array.isArray(option.geometry) && option.geometry.every((point) => isRecord(point) && typeof point.latitude === "number" && typeof point.longitude === "number"))));
}

function isRouteLandmarks(value: unknown): value is RouteLandmarkEstimate[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.name === "string" &&
    (item.category === "hospital" || item.category === "school") && typeof item.latitude === "number" && typeof item.longitude === "number");
}

export const scheduleApi = {
  savedPlaces(token: string | null, options?: ScheduleRequestOptions) {
    return request<SavedPlace[]>("/saved-places", token, "GET", undefined, isSavedPlaceList, options);
  },
  createSavedPlace(input: SavedPlaceInput, token: string | null, options?: ScheduleRequestOptions) {
    return request<SavedPlace>("/saved-places", token, "POST", input, isSavedPlace, options);
  },
  updateSavedPlace(id: number, input: Partial<SavedPlaceInput>, token: string | null, options?: ScheduleRequestOptions) {
    return request<SavedPlace>(`/saved-places/${id}`, token, "PATCH", input, isSavedPlace, options);
  },
  deleteSavedPlace(id: number, token: string | null, options?: ScheduleRequestOptions) {
    return request<null>(`/saved-places/${id}`, token, "DELETE", undefined, undefined, options);
  },
  registerPushSubscription(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, token: string | null, options?: ScheduleRequestOptions) {
    return request<null>("/push/subscriptions", token, "POST", subscription, undefined, options);
  },
  removePushSubscription(endpoint: string, token: string | null, options?: ScheduleRequestOptions) {
    return request<null>("/push/subscriptions", token, "DELETE", { endpoint }, undefined, options);
  },
  testPushNotification(token: string | null, scheduleId?: number, options?: ScheduleRequestOptions) {
    return request<{ accepted: true }>("/push/test", token, "POST", scheduleId ? { schedule_id: scheduleId } : {}, (value): value is { accepted: true } => isRecord(value) && value.accepted === true, options);
  },
  routeLandmarks(route_points: NonNullable<RouteAlternativeEstimate["geometry"]>, token: string | null, options?: ScheduleRequestOptions) {
    return request<RouteLandmarkEstimate[]>("/schedules/route-landmarks", token, "POST", { route_points }, isRouteLandmarks, options);
  },
  async routeMap(bounds: { min_lon: number; min_lat: number; max_lon: number; max_lat: number }, token: string | null, options: ScheduleRequestOptions = {}): Promise<Blob> {
    const query = new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, String(value)]));
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/schedules/route-map?${query}`, {
        headers: { Accept: "image/png", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new ScheduleApiError("Request cancelled.", null, null, "cancelled");
      }
      throw new ScheduleApiError("Map preview could not be loaded. Route details are still available.", null);
    }
    if (!response.ok) {
      throw new ScheduleApiError("Map preview could not be loaded. Route details are still available.", response.status);
    }
    return response.blob();
  },
  routeOptions(input: Pick<ScheduleInput, "origin_location" | "location" | "time_intent" | "target_datetime">, token: string | null, options?: ScheduleRequestOptions) {
    return request<{ alternatives: RouteAlternativeEstimate[] }>("/schedules/route-options", token, "POST", input, isRouteOptions, options);
  },
  searchLocations(query: string, token: string | null, options?: ScheduleRequestOptions) {
    return request<{ results: LocationSelection[] }>("/locations/search", token, "POST", { query }, isLocationSearch, options);
  },
  extract(text: string, timezone: string | null, token: string | null, options?: ScheduleRequestOptions) {
    return request<ScheduleExtractionReview>(
      "/schedules/extract",
      token,
      "POST",
      { text, timezone },
      isScheduleExtractionReview,
      options,
    );
  },
  list(token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule[]>("/schedules", token, "GET", undefined, isScheduleList, options);
  },
  get(id: number, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>(`/schedules/${id}`, token, "GET", undefined, isSchedule, options);
  },
  create(input: ScheduleInput & { continue_without_route?: boolean; route_outcome?: "no_drivable_route" }, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>("/schedules", token, "POST", input, isSchedule, options);
  },
  update(id: number, input: ScheduleUpdateInput, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>(`/schedules/${id}`, token, "PATCH", input, isSchedule, options);
  },
  cancel(id: number, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>(`/schedules/${id}/cancel`, token, "POST", undefined, isSchedule, options);
  },
  refreshTravelEstimate(id: number, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>(`/schedules/${id}/travel-estimate/refresh`, token, "POST", undefined, isSchedule, options);
  },
  refreshWeatherEstimate(id: number, token: string | null, options?: ScheduleRequestOptions) {
    return request<Schedule>(`/schedules/${id}/weather-estimate/refresh`, token, "POST", undefined, isSchedule, options);
  },
};
