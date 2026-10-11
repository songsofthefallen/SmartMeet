"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { scheduleApi, ScheduleApiError, type Schedule, type ScheduleExtractionReview, type ScheduleInput, type ScheduleIntent } from "@/lib/schedule-api";
import { localDateTimeFromExtraction, localTimeInputFromExtraction } from "@/lib/schedule-extraction-time";

type FormValues = Omit<ScheduleInput, "target_datetime" | "time_intent" | "preparation_duration_minutes"> & { target_datetime: string; time_intent: ScheduleIntent | ""; preparation_duration_minutes: number | null };
type Notice = { kind: "success" | "error"; text: string };

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
});
const fieldClass = "mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-subtle)]";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
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

function clarificationQuestions(review: ScheduleExtractionReview, selectedTimezone: string): string[] {
  const questions: string[] = [];
  const missingQuestions: Record<string, string> = {
    title: "What should this schedule be called?",
    time_intent: "Is this time for arriving or leaving?",
    target_date_local: "What date should this schedule use?",
    target_time_local: "What local time should this schedule use?",
    timezone: "Which timezone should interpret the target time?",
    schedule_request: "What event or plan should be scheduled?",
  };
  for (const field of review.missing_fields) {
    if (missingQuestions[field]) questions.push(missingQuestions[field]);
  }
  if (review.ambiguous_fields.includes("time_intent") && !questions.includes(missingQuestions.time_intent)) {
    questions.push(missingQuestions.time_intent);
  }
  if (review.ambiguous_fields.includes("target_time_local")) {
    questions.push("This local time occurs twice. Choose a time outside the repeated hour.");
  }
  if (review.ambiguous_fields.includes("timezone")) {
    const modelTimezone = review.extraction?.timezone;
    questions.push(
      `The model identified ${modelTimezone ?? "a different timezone"}, while you selected ${selectedTimezone}. Confirm or change the timezone before saving.`,
    );
  }
  if (review.invalid_fields.includes("target_time_local")) {
    questions.push("That local time does not exist in this timezone. Choose another time.");
  }
  if (review.invalid_fields.includes("target_time_offset")) {
    questions.push("The extracted time offset does not match the selected timezone. Review the local time and timezone.");
  }
  if (review.invalid_fields.includes("target_date_local")) {
    questions.push("The extracted date is invalid. Enter a valid date.");
  }
  if (review.invalid_fields.includes("model_output")) {
    questions.push("The extracted response could not be validated. Retry extraction or enter the schedule manually.");
  }
  if (review.invalid_fields.includes("title")) questions.push("Enter a valid schedule title.");
  if (review.invalid_fields.includes("time_intent")) questions.push("Select whether this is an arrival or departure time.");
  if (review.invalid_fields.includes("timezone")) questions.push("Select a valid timezone for this schedule.");
  if (review.invalid_fields.some((field) => !["model_output", "title", "time_intent", "timezone", "target_date_local", "target_time_local", "target_time_offset"].includes(field))) {
    questions.push("Some extracted values could not be validated. Review and correct the schedule fields below.");
  }
  questions.push(...(review.extraction?.ambiguities ?? []));
  return [...new Set(questions)];
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
  const [message, setMessage] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const activeSchedules = useMemo(
    () => schedules.filter((item) => item.status === "active").sort((a, b) => Date.parse(a.target_datetime) - Date.parse(b.target_datetime)),
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

  function openCreate() {
    setEditingId(null);
    setForm(blankForm());
    setMessage(null);
    setConfirmCancel(false);
    setExtractionText("");
    setExtractionReview(null);
    setExtractionError(null);
    setExtractionDate("");
    setExtractionTime("");
    setTimezoneConflictConfirmed(false);
    setView("form");
  }

  function openEdit(item: Schedule) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description ?? "",
      time_intent: item.time_intent,
      target_datetime: toLocalDateTime(item.target_datetime, item.timezone),
      timezone: item.timezone,
      preparation_duration_minutes: item.preparation_duration_minutes,
      travel_duration_minutes: item.travel_duration_minutes,
    });
    setMessage(null);
    setExtractionText("");
    setExtractionReview(null);
    setExtractionError(null);
    setExtractionDate("");
    setExtractionTime("");
    setTimezoneConflictConfirmed(false);
    setView("form");
  }

  async function extractSchedule() {
    if (extractionInFlight.current || saveInFlight.current || !extractionText.trim() || saving) return;
    extractionInFlight.current = true;
    setExtracting(true);
    setExtractionError(null);
    setExtractionReview(null);
    setMessage(null);
    try {
      const token = await getToken();
      const selectedTimezone = form.timezone.trim();
      const review = await scheduleApi.extract(extractionText, selectedTimezone || null, token);
      setExtractionReview(review);
      setTimezoneConflictConfirmed(!review.ambiguous_fields.includes("timezone"));
      const extracted = review.extraction;
      if (extracted) {
        const completeTarget = localDateTimeFromExtraction(extracted.target_date_local, extracted.target_time_local);
        const currentParts = form.target_datetime.split("T");
        const nextDate = extracted.target_date_local ?? currentParts[0] ?? "";
        const nextTime = localTimeInputFromExtraction(extracted.target_time_local) ?? currentParts[1] ?? "";
        setExtractionDate(nextDate);
        setExtractionTime(nextTime);
        setForm((current) => ({
          ...current,
          title: extracted.title ?? current.title,
          description: current.description?.trim() ? current.description : extractionText.trim(),
          time_intent: extracted.time_intent ?? current.time_intent,
          target_datetime: completeTarget ?? current.target_datetime,
          timezone: selectedTimezone || extracted.timezone || current.timezone,
          preparation_duration_minutes: extracted.preparation_duration_minutes ?? current.preparation_duration_minutes,
          travel_duration_minutes: extracted.travel_duration_minutes ?? current.travel_duration_minutes,
        }));
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

  function updateExtractionDate(value: string) {
    setExtractionDate(value);
    if (value && extractionTime) {
      setForm((current) => ({ ...current, target_datetime: `${value}T${extractionTime.slice(0, 5)}` }));
    }
  }

  function updateExtractionTime(value: string) {
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
    if (!form.title.trim() || (form.preparation_duration_minutes !== null && (!Number.isInteger(form.preparation_duration_minutes) || form.preparation_duration_minutes < 0)) || (form.travel_duration_minutes !== null && (!Number.isInteger(form.travel_duration_minutes) || form.travel_duration_minutes < 0))) {
      setMessage({ kind: "error", text: "Enter a title and valid nonnegative whole-minute durations when provided." });
      return;
    }

    const input: ScheduleInput = {
      ...form,
      title: form.title.trim(),
      description: form.description?.trim() || null,
      time_intent: form.time_intent as ScheduleIntent,
      timezone: form.timezone.trim(),
      target_datetime: targetDateTime,
    };
    saveInFlight.current = true;
    setSaving(true);
    try {
      const token = await getToken();
      const saved = editingId === null
        ? await scheduleApi.create(input, token)
        : await scheduleApi.update(editingId, input, token);
      setLoadError(false);
      setSchedules((items) => editingId === null
        ? [...items, saved]
        : items.map((item) => item.id === saved.id ? saved : item));
      setSelectedId(saved.id);
      setSelectedSchedule(saved);
      setConfirmCancel(false);
      setView("detail");
      setMessage({ kind: "success", text: editingId === null ? "Schedule saved." : "Schedule updated." });
      setEditingId(null);
    } catch (error) {
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

  const selected = selectedId === selectedSchedule?.id ? selectedSchedule : null;
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
        {message && <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${message.kind === "success" ? "border-[var(--state-success)]/20 bg-[var(--state-success-bg)] text-[var(--state-success)]" : "border-[var(--state-error)]/20 bg-[var(--state-error-bg)] text-[var(--state-error)]"}`} role={message.kind === "error" ? "alert" : "status"}><span className="font-bold" aria-hidden="true">{message.kind === "success" ? "✓" : "!"}</span><span>{message.text}</span><button className="ml-auto rounded px-2 font-semibold focus-visible:outline-2" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section aria-labelledby="upcoming-heading" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><h2 id="upcoming-heading" className="font-semibold">Upcoming schedules</h2><p className="mt-0.5 text-sm text-[var(--text-muted)]">{activeSchedules.length} active {activeSchedules.length === 1 ? "schedule" : "schedules"}</p></div><button className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-subtle)] disabled:opacity-60" onClick={refreshSchedules} disabled={loading} aria-label="Refresh schedules">Refresh</button></div>
            {loading ? <div className="space-y-3 p-5" aria-label="Loading schedules" role="status"><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><span className="sr-only">Loading schedules...</span></div> : loadError ? <div className="px-6 py-14 text-center"><h3 className="font-semibold">Schedules couldn&apos;t be loaded</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Resolve the service or session error above, then try again.</p><button className={`${primaryButton} mt-5`} onClick={refreshSchedules}><RefreshIcon /> Try again</button></div> : activeSchedules.length === 0 ? <div className="px-6 py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-subtle)] text-[var(--brand-primary)]"><CalendarIcon /></span><h3 className="mt-4 font-semibold">{schedules.length ? "No active schedules" : "No upcoming schedules"}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-muted)]">{schedules.length ? "Create a new schedule to plan what's next." : "Add a schedule to see it here."}</p><button className={`${primaryButton} mt-5`} onClick={openCreate}><PlusIcon /> Add a schedule</button></div> : <ul className="divide-y divide-[var(--border)]">{activeSchedules.map((item) => <li key={item.id}><button onClick={() => void selectSchedule(item)} className={`w-full p-5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--brand-primary)] sm:px-6 ${selectedId === item.id && view === "detail" ? "bg-[var(--brand-subtle)]" : ""}`} aria-current={selectedId === item.id && view === "detail" ? "true" : undefined}><div className="flex items-start justify-between gap-4"><span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{formatDate(item.target_datetime, item.timezone)}</span></span><span className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">{item.time_intent === "arrival" ? "Arrive by" : "Leave at"}</span></div><span className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClockIcon /> {item.timezone} <span aria-hidden="true">·</span><span className="capitalize">{item.status}</span></span></button></li>)}</ul>}
          </section>

          <section aria-label={view === "form" ? (editingId ? "Edit schedule" : "Create schedule") : "Schedule details"} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {view === "form" ? <form onSubmit={(event) => void saveSchedule(event)} className="p-5 sm:p-6"><div className="mb-6 flex items-start justify-between"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">{editingId ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</p><h2 className="mt-1 text-xl font-bold">{editingId ? "Update your plan" : "Create a schedule"}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Changes are saved to your account after the API confirms them.</p></div><button type="button" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" aria-label="Close form" onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>×</button></div>
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
                    {extractionReview.ambiguous_fields.includes("timezone") && <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={timezoneConflictConfirmed} onChange={(event) => setTimezoneConflictConfirmed(event.target.checked)} /><span>I confirm that {form.timezone} should interpret the target time.</span></label>}
                    {extractionReview.extraction && <p className="mt-2 text-xs">Known values are filled into the editable form. Nothing has been saved.</p>}
                    {!extractionReview.extraction && <p className="mt-2 text-xs">Retry extraction or complete the form manually. Nothing has been saved.</p>}
                  </div>}
                </section>}
                <label className="block text-sm font-medium">Title <span className="text-[var(--state-error)]">*</span><input className={fieldClass} required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Team planning meeting" /></label><label className="block text-sm font-medium">Description <span className="font-normal text-[var(--text-muted)]">(optional)</span><textarea className={fieldClass} rows={3} maxLength={4000} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Add notes for this schedule" /></label>
                {showSplitTargetInputs ? <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium">Target date <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="date" required value={extractionDate} onChange={(event) => updateExtractionDate(event.target.value)} /></label>
                  <label className="block text-sm font-medium">Target local time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="time" required value={extractionTime} onChange={(event) => updateExtractionTime(event.target.value)} /></label>
                  <p className="text-xs text-[var(--text-muted)] sm:col-span-2">The date and time use the selected timezone and will be checked for daylight-saving gaps or repeats before saving.</p>
                </div> : <label className="block text-sm font-medium">Target date and time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="datetime-local" required value={form.target_datetime} onChange={(e) => setForm({ ...form, target_datetime: e.target.value })} /></label>}
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Time intent <span className="text-[var(--state-error)]">*</span><select className={fieldClass} required value={form.time_intent} onChange={(e) => setForm({ ...form, time_intent: e.target.value as ScheduleIntent | "" })}><option value="" disabled>Select arrival or departure</option><option value="arrival">Arrive by</option><option value="departure">Leave at</option></select></label><label className="block text-sm font-medium">Timezone<select className={fieldClass} required value={form.timezone} onChange={(e) => { setForm({ ...form, timezone: e.target.value }); setTimezoneConflictConfirmed(false); }}>{Array.from(new Set([form.timezone, ...supportedTimeZones])).sort().map((timezone) => <option key={timezone} value={timezone}>{timezoneLabel(timezone)}</option>)}</select><span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">The target time is interpreted in this timezone.</span></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Preparation <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.preparation_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, preparation_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label><label className="block text-sm font-medium">Travel duration <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.travel_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, travel_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
              </div><div className="mt-6 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:justify-end"><button type="button" className={secondaryButton} disabled={saving || extracting} onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>Discard</button><button type="submit" className={primaryButton} disabled={saving || extracting}>{saving ? "Saving..." : <><CheckIcon /> {editingId ? "Save changes" : extractionReview?.extraction ? "Save reviewed schedule" : "Add schedule"}</>}</button></div></form> : selected ? <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULE DETAILS</p><h2 className="mt-1 text-xl font-bold leading-snug">{selected.title}</h2></div><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${selected.status === "active" ? "bg-[var(--state-success-bg)] text-[var(--state-success)]" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{selected.status}</span></div>
              {detailLoading ? <p className="mt-4 text-sm text-[var(--text-muted)]" role="status">Refreshing schedule details...</p> : null}
              <div className="mt-6 rounded-xl bg-[var(--surface-secondary)] p-4"><p className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]"><CalendarIcon /> Target {selected.time_intent}</p><p className="mt-2 text-lg font-semibold tabular-nums">{formatDate(selected.target_datetime, selected.timezone)}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{selected.timezone}</p></div>
              <dl className="mt-5 divide-y divide-[var(--border)]"><DetailRow label="Time intent" value={selected.time_intent === "arrival" ? "Arrive by" : "Leave at"} /><DetailRow label="Preparation" value={selected.preparation_duration_minutes === null ? "Not provided" : `${selected.preparation_duration_minutes} minutes`} /><DetailRow label="Travel duration" value={selected.travel_duration_minutes === null ? "Unknown" : `${selected.travel_duration_minutes} minutes`} /><DetailRow label="Description" value={selected.description || "No additional notes"} /></dl>
              <p className="mt-4 rounded-xl border border-[var(--border)] px-3.5 py-3 text-xs leading-relaxed text-[var(--text-muted)]">Departure and wake-up estimates are not calculated yet.</p>
              {selected.status === "active" && <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--border)] pt-5"><button className={secondaryButton} disabled={saving || detailLoading} onClick={() => openEdit(selected)}><PencilIcon /> Edit</button><button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--state-error)]/30 px-4 py-2 text-sm font-semibold text-[var(--state-error)] hover:bg-[var(--state-error-bg)] focus-visible:outline-2 focus-visible:outline-[var(--state-error)] disabled:opacity-60" disabled={saving || detailLoading} onClick={() => setConfirmCancel(true)}><CloseIcon /> Cancel schedule</button></div>}
              {confirmCancel && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)] p-4" role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-copy"><h3 id="cancel-title" className="font-semibold text-[var(--state-warning)]">Cancel this schedule?</h3><p id="cancel-copy" className="mt-1 text-sm text-[var(--text-secondary)]">It will be marked cancelled in your account.</p><div className="mt-3 flex gap-2"><button className="rounded-lg bg-[var(--state-error)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60" onClick={() => void cancelSchedule()} disabled={saving}>{saving ? "Cancelling..." : "Yes, cancel"}</button><button className={secondaryButton} onClick={() => setConfirmCancel(false)} disabled={saving}>Keep schedule</button></div></div>}
            </div> : <div className="px-6 py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--surface-secondary)] text-[var(--text-muted)]"><CalendarIcon /></span><h2 className="mt-4 font-semibold">Choose a schedule</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Select an item to see its details, or create a new schedule.</p></div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[minmax(100px,0.7fr)_1.3fr] gap-3 py-3 text-sm"><dt className="text-[var(--text-muted)]">{label}</dt><dd className="break-words font-medium capitalize text-[var(--text-primary)]">{value}</dd></div>; }
function CalendarIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9h17M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" strokeLinecap="round"/></svg>; }
function ClockIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PlusIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>; }
function CheckIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PencilIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function CloseIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round"/></svg>; }
function RefreshIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
