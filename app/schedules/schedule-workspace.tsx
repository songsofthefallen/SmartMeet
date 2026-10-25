"use client";

import { useAuth } from "@clerk/nextjs";
import { CalendarDays, Check, Clock3, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { scheduleApi, ScheduleApiError, type LocationSelection, type RouteAlternativeEstimate, type Schedule, type ScheduleExtractionReview, type ScheduleInput, type ScheduleIntent, type ScheduleUpdateInput, type SavedPlace, type TrafficSectionEstimate } from "@/lib/schedule-api";
import { clarificationQuestions } from "@/lib/clarification-messages";
import { localDateTimeFromExtraction, localTimeInputFromExtraction } from "@/lib/schedule-extraction-time";
import { isAssistantAutosaveEligible } from "@/lib/assistant-autosave";
import { formatTrafficDelay, groupTrafficSections, routeTimeBasisLabel, trafficIncidentDetails, trafficStatusLabel } from "@/lib/traffic-display.js";
import { arrivalPreparationNote, suggestedTimeRows } from "@/lib/suggested-times.js";
import { upsertScheduleNewestFirst } from "@/lib/schedule-order.js";
import { shouldInvalidateLocationSelection } from "@/lib/location-selection.js";
import { isCurrentGeneration, isCurrentGenerationForKey } from "@/lib/request-generation";
import { hasRouteLocations, hasWeatherLocation } from "@/lib/location-aware-state.js";
import { historicalEstimateNotice, PAST_SCHEDULE_BANNER_TITLE, showPastScheduleNotices, showPostDepartureRouteWarning, showStaleEstimateWarning, showTravelTrafficCard } from "@/lib/schedule-warning-display.js";
import { RouteComparisonMap } from "./route-comparison-map";
import { SavedPlacesPanel, useSavedPlaces } from "./saved-places";
import { savedPlaceLocation } from "@/lib/saved-place.js";

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

function isCancellation(error: unknown): boolean {
  return error instanceof ScheduleApiError && error.code === "cancelled";
}

export default function ScheduleWorkspace({ startInCreate = false }: { startInCreate?: boolean }) {
  const { getToken, isLoaded } = useAuth();
  const { places: savedPlaces } = useSavedPlaces();
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
  const initialCreateHandled = useRef(false);
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
  const [routeOptions, setRouteOptions] = useState<RouteAlternativeEstimate[] | null>(null);
  const [routeOptionsKey, setRouteOptionsKey] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeOptionsLoading, setRouteOptionsLoading] = useState(false);
  const [routeOptionsError, setRouteOptionsError] = useState<string | null>(null);
  const [routeNoRouteKey, setRouteNoRouteKey] = useState<string | null>(null);
  const [routeSearchVersion, setRouteSearchVersion] = useState(0);
  const routeOptionsGeneration = useRef(0);
  const currentRouteKey = JSON.stringify([form.origin_location, form.location]);
  const currentRouteContextKey = JSON.stringify([form.origin_location, form.location, form.time_intent, form.target_datetime, form.timezone]);
  const currentRouteContextKeyRef = useRef(currentRouteContextKey);
  currentRouteContextKeyRef.current = currentRouteContextKey;
  const routeOptionsKeyRef = useRef(routeOptionsKey);
  routeOptionsKeyRef.current = routeOptionsKey;
  const currentRouteOptions = routeOptionsKey === currentRouteContextKey ? routeOptions : null;
  const hasDefinitiveNoRoute = routeNoRouteKey === currentRouteKey;
  const routeLocationsReady = hasRouteLocations(form.origin_location, form.location);
  const locationSearchGeneration = useRef(0);
  const originSearchGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const mounted = useRef(true);
  const activeControllers = useRef(new Set<AbortController>());

  useEffect(() => {
    mounted.current = true;
    const controllers = activeControllers.current;
    return () => {
      mounted.current = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const activeSchedules = useMemo(
    () => schedules.filter((item) => item.status === "active"),
    [schedules],
  );

  const loadSchedules = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    try {
      const token = await getToken();
      const items = await scheduleApi.list(token, { signal: controller.signal });
      if (!mounted.current || !isCurrentGeneration(generation, loadGeneration.current)) return;
      setLoadError(false);
      setSchedules(items);
      const requestedId = Number(new URLSearchParams(window.location.search).get("open"));
      const first = items.find((item) => item.id === requestedId) ?? items.find((item) => item.status === "active") ?? items[0] ?? null;
      setSelectedId(first?.id ?? null);
      setSelectedSchedule(first);
      setView(first ? "detail" : "list");
    } catch (error) {
      if (!mounted.current || !isCurrentGeneration(generation, loadGeneration.current) || isCancellation(error)) return;
      setLoadError(true);
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current && isCurrentGeneration(generation, loadGeneration.current)) setLoading(false);
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

  useEffect(() => {
    if (view !== "form" || !routeLocationsReady) {
      const clearTimer = window.setTimeout(() => {
        setRouteOptions(null);
        setRouteOptionsKey(null);
        setSelectedRouteId(null);
        setRouteOptionsLoading(false);
        setRouteOptionsError(null);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    if (!form.target_datetime || !form.time_intent) {
      const clearTimer = window.setTimeout(() => {
        setRouteOptions(null);
        setRouteOptionsKey(null);
        setSelectedRouteId(null);
        setRouteOptionsLoading(false);
        setRouteOptionsError(null);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    let targetDatetime: string;
    try {
      targetDatetime = toOffsetDateTime(form.target_datetime, form.timezone.trim());
    } catch {
      const clearTimer = window.setTimeout(() => {
        setRouteOptions(null);
        setRouteOptionsKey(null);
        setSelectedRouteId(null);
        setRouteOptionsLoading(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }
    const savedAlternatives = selectedSchedule?.travel_estimate?.alternatives ?? [];
    const sameAsSavedRouteContext = Boolean(editingId !== null && selectedSchedule && savedAlternatives.length > 0
      && JSON.stringify(form.origin_location) === JSON.stringify(selectedSchedule.origin_location)
      && JSON.stringify(form.location) === JSON.stringify(selectedSchedule.location)
      && form.time_intent === selectedSchedule.time_intent
      && Date.parse(targetDatetime) === Date.parse(selectedSchedule.target_datetime));
    if (sameAsSavedRouteContext) {
      const restoreTimer = window.setTimeout(() => {
        setRouteOptions(savedAlternatives);
        setRouteOptionsKey(currentRouteContextKey);
        setSelectedRouteId((current) => savedAlternatives.some((route) => route.route_id === current)
          ? current
          : savedAlternatives.find((route) => route.route_id === selectedSchedule?.travel_estimate?.selected_route_id)?.route_id
            ?? savedAlternatives[0]?.route_id
            ?? null);
        setRouteOptionsLoading(false);
        setRouteOptionsError(null);
      }, 0);
      return () => window.clearTimeout(restoreTimer);
    }
    const generation = ++routeOptionsGeneration.current;
    const requestKey = currentRouteContextKey;
    if (routeOptionsKeyRef.current !== requestKey) {
      setSelectedRouteId(null);
      setRouteOptionsError(null);
    }
    if (routeNoRouteKey === currentRouteKey) return;
    let controller: AbortController | null = null;
    const timer = window.setTimeout(() => {
      const requestController = new AbortController();
      controller = requestController;
      activeControllers.current.add(requestController);
      setRouteOptionsLoading(true);
      setRouteOptionsError(null);
      void getToken().then((token) => scheduleApi.routeOptions({
        origin_location: form.origin_location!,
        location: form.location!,
        time_intent: form.time_intent as ScheduleIntent,
        target_datetime: targetDatetime,
      }, token, { signal: requestController.signal })).then((result) => {
        if (!isCurrentGenerationForKey(generation, routeOptionsGeneration.current, requestKey, currentRouteContextKeyRef.current)) return;
        setRouteOptions(result.alternatives);
        setRouteOptionsKey(requestKey);
        setSelectedRouteId((current) => result.alternatives.some((route) => route.route_id === current)
          ? current
          : result.alternatives[0]?.route_id ?? null);
      }).catch((error: unknown) => {
        if (!isCurrentGenerationForKey(generation, routeOptionsGeneration.current, requestKey, currentRouteContextKeyRef.current)) return;
        if (isCancellation(error)) return;
        if (error instanceof ScheduleApiError && error.code === "no_drivable_route") {
          setRouteNoRouteKey(currentRouteKey);
          setRouteOptions(null);
          setRouteOptionsKey(null);
          setSelectedRouteId(null);
        }
        setRouteOptionsError(messageFor(error));
      }).finally(() => {
        activeControllers.current.delete(requestController);
        if (isCurrentGenerationForKey(generation, routeOptionsGeneration.current, requestKey, currentRouteContextKeyRef.current)) setRouteOptionsLoading(false);
      });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      routeOptionsGeneration.current += 1;
      controller?.abort();
    };
  }, [view, editingId, selectedSchedule, form.origin_location, form.location, form.target_datetime, form.time_intent, form.timezone, getToken, routeSearchVersion, routeNoRouteKey, routeLocationsReady, currentRouteContextKey, currentRouteKey]);

  const openCreate = useCallback(() => {
    setRouteNoRouteKey(null);
    setRouteOptionsKey(null);
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
  }, []);

  useEffect(() => {
    if (!startInCreate || !isLoaded || loading || initialCreateHandled.current) return;
    initialCreateHandled.current = true;
    openCreate();
  }, [isLoaded, loading, openCreate, startInCreate]);

  function clearRouteUnavailableConfirmation() {
    setRouteUnavailableConfirmation(false);
    continueWithoutRoute.current = false;
  }

  function openEdit(item: Schedule) {
    clearRouteUnavailableConfirmation();
    setEditingId(item.id);
    setRouteNoRouteKey(item.route_availability === "no_drivable_route"
      ? JSON.stringify([item.origin_location, item.location])
      : null);
    const savedAlternatives = item.travel_estimate?.alternatives ?? [];
    setRouteOptions(savedAlternatives.length ? savedAlternatives : null);
    setRouteOptionsKey(null);
    setSelectedRouteId(savedAlternatives.find((route) => route.route_id === item.travel_estimate?.selected_route_id)?.route_id
      ?? savedAlternatives[0]?.route_id
      ?? null);
    setRouteOptionsLoading(false);
    setRouteOptionsError(null);
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
    const generation = ++locationSearchGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setLocationSearching(true);
    setLocationResults([]);
    setMessage(null);
    try {
      const token = await getToken();
      const response = await scheduleApi.searchLocations(locationQuery.trim(), token, { signal: controller.signal });
      if (!mounted.current || !isCurrentGeneration(generation, locationSearchGeneration.current)) return;
      setLocationResults(response.results);
      if (response.results.length === 0) setMessage({ kind: "error", text: "No matching locations found. Try a nearby town or a more specific name." });
    } catch (error) {
      if (!mounted.current || !isCurrentGeneration(generation, locationSearchGeneration.current) || isCancellation(error)) return;
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current && isCurrentGeneration(generation, locationSearchGeneration.current)) setLocationSearching(false);
    }
  }

  async function searchOriginLocations() {
    if (originSearching || originQuery.trim().length < 2) return;
    const generation = ++originSearchGeneration.current;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setOriginSearching(true);
    setOriginResults([]);
    try {
      const token = await getToken();
      const response = await scheduleApi.searchLocations(originQuery.trim(), token, { signal: controller.signal });
      if (!mounted.current || !isCurrentGeneration(generation, originSearchGeneration.current)) return;
      setOriginResults(response.results);
      if (response.results.length === 0) setMessage({ kind: "error", text: "No matching origins found. Try a nearby town or a more specific name." });
    } catch (error) {
      if (mounted.current && isCurrentGeneration(generation, originSearchGeneration.current) && !isCancellation(error)) setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current && isCurrentGeneration(generation, originSearchGeneration.current)) setOriginSearching(false);
    }
  }

  async function extractSchedule() {
    if (extractionInFlight.current || saveInFlight.current || !extractionText.trim() || saving) return;
    extractionInFlight.current = true;
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setExtracting(true);
    setExtractionError(null);
    setExtractionReview(null);
    clearRouteUnavailableConfirmation();
    setMessage(null);
    try {
      const token = await getToken();
      const selectedTimezone = form.timezone.trim();
      const review = await scheduleApi.extract(extractionText, selectedTimezone || null, token, { signal: controller.signal });
      if (!mounted.current) return;
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
          timezone: review.ambiguous_fields.includes("timezone")
            ? selectedTimezone || current.timezone
            : extracted.timezone || selectedTimezone || current.timezone,
          preparation_duration_minutes: extracted.preparation_duration_minutes ?? current.preparation_duration_minutes,
          travel_duration_minutes: extracted.travel_duration_minutes ?? current.travel_duration_minutes,
          origin_location: extracted.origin_description ? null : current.origin_location,
          location: extracted.destination_description ? null : current.location,
        }));
        const placeSearches = await Promise.allSettled([
          ...(extracted.origin_description ? [scheduleApi.searchLocations(extracted.origin_description, token, { signal: controller.signal }).then((response) => { if (mounted.current) setOriginResults(response.results); return { kind: "origin" as const, count: response.results.length }; })] : []),
          ...(extracted.destination_description ? [scheduleApi.searchLocations(extracted.destination_description, token, { signal: controller.signal }).then((response) => { if (mounted.current) setLocationResults(response.results); return { kind: "destination" as const, count: response.results.length }; })] : []),
        ]);
        if (!mounted.current) return;
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
      if (mounted.current && !isCancellation(error)) setExtractionError(messageFor(error));
    } finally {
      activeControllers.current.delete(controller);
      extractionInFlight.current = false;
      if (mounted.current) setExtracting(false);
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
      if (form.origin_location && form.location && (
        routeOptionsLoading || currentRouteOptions === null || routeOptionsError !== null ||
        currentRouteOptions.length === 0 || selectedRouteId === null
      )) return;
      autoSavePending.current = false;
      scheduleForm.current?.requestSubmit();
    } catch {
      // Keep the candidate in the form until the user resolves the invalid local time.
    }
  }, [form, extractionReview, editingId, timezoneConflictConfirmed, routeOptionsLoading, currentRouteOptions, routeOptionsError, selectedRouteId]);

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
    const controller = new AbortController();
    activeControllers.current.add(controller);
    try {
      const token = await getToken();
      const current = await scheduleApi.get(item.id, token, { signal: controller.signal });
      if (!mounted.current) return;
      setSelectedSchedule(current);
      setSchedules((items) => items.map((schedule) => schedule.id === current.id ? current : schedule));
    } catch (error) {
      if (!mounted.current || isCancellation(error)) return;
      setMessage({ kind: "error", text: messageFor(error) });
      if (error instanceof ScheduleApiError && error.status === 404) {
        setSchedules((items) => items.filter((schedule) => schedule.id !== item.id));
        setSelectedId(null);
        setSelectedSchedule(null);
        setView("list");
      }
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current) setDetailLoading(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || extractionInFlight.current || saving || extracting) return;
    setMessage(null);
    if (editingId === null && routeLocationsReady && !continueWithoutRoute.current) {
      if (routeOptionsLoading || currentRouteOptions === null) {
        setMessage({ kind: "info", text: "Loading driving routes. Choose one before saving." });
        return;
      }
      if (routeOptionsError || currentRouteOptions.length === 0) {
        setMessage({ kind: "error", text: routeOptionsError ?? "No driving routes are available. Retry route estimate or explicitly save without a route estimate." });
        return;
      }
      if (!selectedRouteId) {
        setMessage({ kind: "info", text: "Choose a driving route before saving this schedule." });
        return;
      }
    }
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

    const routeContextChanged = Boolean(editingId !== null && selectedSchedule && (
      JSON.stringify(form.origin_location) !== JSON.stringify(selectedSchedule.origin_location)
      || JSON.stringify(form.location) !== JSON.stringify(selectedSchedule.location)
      || form.time_intent !== selectedSchedule.time_intent
      || Date.parse(targetDateTime) !== Date.parse(selectedSchedule.target_datetime)
    ));
    const selectedRouteChanged = Boolean(editingId !== null && selectedRouteId
      && selectedRouteId !== selectedSchedule?.travel_estimate?.selected_route_id);
    if (editingId !== null && routeContextChanged && form.origin_location && form.location) {
      if (routeOptionsLoading || !currentRouteOptions?.some((route) => route.route_id === selectedRouteId)) {
        setMessage({ kind: "info", text: "Wait for the updated route options and choose one before saving." });
        return;
      }
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
      ...(selectedRouteId && !hasDefinitiveNoRoute && (editingId === null || (routeContextChanged && currentRouteOptions?.some((route) => route.route_id === selectedRouteId)) || (!routeContextChanged && selectedRouteChanged))
        ? { selected_route_id: selectedRouteId }
        : {}),
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
        ? await scheduleApi.create({ ...input, ...(continueWithoutRoute.current ? { continue_without_route: true } : {}), ...(hasDefinitiveNoRoute ? { route_outcome: "no_drivable_route" as const } : {}) }, token)
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
        setRouteNoRouteKey(JSON.stringify([form.origin_location, form.location]));
        setRouteOptions(null);
        setSelectedRouteId(null);
        setRouteOptionsError(null);
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
    if ((routeCooldowns[schedule.id] ?? 0) > currentTime) return;
    setRouteRefreshingId(schedule.id);
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setRouteCooldowns((value) => ({ ...value, [schedule.id]: currentTime + 60_000 }));
    setMessage(null);
    try {
      const token = await getToken();
      const refreshed = await scheduleApi.refreshTravelEstimate(schedule.id, token, { signal: controller.signal });
      if (!mounted.current) return;
      setSchedules((items) => items.map((item) => item.id === refreshed.id ? refreshed : item));
      setSelectedSchedule((item) => item?.id === refreshed.id ? refreshed : item);
      setMessage({ kind: "success", text: "Travel estimate refreshed." });
    } catch (error) {
      if (!mounted.current || isCancellation(error)) return;
      if (error instanceof ScheduleApiError && error.retryAfterSeconds !== null) {
        setRouteCooldowns((value) => ({ ...value, [schedule.id]: Date.now() + error.retryAfterSeconds! * 1000 }));
      }
      if (error instanceof ScheduleApiError && error.code === "no_drivable_route") {
        if (!schedule.travel_estimate) {
          const unavailable = { ...schedule, route_availability: "no_drivable_route" as const };
          setSchedules((items) => items.map((item) => item.id === schedule.id ? unavailable : item));
          setSelectedSchedule((item) => item?.id === schedule.id ? unavailable : item);
        }
        setMessage({ kind: "info", text: "No drivable route was found, so traffic could not be refreshed. You can assess weather separately." });
        return;
      }
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current) setRouteRefreshingId(null);
    }
  }

  async function refreshWeatherEstimate(schedule: Schedule) {
    if (weatherRefreshingId !== null) return;
    setWeatherRefreshingId(schedule.id);
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setMessage(null);
    try {
      const token = await getToken();
      const refreshed = await scheduleApi.refreshWeatherEstimate(schedule.id, token, { signal: controller.signal });
      if (!mounted.current) return;
      setSchedules((items) => items.map((item) => item.id === refreshed.id ? refreshed : item));
      setSelectedSchedule((item) => item?.id === refreshed.id ? refreshed : item);
      setMessage(refreshed.weather_estimate?.status === "available"
        ? { kind: "success", text: "Weather advisory refreshed." }
        : { kind: "info", text: refreshed.weather_estimate?.summary ?? "Weather forecast data is unavailable right now." });
    } catch (error) {
      if (!mounted.current || isCancellation(error)) return;
      setMessage({ kind: "error", text: messageFor(error) });
    } finally {
      activeControllers.current.delete(controller);
      if (mounted.current) setWeatherRefreshingId(null);
    }
  }

  const selected = selectedId === selectedSchedule?.id ? selectedSchedule : null;
  const savedRouteOptions = selected?.travel_estimate?.alternatives ?? [];
  const savedRouteId = selected?.travel_estimate?.selected_route_id ?? "0";
  const savedRouteOption = savedRouteOptions.find((route) => route.route_id === savedRouteId) ?? savedRouteOptions[0] ?? null;
  const savedRouteSet = useMemo(() => savedRouteOption ? [savedRouteOption] : [], [savedRouteOption]);
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <SavedPlacesPanel />
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
                <div className="grid gap-4 sm:grid-cols-2"><LocationPicker label="Origin" value={form.origin_location} savedPlaces={savedPlaces} query={originQuery} results={originResults} searching={originSearching} onQuery={(value) => { clearRouteUnavailableConfirmation(); setOriginQuery(value); setOriginResults([]); if (shouldInvalidateLocationSelection(form.origin_location, value)) { setRouteNoRouteKey(null); setForm((current) => ({ ...current, origin_location: null })); } }} onSearch={() => void searchOriginLocations()} onSelect={(origin_location) => { setRouteNoRouteKey(null); clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, origin_location })); setOriginQuery(origin_location.name); setOriginResults([]); }} onClear={() => { setRouteNoRouteKey(null); clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, origin_location: null })); setOriginResults([]); }} /><LocationPicker label="Destination" value={form.location} savedPlaces={savedPlaces} query={locationQuery} results={locationResults} searching={locationSearching} onQuery={(value) => { clearRouteUnavailableConfirmation(); setLocationQuery(value); setLocationResults([]); if (shouldInvalidateLocationSelection(form.location, value)) { setRouteNoRouteKey(null); setForm((current) => ({ ...current, location: null })); } }} onSearch={() => void searchLocations()} onSelect={(location) => { setRouteNoRouteKey(null); clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, location })); setLocationQuery(location.name); setLocationResults([]); }} onClear={() => { setRouteNoRouteKey(null); clearRouteUnavailableConfirmation(); setForm((current) => ({ ...current, location: null })); setLocationResults([]); }} /></div>
                {!routeLocationsReady && <p className="mt-2 text-sm text-[var(--text-muted)]">Add an origin and destination to calculate your driving route.</p>}
                {routeLocationsReady && !hasDefinitiveNoRoute && <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4" aria-label="Driving route selection"><h3 className="text-sm font-semibold">{editingId ? "Choose a route for this schedule" : "Choose a driving route before saving"}</h3>{!form.time_intent || !form.target_datetime ? <p className="mt-1 text-sm text-[var(--text-secondary)]">Set the target date, time, and arrival or departure intent to load traffic-aware routes.</p> : routeOptionsLoading ? <p className="mt-1 text-sm text-[var(--text-secondary)]" role="status">Finding driving routes…</p> : routeOptionsError && !currentRouteOptions?.length ? <div className="mt-2 text-sm text-[var(--state-error)]" role="alert"><p>{routeOptionsError}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => { setRouteOptionsError(null); setRouteSearchVersion((value) => value + 1); }}>Retry route estimate</button>{editingId === null && <button type="button" className={secondaryButton} onClick={() => { continueWithoutRoute.current = true; scheduleForm.current?.requestSubmit(); }}>Save without route estimate</button>}</div></div> : currentRouteOptions && currentRouteOptions.length > 0 ? <>{routeOptionsError && <p className="mb-3 text-sm text-[var(--state-warning)]" role="status">Could not retrieve the route estimate right now. The previous estimate remains available. <button type="button" className="font-semibold underline" onClick={() => { setRouteOptionsError(null); setRouteSearchVersion((value) => value + 1); }}>Retry route estimate</button></p>}<RouteComparisonMap routes={currentRouteOptions} selectedRouteId={selectedRouteId} origin={form.origin_location} destination={form.location} mode="compare"/><div className="mt-3 space-y-2">{currentRouteOptions.map((route, index) => <label key={route.route_id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"><input type="radio" name="editable-schedule-route" checked={selectedRouteId === route.route_id} onChange={() => setSelectedRouteId(route.route_id)} className="mt-1 accent-[var(--brand-primary)]"/><span><span className="font-medium">Route {index + 1}{selectedRouteId === route.route_id ? " · Selected" : ""}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{route.duration_minutes} min · {route.distance_meters === null ? "Distance unavailable" : `${(route.distance_meters / 1000).toFixed(1)} km`}{route.traffic_delay_seconds === null ? " · Traffic delay unavailable" : ` · ${Math.ceil(route.traffic_delay_seconds / 60)} min traffic delay`}</span>{route.road_names.length > 0 && <span className="mt-1 block text-xs text-[var(--text-muted)]">Via {route.road_names.join(" · ")}</span>}</span></label>)}</div></> : currentRouteOptions && currentRouteOptions.length === 0 ? <div className="mt-2 text-sm text-[var(--state-error)]"><p>No drivable routes were returned for these locations.</p>{editingId === null && <button type="button" className={`${secondaryButton} mt-2`} onClick={() => { continueWithoutRoute.current = true; scheduleForm.current?.requestSubmit(); }}>Save without route estimate</button>}</div> : <p className="mt-1 text-sm text-[var(--text-secondary)]">Routes will load when the schedule time and intent are set.</p>}</section>}
                {hasDefinitiveNoRoute && <div className="rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-4 text-sm text-[var(--state-warning)]" role="status"><p>We couldn’t find a drivable route between these locations. Check the locations or change them to try another route.</p><p className="mt-1">You can save without a route estimate or change either location.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => { continueWithoutRoute.current = true; scheduleForm.current?.requestSubmit(); }}>Save without route estimate</button><button type="button" className={secondaryButton} onClick={() => { setRouteNoRouteKey(null); setLocationQuery(form.location?.name ?? ""); setLocationResults([]); setForm((current) => ({ ...current, location: null })); }}>Change locations</button></div></div>}
                {showSplitTargetInputs ? <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium">Target date <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="date" required value={extractionDate} onChange={(event) => updateExtractionDate(event.target.value)} /></label>
                  <label className="block text-sm font-medium">Target local time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="time" required value={extractionTime} onChange={(event) => updateExtractionTime(event.target.value)} /></label>
                  <p className="text-xs text-[var(--text-muted)] sm:col-span-2">The date and time use the selected timezone and will be checked for daylight-saving gaps or repeats before saving.</p>
                </div> : <label className="block text-sm font-medium">Target date and time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="datetime-local" required value={form.target_datetime} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, target_datetime: e.target.value }); }} /></label>}
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Time intent <span className="text-[var(--state-error)]">*</span><select className={fieldClass} required value={form.time_intent} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, time_intent: e.target.value as ScheduleIntent | "" }); }}><option value="" disabled>Select arrival or departure</option><option value="arrival">Arrive by</option><option value="departure">Leave at</option></select></label><label className="block text-sm font-medium">Timezone<select className={fieldClass} required value={form.timezone} onChange={(e) => { clearRouteUnavailableConfirmation(); setForm({ ...form, timezone: e.target.value }); setTimezoneConflictConfirmed(false); }}>{Array.from(new Set([form.timezone, ...supportedTimeZones])).sort().map((timezone) => <option key={timezone} value={timezone}>{timezoneLabel(timezone)}</option>)}</select><span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">The target time is interpreted in this timezone.</span></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Preparation <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.preparation_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, preparation_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label><label className="block text-sm font-medium">Travel duration <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.travel_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, travel_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
                {routeUnavailableConfirmation && !hasDefinitiveNoRoute && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-4 text-sm text-[var(--state-warning)]" role="alert"><p className="font-semibold">No drivable route found</p><p className="mt-1">TomTom could not find a drivable route between these locations. A traffic estimate will be unavailable, but weather can be assessed separately. Do you want to save anyway?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={saving} onClick={() => { continueWithoutRoute.current = true; setRouteUnavailableConfirmation(false); scheduleForm.current?.requestSubmit(); }}>Save without route estimate</button><button type="button" className={secondaryButton} onClick={() => { clearRouteUnavailableConfirmation(); }}>Review locations</button></div></div>}
              </div><div className="mt-6 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:justify-end"><button type="button" className={secondaryButton} disabled={saving || extracting} onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>Discard</button><button type="submit" className={primaryButton} disabled={saving || extracting || (editingId === null && routeLocationsReady && (!currentRouteOptions?.some((route) => route.route_id === selectedRouteId) || routeOptionsLoading))}>{saving ? "Saving..." : <><CheckIcon /> {editingId ? "Save changes" : extractionReview?.extraction ? "Save reviewed schedule" : "Add schedule"}</>}</button></div></form> : selected ? <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULE DETAILS</p><h2 className="mt-1 text-xl font-bold leading-snug">{selected.title}</h2></div><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${selected.status === "active" ? "bg-[var(--state-success-bg)] text-[var(--state-success)]" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{selected.status}</span></div>
              {detailLoading ? <p className="mt-4 text-sm text-[var(--text-muted)]" role="status">Refreshing schedule details...</p> : null}
              {showPastScheduleNotices(selected.is_past) && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status"><p className="font-semibold">{PAST_SCHEDULE_BANNER_TITLE}</p><p className="mt-1">Live traffic and future weather advisories no longer apply to this intended trip. The schedule remains editable and can be cancelled.</p></div>}
              {showPostDepartureRouteWarning(selected.is_past, selected.route_warning) && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status"><p>{selected.route_warning}</p>{selected.travel_estimate && <p className="mt-1 text-xs">Retrieved {formatDate(selected.travel_estimate.retrieved_at, selected.timezone, true)}; intended departure {formatDate(selected.calculated_departure_time ?? selected.target_datetime, selected.timezone, true)}.</p>}</div>}
              {selected.travel_estimate && showStaleEstimateWarning(selected.is_past, selected.travel_estimate.retrieved_at, clockNow) && <p className="mt-3 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status">This estimate was retrieved over 15 minutes ago; its traffic information may be out of date.</p>}
              {(selected.origin_location || selected.location) && <div className="mt-5 grid gap-3 sm:grid-cols-2">{([["Origin", selected.origin_location], ["Destination", selected.location]] as const).map(([label, place]) => <div key={label} className="rounded-xl border border-[var(--border)] p-4"><h3 className="text-sm font-semibold">{label}</h3>{place ? <><p className="mt-1 font-medium">{place.name}</p><p className="text-sm text-[var(--text-secondary)]">{[place.locality, place.region, place.country].filter(Boolean).join(", ")}</p></> : <p className="mt-1 text-sm text-[var(--text-muted)]">Select a location to see its forecast.</p>}</div>)}</div>}
              <div className="mt-6 rounded-xl bg-[var(--surface-secondary)] p-4"><p className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]"><CalendarIcon /> Target {selected.time_intent}</p><p className="mt-2 text-lg font-semibold tabular-nums">{formatDate(selected.target_datetime, selected.timezone)}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{selected.timezone}</p></div>
              <dl className="mt-5 divide-y divide-[var(--border)]"><DetailRow label="Time intent" value={selected.time_intent === "arrival" ? "Arrive by" : "Leave at"} /><DetailRow label="Preparation" value={selected.preparation_duration_minutes === null ? "Not provided" : `${selected.preparation_duration_minutes} minutes`} /><DetailRow label="Travel duration" value={selected.travel_duration_minutes === null ? (selected.origin_location && selected.location ? "Unavailable" : "Select an origin and destination") : `${selected.travel_duration_minutes} minutes`} /><DetailRow label="Description" value={selected.description || "No additional notes"} /></dl>
              {!hasRouteLocations(selected.origin_location, selected.location) && <p className="mt-4 text-sm text-[var(--text-muted)]">Add an origin and destination to calculate your driving route.</p>}
              {selected.route_availability === "no_drivable_route" && <p className="mt-4 rounded-xl border border-[var(--state-warning)]/30 bg-[var(--state-warning-bg)] p-3 text-sm text-[var(--state-warning)]" role="status">We couldn’t find a drivable route between these locations. Check the locations or change them to try another route.</p>}
              {showTravelTrafficCard(selected.is_past, Boolean(selected.travel_estimate), hasRouteLocations(selected.origin_location, selected.location)) && <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Travel and traffic estimate">
                <h3 className="text-sm font-semibold">Travel and traffic</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums">{selected.travel_duration_minutes === null ? (selected.route_availability === "no_drivable_route" ? "No drivable route found" : "Route estimate unavailable") : `${selected.travel_duration_minutes} min`}</p>
                {selected.travel_estimate && <>
                  {selected.travel_estimate && savedRouteOption && <section className="mt-3 rounded-lg border border-[var(--border)] p-3" aria-label="Saved selected route"><h3 className="text-sm font-semibold">Selected driving route</h3><RouteComparisonMap routes={savedRouteSet} selectedRouteId={savedRouteOption.route_id} origin={selected.origin_location} destination={selected.location} mode="view"/><p className="mt-3 text-sm font-medium">Route {savedRouteOptions.findIndex((route) => route.route_id === savedRouteOption.route_id) + 1} · {savedRouteOption.duration_minutes} min · {savedRouteOption.distance_meters === null ? "Distance unavailable" : `${(savedRouteOption.distance_meters / 1000).toFixed(1)} km`}</p>{savedRouteOption.road_names.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Via {savedRouteOption.road_names.join(" · ")}</p>}</section>}
                  {showPastScheduleNotices(selected.is_past) && <p className="mt-2 rounded-lg bg-[var(--surface-secondary)] p-3 text-sm text-[var(--text-secondary)]">{historicalEstimateNotice(formatDate(selected.travel_estimate.retrieved_at, selected.timezone, true))}</p>}
                  <p className="mt-1 text-sm font-semibold">{trafficStatusLabel(selected.traffic_status)}</p>
                  {selected.traffic_delay_minutes !== null && <p className="mt-1 text-sm text-[var(--text-secondary)]">Estimated route-level traffic delay: {selected.traffic_delay_minutes} min</p>}
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{routeTimeBasisLabel(selected.travel_estimate.route_time_basis)}. Retrieved {formatDate(selected.travel_estimate.retrieved_at, selected.timezone)}.</p>
                  <div className="mt-3 border-t border-[var(--border)] pt-3"><h4 className="text-sm font-semibold">Traffic along your route</h4>{selected.travel_estimate.traffic_sections.length > 0 ? <><div className="mt-2 space-y-3">{groupTrafficSections(selected.travel_estimate.traffic_sections).map((group: TrafficRoadGroup) => <section key={group.identity} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold">{group.road_name}</h5>{group.is_approximate_location && <span className="rounded-full border border-[var(--border)] bg-[var(--surface-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">Approximate location</span>}</div>{group.route_designations.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Route designations: {group.route_designations.join(" · ")}</p>}<p className="mt-2 text-sm text-[var(--text-secondary)]"><span className="font-medium">{group.incident_count} {group.incident_count === 1 ? "incident" : "incidents"}</span> · {group.incident_type_counts.map(({ label, count }) => `${count} ${label.toLocaleLowerCase()}`).join(" · ")}</p><p className="mt-1 text-sm text-[var(--text-secondary)]"><span className="font-medium">Combined reported incident delays:</span> {group.delay_total_complete ? formatTrafficDelay(group.combined_delay_seconds) : `Incomplete (${group.unavailable_delay_count} incident ${group.unavailable_delay_count === 1 ? "delay is" : "delays are"} unavailable${group.known_delay_seconds > 0 ? `; known reports total ${formatTrafficDelay(group.known_delay_seconds)}` : ""})`}</p><details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-[var(--brand-primary)]">Incident details ({group.incident_count})</summary><ul className="mt-2 space-y-2">{group.events.map((section: TrafficSectionEstimate, index: number) => { const details = trafficIncidentDetails(section, group); return details ? <li key={index} className="border-t border-[var(--border)] pt-2 text-sm"><p className="font-medium text-[var(--text-secondary)]">{details.incident_type_label}</p>{details.location_label && <p className="mt-1 text-[var(--text-secondary)]">{details.location_label}</p>}<p className="mt-1 text-[var(--text-secondary)]">Reported incident delay: {details.reported_delay_label}</p></li> : null; })}</ul></details></section>)}</div><p className="mt-2 text-xs text-[var(--text-muted)]">Combined reported incident delays are provider incident figures. They do not represent additional travel time or a breakdown of the route-level traffic delay. Locations marked approximate are nearby reverse-geocoding results and do not confirm the affected road.</p></> : <p className="mt-1 text-sm text-[var(--text-muted)]">TomTom reported no traffic-affected portions for this estimate.</p>}</div>
                </>}
                {!selected.travel_estimate && <p className="mt-1 text-sm text-[var(--text-muted)]">{selected.is_past ? "A useful estimate for this past trip is unavailable." : "Traffic and travel time are unavailable until a route estimate is returned."}</p>}
              </section>}
              {selected.status === "active" && (selected.origin_location || selected.location) && <div className="mt-3 flex flex-wrap items-center gap-3">{!selected.is_past ? <>{selected.origin_location && selected.location && selected.route_availability !== "no_drivable_route" && <button type="button" className={secondaryButton} disabled={routeRefreshingId !== null || weatherRefreshingId !== null || (Boolean(selected.travel_estimate) && (routeCooldowns[selected.id] ?? 0) > clockNow)} onClick={() => void refreshRouteEstimate(selected)}><RefreshIcon />{routeRefreshingId === selected.id ? "Refreshing route..." : selected.travel_estimate ? "Refresh route estimate" : "Get route estimate"}</button>}<button type="button" className={secondaryButton} disabled={routeRefreshingId !== null || weatherRefreshingId !== null} onClick={() => void refreshWeatherEstimate(selected)}><RefreshIcon />{weatherRefreshingId === selected.id ? "Refreshing weather..." : "Refresh weather advisory"}</button></> : <span className="text-xs text-[var(--text-muted)]">This past schedule is read-only. Route and weather refreshes are unavailable.</span>}</div>}
              {!hasWeatherLocation(selected.origin_location, selected.location) && <p className="mt-4 text-sm text-[var(--text-muted)]">Add an origin or destination to see a weather forecast.</p>}
              {hasWeatherLocation(selected.origin_location, selected.location) && <section className={`mt-4 rounded-xl border p-4 ${hasWeatherAdvisory ? "border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)]" : "border-[var(--border)] bg-[var(--surface)]"}`} aria-label="Weather advisory">
                <h3 className="text-sm font-semibold">Weather advisory</h3>
                {selected.is_past && <p className="mt-2 text-sm text-[var(--text-muted)]">Future weather advisories are no longer applicable to this past trip.</p>}
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{selected.weather_estimate ? selected.weather_estimate.summary : "Weather information is temporarily unavailable."}</p>
                {selected.weather_estimate?.status === "available" && selected.weather_estimate.advisories.map((advisory, index) => <p className="mt-2 text-sm font-medium text-[var(--state-warning)]" key={`${advisory.endpoint}-${advisory.condition}-${index}`}>{advisory.condition} is forecast near your {advisory.endpoint} around {formatDate(advisory.forecast_at, selected.timezone)} and may affect your trip.</p>)}
                <p className="mt-1 text-xs text-[var(--text-muted)]">Forecast conditions, not current observations. Forecasts cover the selected route endpoints, not every location along the route. Weather advisories are separate from the route duration and traffic delay.</p>
                {selected.weather_estimate?.status === "available" && selected.travel_duration_minutes === null && <p className="mt-1 text-xs text-[var(--text-muted)]">No travel duration is known, so these are endpoint weather snapshots near the scheduled event time, not forecasts timed to estimated departure and arrival.</p>}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {([ ["Origin", selected.weather_estimate?.origin_weather, originWeatherForecastAt], ["Destination", selected.weather_estimate?.destination_weather, destinationWeatherForecastAt] ] as const).filter(([label]) => label === "Origin" ? Boolean(selected.origin_location) : Boolean(selected.location)).map(([label, forecast, forecastAt]) => <div key={label} className="rounded-lg border border-[var(--border)] p-3">
                    <h4 className="text-xs font-semibold">{label} forecast</h4>
                    <p className="mt-1 text-sm font-medium">{forecast?.condition ?? (label === "Origin" ? selected.weather_estimate?.origin_message : selected.weather_estimate?.destination_message) ?? "Forecast unavailable"}</p>
                    {forecastAt && <p className="mt-1 text-xs text-[var(--text-muted)]">Forecast for {formatDate(forecastAt, selected.timezone)}</p>}
                    {selected.weather_estimate?.status === "available" && forecast && <p className="mt-1 text-xs text-[var(--text-secondary)]">Precipitation {forecast.precipitation_mm.toFixed(1)} mm · Snow {forecast.snowfall_cm.toFixed(1)} cm · Wind {forecast.wind_speed_kmh.toFixed(0)} km/h</p>}
                  </div>)}
                </div>
                {selected.weather_estimate?.retrieved_at && <p className="mt-2 text-xs text-[var(--text-muted)]">Forecast data retrieved {formatDate(selected.weather_estimate.retrieved_at, selected.timezone)}.</p>}
              </section>}
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

function LocationPicker({ label, value, savedPlaces, query, results, searching, onQuery, onSearch, onSelect, onClear }: { label: string; value: LocationSelection | null; savedPlaces: SavedPlace[]; query: string; results: LocationSelection[]; searching: boolean; onQuery: (value: string) => void; onSearch: () => void; onSelect: (value: LocationSelection) => void; onClear: () => void }) {
  return <fieldset className="rounded-xl border border-[var(--border)] p-4"><legend className="px-1 text-sm font-semibold">{label} <span className="font-normal text-[var(--text-muted)]">(optional)</span></legend><p className="text-xs text-[var(--text-muted)]">Choose a saved place or search and explicitly choose a location; routing needs both places.</p>{value ? <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-[var(--surface-secondary)] p-3"><div><p className="font-medium">{value.name}</p><p className="text-sm text-[var(--text-secondary)]">{[value.locality, value.region, value.country].filter(Boolean).join(", ")}</p></div><button type="button" className={secondaryButton} onClick={onClear}>Change</button></div> : <>{savedPlaces.length > 0 && <label className="mt-3 block text-xs font-medium">Use saved place<select className={fieldClass} defaultValue="" onChange={(event) => { const place = savedPlaces.find((item) => item.id === Number(event.target.value)); if (place) onSelect(savedPlaceLocation(place)); }}><option value="">Choose a saved place…</option>{savedPlaces.map((place) => <option key={place.id} value={place.id}>{place.alias} — {place.display_name}</option>)}</select></label>}<div className="mt-3 flex gap-2"><input aria-label={`Search ${label.toLowerCase()}`} className={fieldClass} value={query} maxLength={200} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }} placeholder="School, home, business, or address"/><button type="button" className={secondaryButton} disabled={searching || query.trim().length < 2} onClick={onSearch}>{searching ? "Searching..." : "Search"}</button></div>{results.length > 0 && <ul className="mt-3 space-y-2" aria-label={`${label} search results`}>{results.map((place, index) => <li key={`${place.latitude}:${place.longitude}:${index}`}><button type="button" className="w-full rounded-lg border border-[var(--border)] p-3 text-left hover:bg-[var(--surface-hover)]" onClick={() => onSelect(place)}><span className="block font-medium">{place.name}</span><span className="block text-sm text-[var(--text-secondary)]">{[place.locality, place.region, place.country].filter(Boolean).join(", ")}</span></button></li>)}</ul>}</>}</fieldset>;
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[minmax(100px,0.7fr)_1.3fr] gap-3 py-3 text-sm"><dt className="text-[var(--text-muted)]">{label}</dt><dd className="break-words font-medium capitalize text-[var(--text-primary)]">{value}</dd></div>; }
function CalendarIcon() { return <CalendarDays aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />; }
function ClockIcon() { return <Clock3 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />; }
function PlusIcon() { return <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />; }
function CheckIcon() { return <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2} />; }
function PencilIcon() { return <Pencil aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />; }
function CloseIcon() { return <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />; }
function RefreshIcon() { return <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />; }
