"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { scheduleApi, ScheduleApiError, type LocationSelection, type Schedule, type ScheduleExtractionReview, type ScheduleInput, type ScheduleIntent, type ScheduleUpdateInput, type TrafficSectionEstimate } from "@/lib/schedule-api";
import { clarificationQuestions } from "@/lib/clarification-messages";
import { localDateTimeFromExtraction, localTimeInputFromExtraction } from "@/lib/schedule-extraction-time";
import { isAssistantAutosaveEligible } from "@/lib/assistant-autosave";
import { formatTrafficDelay, groupTrafficSections, routeTimeBasisLabel, trafficIncidentDetails, trafficStatusLabel } from "@/lib/traffic-display.js";
import { arrivalPreparationNote, suggestedTimeRows } from "@/lib/suggested-times.js";
import { upsertScheduleNewestFirst } from "@/lib/schedule-order.js";
import { shouldInvalidateLocationSelection } from "@/lib/location-selection.js";
import { historicalEstimateNotice, PAST_SCHEDULE_BANNER_TITLE, showPastScheduleNotices, showPostDepartureRouteWarning, showStaleEstimateWarning, showTravelTrafficCard } from "@/lib/schedule-warning-display.js";

type FormValues = Omit<ScheduleInput, "target_datetime" | "time_intent" | "preparation_duration_minutes" | "title"> & { title: string; target_datetime: string; time_intent: ScheduleIntent | ""; preparation_duration_minutes: number | null };
type Notice = { kind: "success" | "error" | "info"; text: string };
type TrafficRoadGroup = { identity: string; road_name: string; is_approximate_location: boolean; route_designations: string[]; events: TrafficSectionEstimate[]; incident_count: number; incident_type_counts: { label: string; count: number }[]; combined_delay_seconds: number | null; known_delay_seconds: number; unavailable_delay_count: number; delay_total_complete: boolean };

const fallbackTimeZones = [
  "Africa/Cairo", "America/Anchorage", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/New_York", "America/Sao_Paulo", "Asia/Dubai", "Asia/Hong_Kong", "Asia/Jakarta",
  "Asia/Kolkata", "Asia/Manila", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo",
  "Australia/Brisbane", "Australia/Sydney", "Europe/Berlin", "Europe/London", "Europe/Paris", "Pacific/Auckland",
];
const supportedTimeZones = Array.from(new Set([
  "UTC",
  ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : fallbackTimeZones),
  "Asia/Manila",
])).sort();

const blankForm = (): FormValues => ({
  title: "",
  description: "",
  time_intent: "",
  target_datetime: "",
  timezone: "Asia/Manila",
  preparation_duration_minutes: null,
  travel_duration_minutes: null,
  location: null,
  origin_location: null,
});
const fieldClass = "mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-subtle)]";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";

function formatDate(value: string, timezone: string, includeSeconds = false) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: includeSeconds ? "medium" : "short", timeZone: timezone }).format(new Date(value));
}

function timezoneLabel(timezone: string): string {
  try {
    const offset = new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${timezone} (${offset})` : timezone;
  } catch {
    return timezone;
  }
}

function toLocalDateTime(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toOffsetDateTime(localValue: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) throw new Error("Enter a valid target date and time.");
  const [, year, month, day, hour, minute] = match;
  const wallClockUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const offsetAt = (instantMilliseconds: number) => {
    const parts = formatter.formatToParts(new Date(instantMilliseconds));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const representedUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    return representedUtc - instantMilliseconds;
  };
  const offsets = new Set([offsetAt(wallClockUtc - 12 * 60 * 60 * 1000), offsetAt(wallClockUtc + 12 * 60 * 60 * 1000)]);
  const matches = [...offsets].map((offset) => new Date(wallClockUtc - offset)).filter((instant) => toLocalDateTime(instant.toISOString(), timezone) === localValue);
  if (matches.length === 0) {
    throw new Error("That local time does not exist in the selected timezone. Choose another time.");
  }
  if (matches.length > 1) throw new Error("That local time occurs twice because of a daylight-saving change. Choose a time outside the repeated hour.");
  return matches[0].toISOString();
}

function messageFor(error: unknown): string {
  if (error instanceof ScheduleApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export default function ScheduleWorkspace() {
  const { getToken, isLoaded } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [view, setView] = useState<"list" | "detail" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [extractionText, setExtractionText] = useState("");
  const [extractionReview, setExtractionReview] = useState<ScheduleExtractionReview | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionDate, setExtractionDate] = useState("");
  const [extractionTime, setExtractionTime] = useState("");
  const [timezoneConflictConfirmed, setTimezoneConflictConfirmed] = useState(false);
  const extractionInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const autoSavePending = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const scheduleForm = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routeRefreshingId, setRouteRefreshingId] = useState<number | null>(null);
  const [weatherRefreshingId, setWeatherRefreshingId] = useState<number | null>(null);
  const [routeCooldowns, setRouteCooldowns] = useState<Record<number, number>>({});
  const [clockNow, setClockNow] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [routeUnavailableConfirmation, setRouteUnavailableConfirmation] = useState(false);
  const continueWithoutRoute = useRef(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationSelection[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [originQuery, setOriginQuery] = useState("");
  const [originResults, setOriginResults] = useState<LocationSelection[]>([]);
  const [originSearching, setOriginSearching] = useState(false);

  const activeSchedules = useMemo(
    () => schedules.filter((item) => item.status === "active"),
    [schedules],
  );

  const loadSchedules = useCallback(async () => {
    try {
      const token = await getToken();
      const items = await scheduleApi.list(token);
      setLoadError(false);
      setSchedules(items);
      const first = items.find((item) => item.status === "active") ?? items[0] ?? null;
      setSelectedId(first?.id ?? null);
      setSelectedSchedule(first);
      setView(first ? "detail" : "list");
    } catch (error) {
      setLoadError(true);
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  function refreshSchedules() {
    setLoading(true);
    setMessage(null);
    void loadSchedules();
  }

  useEffect(() => {
    if (!isLoaded) return;
    const task = window.setTimeout(() => void loadSchedules(), 0);
    return () => window.clearTimeout(task);
  }, [isLoaded, loadSchedules]);

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(blankForm());
    setLocationQuery("");
    setLocationResults([]);
    setOriginQuery("");
    setOriginResults([]);
    setMessage(null);
    setRouteUnavailableConfirmation(false);
    continueWithoutRoute.current = false;
    setConfirmCancel(false);
    setExtractionText("");
    setExtractionReview(null);
    setExtractionError(null);
    setExtractionDate("");
    setExtractionTime("");
    setTimezoneConflictConfirmed(false);
    autoSavePending.current = false;
    idempotencyKey.current = null;
    setView("form");
  }

  function clearRouteUnavailableConfirmation() {
    setRouteUnavailableConfirmation(false);
    continueWithoutRoute.current = false;
  }

  function openEdit(item: Schedule) {
    clearRouteUnavailableConfirmation();
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description ?? "",
      time_intent: item.time_intent,
      target_datetime: toLocalDateTime(item.target_datetime, item.timezone),
      timezone: item.timezone,
      preparation_duration_minutes: item.preparation_duration_minutes,
      travel_duration_minutes: item.travel_duration_minutes,
      location: item.location,
      origin_location: item.origin_location ?? null,
    });
    setLocationQuery(item.location?.name ?? "");
    setLocationResults([]);
    setOriginQuery(item.origin_location?.name ?? "");
    setOriginResults([]);
    setMessage(null);
    setExtractionText("");
    setExtractionReview(null);
    setExtractionError(null);
    setExtractionDate("");
    setExtractionTime("");
    setTimezoneConflictConfirmed(false);
    setView("form");
  }

  async function searchLocations() {
    if (locationSearching || locationQuery.trim().length < 2) return;
    setLocationSearching(true);
    setLocationResults([]);
    setMessage(null);
    try {
      const token = await getToken();
      const response = await scheduleApi.searchLocations(locationQuery.trim(), token);
      setLocationResults(response.results);
      if (response.results.length === 0) setMessage({ kind: "error", text: "No matching locations found. Try a nearby town or a more specific name." });
    } catch (error) {
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      setLocationSearching(false);
    }
  }

  async function searchOriginLocations() {
    if (originSearching || originQuery.trim().length < 2) return;
    setOriginSearching(true);
    setOriginResults([]);
    try {
      const token = await getToken();
      const response = await scheduleApi.searchLocations(originQuery.trim(), token);
      setOriginResults(response.results);
      if (response.results.length === 0) setMessage({ kind: "error", text: "No matching origins found. Try a nearby town or a more specific name." });
    } catch (error) { setMessage({ kind: "error", text: messageFor(error) }); }
    finally { setOriginSearching(false); }
  }

  async function extractSchedule() {
    if (extractionInFlight.current || saveInFlight.current || !extractionText.trim() || saving) return;
    extractionInFlight.current = true;
    setExtracting(true);
    setExtractionError(null);
    setExtractionReview(null);
    clearRouteUnavailableConfirmation();
    setMessage(null);
    try {
      const token = await getToken();
      const selectedTimezone = form.timezone.trim();
      const review = await scheduleApi.extract(extractionText, selectedTimezone || null, token);
      autoSavePending.current = true;
      idempotencyKey.current ??= crypto.randomUUID();
      setExtractionReview(review);
      setTimezoneConflictConfirmed(!review.ambiguous_fields.includes("timezone"));
      const extracted = review.extraction;
      if (extracted) {
        if (extracted.origin_description) {
          setOriginQuery(extracted.origin_description);
          setOriginResults([]);
        }
        if (extracted.destination_description) {
          setLocationQuery(extracted.destination_description);
          setLocationResults([]);
        }
        setOriginSearching(Boolean(extracted.origin_description));
        setLocationSearching(Boolean(extracted.destination_description));
        const completeTarget = localDateTimeFromExtraction(extracted.target_date_local, extracted.target_time_local);
        const currentParts = form.target_datetime.split("T");
        const nextDate = extracted.target_date_local ?? currentParts[0] ?? "";
        const nextTime = localTimeInputFromExtraction(extracted.target_time_local) ?? currentParts[1] ?? "";
        setExtractionDate(nextDate);
        setExtractionTime(nextTime);
        setForm((current) => ({
          ...current,
          description: current.description?.trim() ? current.description : extractionText.trim(),
          time_intent: extracted.time_intent ?? current.time_intent,
          target_datetime: completeTarget ?? current.target_datetime,
          timezone: selectedTimezone || extracted.timezone || current.timezone,
          preparation_duration_minutes: extracted.preparation_duration_minutes ?? current.preparation_duration_minutes,
          travel_duration_minutes: extracted.travel_duration_minutes ?? current.travel_duration_minutes,
          origin_location: extracted.origin_description ? null : current.origin_location,
          location: extracted.destination_description ? null : current.location,
        }));
        const placeSearches = await Promise.allSettled([
          ...(extracted.origin_description ? [scheduleApi.searchLocations(extracted.origin_description, token).then((response) => { setOriginResults(response.results); return { kind: "origin" as const, count: response.results.length }; })] : []),
          ...(extracted.destination_description ? [scheduleApi.searchLocations(extracted.destination_description, token).then((response) => { setLocationResults(response.results); return { kind: "destination" as const, count: response.results.length }; })] : []),
        ]);
        setOriginSearching(false);
        setLocationSearching(false);
        if (placeSearches.some((result) => result.status === "rejected")) {
          setMessage({ kind: "error", text: "A place search failed. Your schedule was not saved; retry the search or enter a more specific place." });
        } else if (placeSearches.some((result) => result.status === "fulfilled" && result.value.count === 0)) {
          setMessage({ kind: "error", text: "No matching location was found. Refine the place description, or save without that optional location." });
        }
      } else {
        setExtractionDate("");
        setExtractionTime("");
      }
    } catch (error) {
      setExtractionError(messageFor(error));
    } finally {
      extractionInFlight.current = false;
      setExtracting(false);
    }
  }

  useEffect(() => {
    if (!autoSavePending.current || !extractionReview || editingId !== null) return;
    const valid = isAssistantAutosaveEligible({
      timeIntent: form.time_intent,
      targetDateTime: form.target_datetime,
      timezone: form.timezone,
      preparationMinutes: form.preparation_duration_minutes,
      travelMinutes: form.travel_duration_minutes,
      timezoneConflictConfirmed: !extractionReview.ambiguous_fields.includes("timezone") || timezoneConflictConfirmed,
      originDescription: extractionReview.extraction?.origin_description,
      destinationDescription: extractionReview.extraction?.destination_description,
      originResolved: Boolean(form.origin_location),
      destinationResolved: Boolean(form.location),
    });
    if (!valid) return;
    try {
      toOffsetDateTime(form.target_datetime, form.timezone.trim());
      autoSavePending.current = false;
      scheduleForm.current?.requestSubmit();
    } catch {
      // Keep the candidate in the form until the user resolves the invalid local time.
    }
  }, [form, extractionReview, editingId, timezoneConflictConfirmed]);

  function updateExtractionDate(value: string) {
    clearRouteUnavailableConfirmation();
    setExtractionDate(value);
    if (value && extractionTime) {
      setForm((current) => ({ ...current, target_datetime: `${value}T${extractionTime.slice(0, 5)}` }));
    }
  }

  function updateExtractionTime(value: string) {
    clearRouteUnavailableConfirmation();
    setExtractionTime(value);
    if (extractionDate && value) {
      setForm((current) => ({ ...current, target_datetime: `${extractionDate}T${value.slice(0, 5)}` }));
    }
  }

  async function selectSchedule(item: Schedule) {
    setSelectedId(item.id);
    setView("detail");
    setConfirmCancel(false);
    setMessage(null);
    setDetailLoading(true);
    try {
      const token = await getToken();
      const current = await scheduleApi.get(item.id, token);
      setSelectedSchedule(current);
      setSchedules((items) => items.map((schedule) => schedule.id === current.id ? current : schedule));
    } catch (error) {
      setMessage({ kind: "error", text: messageFor(error) });
      if (error instanceof ScheduleApiError && error.status === 404) {
        setSchedules((items) => items.filter((schedule) => schedule.id !== item.id));
        setSelectedId(null);
        setSelectedSchedule(null);
        setView("list");
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || extractionInFlight.current || saving || extracting) return;
    setMessage(null);
    if (extractionReview?.ambiguous_fields.includes("timezone") && !timezoneConflictConfirmed) {
      setMessage({ kind: "error", text: "Confirm which timezone should interpret this local time before saving." });
      return;
    }
    let targetDateTime: string;
    try {
      if (!form.time_intent) throw new Error("Choose whether this schedule is for arriving by a time or leaving at a time.");
      targetDateTime = toOffsetDateTime(form.target_datetime, form.timezone.trim());
    } catch (error) {
      setMessage({ kind: "error", text: messageFor(error) });
      return;
    }
    if ((form.title.trim().length > 200) || (form.preparation_duration_minutes !== null && (!Number.isInteger(form.preparation_duration_minutes) || form.preparation_duration_minutes < 0)) || (form.travel_duration_minutes !== null && (!Number.isInteger(form.travel_duration_minutes) || form.travel_duration_minutes < 0))) {
      setMessage({ kind: "error", text: "Enter a title of at most 200 characters and valid nonnegative whole-minute durations when provided." });
      return;
    }

    const input: ScheduleInput = {
      ...form,
      ...(editingId === null && extractionReview ? {} : (form.title.trim() ? { title: form.title.trim() } : {})),
      description: form.description?.trim() || null,
      location: form.location,
      origin_location: form.origin_location,
      time_intent: form.time_intent as ScheduleIntent,
      timezone: form.timezone.trim(),
      target_datetime: targetDateTime,
      ...(editingId === null && idempotencyKey.current ? { idempotency_key: idempotencyKey.current } : {}),
    };
    saveInFlight.current = true;
    setSaving(true);
    try {
      const token = await getToken();
      const updateInput: ScheduleUpdateInput = { ...input };
      if (editingId !== null && selectedSchedule && form.travel_duration_minutes === selectedSchedule.travel_duration_minutes) {
        delete updateInput.travel_duration_minutes;
      }
      const saved = editingId === null
        ? await scheduleApi.create({ ...input, ...(continueWithoutRoute.current ? { continue_without_route: true } : {}) }, token)
        : await scheduleApi.update(editingId, updateInput, token);
      setRouteUnavailableConfirmation(false);
      continueWithoutRoute.current = false;
      setLoadError(false);
      setSchedules((items) => editingId === null
        ? upsertScheduleNewestFirst(items, saved)
        : items.map((item) => item.id === saved.id ? saved : item));
      setSelectedId(saved.id);
      setSelectedSchedule(saved);
      setConfirmCancel(false);
      setView("detail");
      setMessage({ kind: "success", text: editingId === null ? "Schedule saved." : "Schedule updated." });
      setEditingId(null);
    } catch (error) {
      if (error instanceof ScheduleApiError && error.code === "route_unavailable_confirmation") {
        setRouteUnavailableConfirmation(true);
        setMessage(null);
        return;
      }
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function cancelSchedule() {
    if (!selectedSchedule || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      const cancelled = await scheduleApi.cancel(selectedSchedule.id, token);
      setLoadError(false);
      setSchedules((items) => items.map((item) => item.id === cancelled.id ? cancelled : item));
      setSelectedSchedule(cancelled);
      setConfirmCancel(false);
      setMessage({ kind: "success", text: "Schedule cancelled." });
    } catch (error) {
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function refreshRouteEstimate(schedule: Schedule) {
    if (routeRefreshingId !== null) return;
    const currentTime = Date.now();
    const until = routeCooldowns[schedule.id] ?? 0;
    if (until > currentTime) return;
    setRouteRefreshingId(schedule.id);
    setRouteCooldowns((value) => ({ ...value, [schedule.id]: currentTime + 60_000 }));
    setMessage(null);
    try {
      const token = await getToken();
      const refreshed = await scheduleApi.refreshTravelEstimate(schedule.id, token);
      setSchedules((items) => items.map((item) => item.id === refreshed.id ? refreshed : item));
      setSelectedSchedule((item) => item?.id === refreshed.id ? refreshed : item);
      setMessage({ kind: "success", text: "Travel estimate refreshed." });
    } catch (error) {
      if (error instanceof ScheduleApiError && error.retryAfterSeconds !== null) {
        setRouteCooldowns((value) => ({ ...value, [schedule.id]: Date.now() + error.retryAfterSeconds! * 1000 }));
      }
      if (error instanceof ScheduleApiError && error.code === "no_drivable_route") {
        setMessage({ kind: "info", text: "No drivable route was found, so traffic could not be refreshed. You can assess weather separately." });
        return;
      }
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      setRouteRefreshingId(null);
    }
  }

  async function refreshWeatherEstimate(schedule: Schedule) {
    if (weatherRefreshingId !== null) return;
    setWeatherRefreshingId(schedule.id);
    setMessage(null);
    try {
      const token = await getToken();
      const refreshed = await scheduleApi.refreshWeatherEstimate(schedule.id, token);
      setSchedules((items) => items.map((item) => item.id === refreshed.id ? refreshed : item));
      setSelectedSchedule((item) => item?.id === refreshed.id ? refreshed : item);
      setMessage(refreshed.weather_estimate?.status === "available"
        ? { kind: "success", text: "Weather advisory refreshed." }
        : { kind: "info", text: refreshed.weather_estimate?.summary ?? "Weather forecast data is unavailable right now." });
    } catch (error) {
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      setWeatherRefreshingId(null);
    }
  }

  const selected = selectedId === selectedSchedule?.id ? selectedSchedule : null;
  const originWeatherForecastAt = selected?.weather_estimate?.origin_forecast_at ?? selected?.weather_estimate?.forecast_at ?? null;
  const destinationWeatherForecastAt = selected?.weather_estimate?.destination_forecast_at ?? null;
  const hasWeatherAdvisory = selected?.weather_estimate?.status === "available" && selected.weather_estimate.advisories.length > 0;
  const suggestedRows = selected ? suggestedTimeRows(selected, formatDate) : [];
  const preparationNote = selected ? arrivalPreparationNote(selected) : null;
  const extractionQuestions = extractionReview ? clarificationQuestions(extractionReview, form.timezone) : [];
  const showSplitTargetInputs = Boolean(
    extractionReview?.status === "needs_clarification" &&
      extractionReview.extraction &&
      (extractionReview.missing_fields.includes("target_date_local") ||
        extractionReview.missing_fields.includes("target_time_local") ||
        extractionReview.ambiguous_fields.includes("target_time_local") ||
        extractionReview.invalid_fields.includes("target_time_local") ||
        extractionReview.invalid_fields.includes("target_time_offset")),
  );

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="/dashboard" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]" aria-label="Deadline Notifier dashboard">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-subtle)] text-[var(--brand-primary)]" aria-hidden="true"><CalendarIcon /></span>
            <span><span className="block text-sm font-bold tracking-tight">Deadline Notifier</span><span className="block text-xs text-[var(--text-muted)]">Your schedule</span></span>
          </a>
          <div className="flex items-center gap-3"><a className="hidden rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] sm:block" href="/dashboard">Dashboard</a><UserButton /></div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULES</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Plan what&apos;s next</h1><p className="mt-2 text-[var(--text-secondary)]">Keep your upcoming plans clear and easy to manage.</p></div>
          <button className={primaryButton} onClick={openCreate} disabled={!isLoaded || loading}><PlusIcon /> New schedule</button>
        </div>
        {message && <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${message.kind === "success" ? "border-[var(--state-success)]/20 bg-[var(--state-success-bg)] text-[var(--state-success)]" : message.kind === "info" ? "border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)] text-[var(--state-warning)]" : "border-[var(--state-error)]/20 bg-[var(--state-error-bg)] text-[var(--state-error)]"}`} role={message.kind === "error" ? "alert" : "status"}><span className="font-bold" aria-hidden="true">{message.kind === "success" ? "✓" : "!"}</span><span>{message.text}</span><button className="ml-auto rounded px-2 font-semibold focus-visible:outline-2" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section aria-labelledby="upcoming-heading" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><h2 id="upcoming-heading" className="font-semibold">Upcoming schedules</h2><p className="mt-0.5 text-sm text-[var(--text-muted)]">{activeSchedules.length} active {activeSchedules.length === 1 ? "schedule" : "schedules"}</p></div><button className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-subtle)] disabled:opacity-60" onClick={refreshSchedules} disabled={loading} aria-label="Refresh schedules">Refresh</button></div>
            {loading ? <div className="space-y-3 p-5" aria-label="Loading schedules" role="status"><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><span className="sr-only">Loading schedules...</span></div> : loadError ? <div className="px-6 py-14 text-center"><h3 className="font-semibold">Schedules couldn&apos;t be loaded</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Resolve the service or session error above, then try again.</p><button className={`${primaryButton} mt-5`} onClick={refreshSchedules}><RefreshIcon /> Try again</button></div> : activeSchedules.length === 0 ? <div className="px-6 py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-subtle)] text-[var(--brand-primary)]"><CalendarIcon /></span><h3 className="mt-4 font-semibold">{schedules.length ? "No active schedules" : "No upcoming schedules"}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-muted)]">{schedules.length ? "Create a new schedule to plan what's next." : "Add a schedule to see it here."}</p><button className={`${primaryButton} mt-5`} onClick={openCreate}><PlusIcon /> Add a schedule</button></div> : <ul className="divide-y divide-[var(--border)]">{activeSchedules.map((item) => <li key={item.id}><button onClick={() => void selectSchedule(item)} className={`w-full p-5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--brand-primary)] sm:px-6 ${selectedId === item.id && view === "detail" ? "bg-[var(--brand-subtle)]" : ""}`} aria-current={selectedId === item.id && view === "detail" ? "true" : undefined}><div className="flex items-start justify-between gap-4"><span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{formatDate(item.target_datetime, item.timezone)}</span></span><span className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">{item.time_intent === "arrival" ? "Arrive by" : "Leave at"}</span></div><span className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClockIcon /> {item.timezone} <span aria-hidden="true">·</span><span className="capitalize">{item.status}</span></span></button></li>)}</ul>}
          </section>

          <section aria-label={view === "form" ? (editingId ? "Edit schedule" : "Create schedule") : "Schedule details"} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {view === "form" ? <form ref={scheduleForm} onSubmit={(event) => void saveSchedule(event)} className="p-5 sm:p-6"><div className="mb-6 flex items-start justify-between"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">{editingId ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</p><h2 className="mt-1 text-xl font-bold">{editingId ? "Update your plan" : "Create a schedule"}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Changes are saved to your account after the API confirms them.</p></div><button type="button" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" aria-label="Close form" onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>×</button></div>
              <div className="space-y-4">
                {!editingId && <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4" aria-labelledby="natural-language-heading">
                  <h3 id="natural-language-heading" className="font-semibold">Describe your schedule</h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">AI will prepare a draft using the selected timezone. Review every field before saving.</p>
                  <textarea className={fieldClass} rows={3} maxLength={4000} value={extractionText} onChange={(event) => { setExtractionText(event.target.value); setExtractionReview(null); setExtractionError(null); }} placeholder="e.g. I need to arrive at school tomorrow at 7" aria-label="Schedule description for extraction" />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Timezone context: {form.timezone ? timezoneLabel(form.timezone) : "not selected"}</p>
                  <button type="button" className={`${secondaryButton} mt-3`} onClick={() => void extractSchedule()} disabled={extracting || saving || !extractionText.trim()}>
                    {extracting ? "Extracting..." : extractionReview || extractionError ? "Retry extraction" : "Extract draft"}
                  </button>
                  {extracting && <p className="mt-2 text-sm text-[var(--text-muted)]" role="status">Preparing a draft. Your text remains here if the request fails.</p>}
                  {extractionError && <div className="mt-3 rounded-lg border border-[var(--state-error)]/20 bg-[var(--state-error-bg)] px-3 py-2 text-sm text-[var(--state-error)]" role="alert">{extractionError} Your description is preserved; retry or continue manually.</div>}
                  {extractionReview && <div className={`mt-3 rounded-lg border px-3 py-3 text-sm ${extractionReview.status === "ready_for_review" ? "border-[var(--state-success)]/20 bg-[var(--state-success-bg)] text-[var(--state-success)]" : "border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)] text-[var(--state-warning)]"}`} role="status">
                    <p className="font-semibold">{extractionReview.status === "ready_for_review" ? "Draft ready for your review" : "More information is needed"}</p>
                    {extractionQuestions.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{extractionQuestions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}</ul>}
                    {extractionReview.extraction && (extractionReview.extraction.origin_description || extractionReview.extraction.destination_description) && <p className="mt-2">Select a matching result for each extracted place before automatic saving. Locations remain optional for schedules that do not need routing.</p>}
                    {extractionReview.ambiguous_fields.includes("timezone") && <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={timezoneConflictConfirmed} onChange={(event) => setTimezoneConflictConfirmed(event.target.checked)} /><span>I confirm that {form.timezone} should interpret the target time.</span></label>}
                    {extractionReview.extraction && <p className="mt-2 text-xs">Known values are filled into the editable form. Nothing has been saved.</p>}
                    {!extractionReview.extraction && <p className="mt-2 text-xs">Retry extraction or complete the form manually. Nothing has been saved.</p>}
                  </div>}
                </section>}
                <label className="block text-sm font-medium">Title <span className="font-normal text-[var(--text-muted)]">(optional)</span><input className={fieldClass} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Team planning meeting" /></label><label className="block text-sm font-medium">Description <span className="font-normal text-[var(--text-muted)]">(optional)</span><textarea className={fieldClass} rows={3} maxLength={4000} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Add notes for this schedule" /></label>
                <div className="grid gap-4 sm:grid-cols-2"><LocationPicker label="Origin" value={form.origin_location} query={originQuery} results={originResults} searching={originSearching} onQuery={(value) => { clearRouteUnavailableConfirmation(); setOriginQuery(value); setOriginResults([]); if (shouldInvalidateLocationSelection(form.origin_location, value)) setForm((current) => ({ ...current, origin_location: null })); }} onSearch={() => void searchOriginLocations()} onSelect={(origin_location) => { clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, origin_location })); setOriginQuery(origin_location.name); setOriginResults([]); }} onClear={() => { clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, origin_location: null })); setOriginResults([]); }} /><LocationPicker label="Destination" value={form.location} query={locationQuery} results={locationResults} searching={locationSearching} onQuery={(value) => { clearRouteUnavailableConfirmation(); setLocationQuery(value); setLocationResults([]); if (shouldInvalidateLocationSelection(form.location, value)) setForm((current) => ({ ...current, location: null })); }} onSearch={() => void searchLocations()} onSelect={(location) => { clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, location })); setLocationQuery(location.name); setLocationResults([]); }} onClear={() => { clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, location: null })); setLocationResults([]); }} /></div>
                {showSplitTargetInputs ? <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium">Target date <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="date" required value={extractionDate} onChange={(event) => updateExtractionDate(event.target.value)} /></label>
                  <label className="block text-sm font-medium">Target local time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="time" required value={extractionTime} onChange={(event) => updateExtractionTime(event.target.value)} /></label>
                  <p className="text-xs text-[var(--text-muted)] sm:col-span-2">The date and time use the selected timezone and will be checked for daylight-saving gaps or repeats before saving.</p>
                </div> : <label className="block text-sm font-medium">Target date and time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="datetime-local" required value={form.target_datetime} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, target_datetime: e.target.value }); }} /></label>}
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Time intent <span className="text-[var(--state-error)]">*</span><select className={fieldClass} required value={form.time_intent} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, time_intent: e.target.value as ScheduleIntent | "" }); }}><option value="" disabled>Select arrival or departure</option><option value="arrival">Arrive by</option><option value="departure">Leave at</option></select></label><label className="block text-sm font-medium">Timezone<select className={fieldClass} required value={form.timezone} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, timezone: e.target.value }); setTimezoneConflictConfirmed(false); }}>{Array.from(new Set([form.timezone, ...supportedTimeZones])).sort().map((timezone) => <option key={timezone} value={timezone}>{timezoneLabel(timezone)}</option>)}</select><span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">The target time is interpreted in this timezone.</span></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Preparation <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.preparation_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, preparation_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label><label className="block text-sm font-medium">Travel duration <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.travel_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, travel_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
                {routeUnavailableConfirmation && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-4 text-sm text-[var(--state-warning)]" role="alert"><p className="font-semibold">No drivable route found</p><p className="mt-1">TomTom could not find a drivable route between these locations. A traffic estimate will be unavailable, but weather can be assessed separately. Do you want to save anyway?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={saving} onClick={() => { continueWithoutRoute.current = true; setRouteUnavailableConfirmation(false); scheduleForm.current?.requestSubmit(); }}>Save without route estimate</button><button type="button" className={secondaryButton} onClick={() => { clearRouteUnavailableConfirmation(); }}>Review locations</button></div></div>}
              </div><div className="mt-6 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:justify-end"><button type="button" className={secondaryButton} disabled={saving || extracting} onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>Discard</button><button type="submit" className={primaryButton} disabled={saving || extracting}>{saving ? "Saving..." : <><CheckIcon /> {editingId ? "Save changes" : extractionReview?.extraction ? "Save reviewed schedule" : "Add schedule"}</>}</button></div></form> : selected ? <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULE DETAILS</p><h2 className="mt-1 text-xl font-bold leading-snug">{selected.title}</h2></div><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${selected.status === "active" ? "bg-[var(--state-success-bg)] text-[var(--state-success)]" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{selected.status}</span></div>
              {detailLoading ? <p className="mt-4 text-sm text-[var(--text-muted)]" role="status">Refreshing schedule details...</p> : null}
              {showPastScheduleNotices(selected.is_past) && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status"><p className="font-semibold">{PAST_SCHEDULE_BANNER_TITLE}</p><p className="mt-1">Live traffic and future weather advisories no longer apply to this intended trip. The schedule remains editable and can be cancelled.</p></div>}
              {showPostDepartureRouteWarning(selected.is_past, selected.route_warning) && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status"><p>{selected.route_warning}</p>{selected.travel_estimate && <p className="mt-1 text-xs">Retrieved {formatDate(selected.travel_estimate.retrieved_at, selected.timezone, true)}; intended departure {formatDate(selected.calculated_departure_time ?? selected.target_datetime, selected.timezone, true)}.</p>}</div>}
              {selected.travel_estimate && showStaleEstimateWarning(selected.is_past, selected.travel_estimate.retrieved_at, clockNow) && <p className="mt-3 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status">This estimate was retrieved over 15 minutes ago; its traffic information may be out of date.</p>}
              {(selected.origin_location || selected.location) && <div className="mt-5 grid gap-3 sm:grid-cols-2">{([["Origin", selected.origin_location], ["Destination", selected.location]] as const).map(([label, place]) => <div key={label} className="rounded-xl border border-[var(--border)] p-4"><h3 className="text-sm font-semibold">{label}</h3>{place ? <><p className="mt-1 font-medium">{place.name}</p><p className="text-sm text-[var(--text-secondary)]">{[place.locality, place.region, place.country].filter(Boolean).join(", ")}</p></> : <p className="mt-1 text-sm text-[var(--text-muted)]">Select an origin to calculate a route.</p>}</div>)}</div>}
              <div className="mt-6 rounded-xl bg-[var(--surface-secondary)] p-4"><p className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]"><CalendarIcon /> Target {selected.time_intent}</p><p className="mt-2 text-lg font-semibold tabular-nums">{formatDate(selected.target_datetime, selected.timezone)}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{selected.timezone}</p></div>
              <dl className="mt-5 divide-y divide-[var(--border)]"><DetailRow label="Time intent" value={selected.time_intent === "arrival" ? "Arrive by" : "Leave at"} /><DetailRow label="Preparation" value={selected.preparation_duration_minutes === null ? "Not provided" : `${selected.preparation_duration_minutes} minutes`} /><DetailRow label="Travel duration" value={selected.travel_duration_minutes === null ? (selected.origin_location && selected.location ? "Unavailable" : "Select an origin and destination") : `${selected.travel_duration_minutes} minutes`} /><DetailRow label="Description" value={selected.description || "No additional notes"} /></dl>
              {showTravelTrafficCard(selected.is_past, Boolean(selected.travel_estimate)) && <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Travel and traffic estimate">
                <h3 className="text-sm font-semibold">Travel and traffic</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums">{selected.travel_duration_minutes === null ? "Travel duration unavailable" : `${selected.travel_duration_minutes} min`}</p>
                {selected.travel_estimate && <>
                  {showPastScheduleNotices(selected.is_past) && <p className="mt-2 rounded-lg bg-[var(--surface-secondary)] p-3 text-sm text-[var(--text-secondary)]">{historicalEstimateNotice(formatDate(selected.travel_estimate.retrieved_at, selected.timezone, true))}</p>}
                  <p className="mt-1 text-sm font-semibold">{trafficStatusLabel(selected.traffic_status)}</p>
                  {selected.traffic_delay_minutes !== null && <p className="mt-1 text-sm text-[var(--text-secondary)]">Estimated route-level traffic delay: {selected.traffic_delay_minutes} min</p>}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{routeTimeBasisLabel(selected.travel_estimate.route_time_basis)}. Retrieved {formatDate(selected.travel_estimate.retrieved_at, selected.timezone)}.</p>
                  <div className="mt-3 border-t border-[var(--border)] pt-3"><h4 className="text-sm font-semibold">Traffic along your route</h4>{selected.travel_estimate.traffic_sections.length > 0 ? <><div className="mt-2 space-y-3">{groupTrafficSections(selected.travel_estimate.traffic_sections).map((group: TrafficRoadGroup) => <section key={group.identity} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold">{group.road_name}</h5>{group.is_approximate_location && <span className="rounded-full border border-[var(--border)] bg-[var(--surface-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">Approximate location</span>}</div>{group.route_designations.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Route designations: {group.route_designations.join(" · ")}</p>}<p className="mt-2 text-sm text-[var(--text-secondary)]"><span className="font-medium">{group.incident_count} {group.incident_count === 1 ? "incident" : "incidents"}</span> · {group.incident_type_counts.map(({ label, count }) => `${count} ${label.toLocaleLowerCase()}`).join(" · ")}</p><p className="mt-1 text-sm text-[var(--text-secondary)]"><span className="font-medium">Combined reported incident delays:</span> {group.delay_total_complete ? formatTrafficDelay(group.combined_delay_seconds) : `Incomplete (${group.unavailable_delay_count} incident ${group.unavailable_delay_count === 1 ? "delay is" : "delays are"} unavailable${group.known_delay_seconds > 0 ? `; known reports total ${formatTrafficDelay(group.known_delay_seconds)}` : ""})`}</p><details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-[var(--brand-primary)]">Incident details ({group.incident_count})</summary><ul className="mt-2 space-y-2">{group.events.map((section: TrafficSectionEstimate, index: number) => { const details = trafficIncidentDetails(section, group); return details ? <li key={index} className="border-t border-[var(--border)] pt-2 text-sm"><p className="font-medium text-[var(--text-secondary)]">{details.incident_type_label}</p>{details.location_label && <p className="mt-1 text-[var(--text-secondary)]">{details.location_label}</p>}<p className="mt-1 text-[var(--text-secondary)]">Reported incident delay: {details.reported_delay_label}</p></li> : null; })}</ul></details></section>)}</div><p className="mt-2 text-xs text-[var(--text-muted)]">Combined reported incident delays are provider incident figures. They do not represent additional travel time or a breakdown of the route-level traffic delay. Locations marked approximate are nearby reverse-geocoding results and do not confirm the affected road.</p></> : <p className="mt-1 text-sm text-[var(--text-muted)]">TomTom reported no traffic-affected portions for this estimate.</p>}</div>
                </>}
                {!selected.travel_estimate && selected.is_past && <p className="mt-1 text-sm text-[var(--text-muted)]">A useful estimate for this past trip is unavailable.</p>}
              </section>}
              {selected.status === "active" && selected.origin_location && selected.location && <div className="mt-3 flex flex-wrap items-center gap-3">{!selected.is_past ? <button type="button" className={secondaryButton} disabled={routeRefreshingId !== null || weatherRefreshingId !== null || (Boolean(selected.travel_estimate) && (routeCooldowns[selected.id] ?? 0) > clockNow)} onClick={() => selected.travel_estimate ? void refreshRouteEstimate(selected) : void refreshWeatherEstimate(selected)}><RefreshIcon />{routeRefreshingId === selected.id ? "Refreshing route..." : weatherRefreshingId === selected.id ? "Refreshing weather..." : selected.travel_estimate ? "Refresh route estimate" : "Refresh weather advisory"}</button> : <span className="text-xs text-[var(--text-muted)]">Refresh unavailable for a past schedule. Edit the departure time to a future time to assess it again.</span>}{!selected.is_past && selected.travel_estimate && (routeCooldowns[selected.id] ?? 0) > clockNow && <span className="text-xs text-[var(--text-muted)]" role="status">Refresh available in {Math.ceil((routeCooldowns[selected.id] - clockNow) / 1000)}s</span>}</div>}
              <section className={`mt-4 rounded-xl border p-4 ${hasWeatherAdvisory ? "border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)]" : "border-[var(--border)] bg-[var(--surface)]"}`} aria-label="Weather advisory">
                <h3 className="text-sm font-semibold">Weather advisory</h3>
                {selected.is_past && <p className="mt-2 text-sm text-[var(--text-muted)]">Future weather advisories are no longer applicable to this past trip.</p>}
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{selected.weather_estimate ? selected.weather_estimate.summary : "Weather information is temporarily unavailable."}</p>
                {selected.weather_estimate?.status === "available" && selected.weather_estimate.advisories.map((advisory, index) => <p className="mt-2 text-sm font-medium text-[var(--state-warning)]" key={`${advisory.endpoint}-${advisory.condition}-${index}`}>{advisory.condition} is forecast near your {advisory.endpoint} around {formatDate(advisory.forecast_at, selected.timezone)} and may affect your trip.</p>)}
                <p className="mt-1 text-xs text-[var(--text-muted)]">Forecast conditions, not current observations. Forecasts cover the selected route endpoints, not every location along the route. Weather advisories are separate from the route duration and traffic delay.</p>
                {selected.weather_estimate?.status === "available" && selected.travel_duration_minutes === null && <p className="mt-1 text-xs text-[var(--text-muted)]">No travel duration is known, so these are endpoint weather snapshots near the scheduled event time, not forecasts timed to estimated departure and arrival.</p>}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {([ ["Origin", selected.weather_estimate?.origin_weather, originWeatherForecastAt], ["Destination", selected.weather_estimate?.destination_weather, destinationWeatherForecastAt] ] as const).map(([label, forecast, forecastAt]) => <div key={label} className="rounded-lg border border-[var(--border)] p-3">
                    <h4 className="text-xs font-semibold">{label} forecast</h4>
                    <p className="mt-1 text-sm font-medium">{selected.weather_estimate?.status === "available" ? forecast?.condition ?? "Condition unavailable" : "Forecast unavailable"}</p>
                    {forecastAt && <p className="mt-1 text-xs text-[var(--text-muted)]">Forecast for {formatDate(forecastAt, selected.timezone)}</p>}
                    {selected.weather_estimate?.status === "available" && forecast && <p className="mt-1 text-xs text-[var(--text-secondary)]">Precipitation {forecast.precipitation_mm.toFixed(1)} mm · Snow {forecast.snowfall_cm.toFixed(1)} cm · Wind {forecast.wind_speed_kmh.toFixed(0)} km/h</p>}
                  </div>)}
                </div>
                {selected.weather_estimate?.retrieved_at && <p className="mt-2 text-xs text-[var(--text-muted)]">Forecast data retrieved {formatDate(selected.weather_estimate.retrieved_at, selected.timezone)}.</p>}
              </section>
              <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Calculated schedule suggestions"><h3 className="text-sm font-semibold">Suggested times</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Calculated from your durations and configured buffers.</p>{preparationNote && <p className="mt-2 text-xs text-[var(--state-warning)]">{preparationNote}</p>}<dl className="mt-3 divide-y divide-[var(--border)]">{suggestedRows.map((row) => <div className="py-2" key={row.label}><dt className="text-xs text-[var(--text-muted)]">{row.label}</dt><dd className="mt-1 text-sm font-medium">{row.value}</dd></div>)}</dl></section>
              {selected.status === "active" && <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--border)] pt-5"><button className={secondaryButton} disabled={saving || detailLoading} onClick={() => openEdit(selected)}><PencilIcon /> Edit</button><button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--state-error)]/30 px-4 py-2 text-sm font-semibold text-[var(--state-error)] hover:bg-[var(--state-error-bg)] focus-visible:outline-2 focus-visible:outline-[var(--state-error)] disabled:opacity-60" disabled={saving || detailLoading} onClick={() => setConfirmCancel(true)}><CloseIcon /> Cancel schedule</button></div>}
              {confirmCancel && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)] p-4" role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-copy"><h3 id="cancel-title" className="font-semibold text-[var(--state-warning)]">Cancel this schedule?</h3><p id="cancel-copy" className="mt-1 text-sm text-[var(--text-secondary)]">It will be marked cancelled in your account.</p><div className="mt-3 flex gap-2"><button className="rounded-lg bg-[var(--state-error)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60" onClick={() => void cancelSchedule()} disabled={saving}>{saving ? "Cancelling..." : "Yes, cancel"}</button><button className={secondaryButton} onClick={() => setConfirmCancel(false)} disabled={saving}>Keep schedule</button></div></div>}
            </div> : <div className="px-6 py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-muted)]"><CalendarIcon /></span><h2 className="mt-4 font-semibold">Choose a schedule</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Select an item to see its details, or create a new schedule.</p></div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function LocationPicker({ label, value, query, results, searching, onQuery, onSearch, onSelect, onClear }: { label: string; value: LocationSelection | null; query: string; results: LocationSelection[]; searching: boolean; onQuery: (value: string) => void; onSearch: () => void; onSelect: (value: LocationSelection) => void; onClear: () => void }) {
  return <fieldset className="rounded-xl border border-[var(--border)] p-4"><legend className="px-1 text-sm font-semibold">{label} <span className="font-normal text-[var(--text-muted)]">(optional)</span></legend><p className="text-xs text-[var(--text-muted)]">Search and explicitly choose the {label.toLowerCase()}; routing needs both places.</p>{value ? <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-[var(--surface-secondary)] p-3"><div><p className="font-medium">{value.name}</p><p className="text-sm text-[var(--text-secondary)]">{[value.locality, value.region, value.country].filter(Boolean).join(", ")}</p></div><button type="button" className={secondaryButton} onClick={onClear}>Change</button></div> : <><div className="mt-3 flex gap-2"><input aria-label={`Search ${label.toLowerCase()}`} className={fieldClass} value={query} maxLength={200} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }} placeholder="School, home, business, or address"/><button type="button" className={secondaryButton} disabled={searching || query.trim().length < 2} onClick={onSearch}>{searching ? "Searching..." : "Search"}</button></div>{results.length > 0 && <ul className="mt-3 space-y-2" aria-label={`${label} search results`}>{results.map((place, index) => <li key={`${place.latitude}:${place.longitude}:${index}`}><button type="button" className="w-full rounded-lg border border-[var(--border)] p-3 text-left hover:bg-[var(--surface-hover)]" onClick={() => onSelect(place)}><span className="block font-medium">{place.name}</span><span className="block text-sm text-[var(--text-secondary)]">{[place.locality, place.region, place.country].filter(Boolean).join(", ")}</span></button></li>)}</ul>}</>}</fieldset>;
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[minmax(100px,0.7fr)_1.3fr] gap-3 py-3 text-sm"><dt className="text-[var(--text-muted)]">{label}</dt><dd className="break-words font-medium capitalize text-[var(--text-primary)]">{value}</dd></div>; }
function CalendarIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" strokeLinecap="round"/></svg>; }
function ClockIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PlusIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>; }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PencilIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>; }
function RefreshIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
