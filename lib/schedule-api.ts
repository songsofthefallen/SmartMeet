export type ScheduleIntent = "arrival" | "departure";
export type ScheduleStatus = "active" | "cancelled" | "completed";

export type Schedule = {
  id: number;
  title: string;
  description: string | null;
  time_intent: ScheduleIntent;
  target_datetime: string;
  timezone: string;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
  calculated_departure_time: string | null;
  calculated_wake_time: string | null;
  departure_unavailable_reason: string | null;
  wake_unavailable_reason: string | null;
  status: ScheduleStatus;
  created_at: string;
  updated_at: string;
};

export type ScheduleInput = {
  title: string;
  description: string | null;
  time_intent: ScheduleIntent;
  target_datetime: string;
  timezone: string;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
};

export type ScheduleExtraction = {
  is_schedule_request: boolean;
  title: string | null;
  time_intent: ScheduleIntent | null;
  target_date_local: string | null;
  target_time_local: string | null;
  timezone: string | null;
  preparation_duration_minutes: number | null;
  travel_duration_minutes: number | null;
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
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ScheduleApiError";
  }
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchedule(value: unknown): value is Schedule {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.title === "string" &&
    (typeof value.description === "string" || value.description === null) &&
    (value.time_intent === "arrival" || value.time_intent === "departure") &&
    typeof value.target_datetime === "string" &&
    typeof value.timezone === "string" &&
    (typeof value.preparation_duration_minutes === "number" || value.preparation_duration_minutes === null) &&
    (typeof value.travel_duration_minutes === "number" || value.travel_duration_minutes === null) &&
    (typeof value.calculated_departure_time === "string" || value.calculated_departure_time === null) &&
    (typeof value.calculated_wake_time === "string" || value.calculated_wake_time === null) &&
    (typeof value.departure_unavailable_reason === "string" || value.departure_unavailable_reason === null) &&
    (typeof value.wake_unavailable_reason === "string" || value.wake_unavailable_reason === null) &&
    (value.status === "active" || value.status === "cancelled" || value.status === "completed") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
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
    isNullableString(value.title) &&
    (value.time_intent === "arrival" || value.time_intent === "departure" || value.time_intent === null) &&
    isNullableString(value.target_date_local) &&
    isNullableString(value.target_time_local) &&
    isNullableString(value.timezone) &&
    (typeof value.preparation_duration_minutes === "number" || value.preparation_duration_minutes === null) &&
    (typeof value.travel_duration_minutes === "number" || value.travel_duration_minutes === null) &&
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
): Promise<T> {
  if (!token) throw new ScheduleApiError("Your session is unavailable. Refresh the page or sign in again.", 401);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
  } catch {
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
    if (response.status === 422 && isRecord(payload)) {
      throw new ScheduleApiError(validationMessage(payload.detail) ?? "Check the schedule fields and try again.", 422);
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

export const scheduleApi = {
  extract(text: string, timezone: string | null, token: string | null) {
    return request<ScheduleExtractionReview>(
      "/schedules/extract",
      token,
      "POST",
      { text, timezone },
      isScheduleExtractionReview,
    );
  },
  list(token: string | null) {
    return request<Schedule[]>("/schedules", token, "GET", undefined, isScheduleList);
  },
  get(id: number, token: string | null) {
    return request<Schedule>(`/schedules/${id}`, token, "GET", undefined, isSchedule);
  },
  create(input: ScheduleInput, token: string | null) {
    return request<Schedule>("/schedules", token, "POST", input, isSchedule);
  },
  update(id: number, input: ScheduleInput, token: string | null) {
    return request<Schedule>(`/schedules/${id}`, token, "PATCH", input, isSchedule);
  },
  cancel(id: number, token: string | null) {
    return request<Schedule>(`/schedules/${id}/cancel`, token, "POST", undefined, isSchedule);
  },
};
