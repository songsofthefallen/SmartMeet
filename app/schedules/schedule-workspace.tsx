"use client";

import { UserButton } from "@clerk/nextjs";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Intent = "arrival" | "departure";
type Status = "active" | "cancelled" | "completed";
type Schedule = {
  id: number;
  title: string;
  description: string;
  time_intent: Intent;
  target_datetime: string;
  timezone: string;
  preparation_duration_minutes: number;
  travel_duration_minutes: number | null;
  status: Status;
};
type FormValues = Omit<Schedule, "id" | "status">;

const initialSchedules: Schedule[] = [
  { id: 1, title: "Team planning meeting", description: "Bring the project notes and latest timeline.", time_intent: "arrival", target_datetime: "2026-10-12T09:30", timezone: "Asia/Manila", preparation_duration_minutes: 45, travel_duration_minutes: 35, status: "active" },
  { id: 2, title: "Pick up groceries", description: "", time_intent: "departure", target_datetime: "2026-10-13T17:15", timezone: "Asia/Manila", preparation_duration_minutes: 30, travel_duration_minutes: null, status: "active" },
  { id: 3, title: "Dentist appointment", description: "Routine check-up", time_intent: "arrival", target_datetime: "2026-10-15T14:00", timezone: "Asia/Manila", preparation_duration_minutes: 40, travel_duration_minutes: 25, status: "active" },
];

const blankForm = (): FormValues => ({ title: "", description: "", time_intent: "arrival", target_datetime: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila", preparation_duration_minutes: 30, travel_duration_minutes: null });
const fieldClass = "mt-1.5 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-subtle)]";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]";

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

export default function ScheduleWorkspace() {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [selectedId, setSelectedId] = useState<number | null>(initialSchedules[0]?.id ?? null);
  const [view, setView] = useState<"list" | "detail" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const selected = useMemo(() => schedules.find((item) => item.id === selectedId) ?? null, [schedules, selectedId]);
  const activeSchedules = schedules.filter((item) => item.status === "active").sort((a, b) => a.target_datetime.localeCompare(b.target_datetime));

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 250);
    return () => window.clearTimeout(timer);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(blankForm());
    setMessage(null);
    setView("form");
  }
  function openEdit(item: Schedule) {
    setEditingId(item.id);
    setForm({ title: item.title, description: item.description, time_intent: item.time_intent, target_datetime: item.target_datetime, timezone: item.timezone, preparation_duration_minutes: item.preparation_duration_minutes, travel_duration_minutes: item.travel_duration_minutes });
    setMessage(null);
    setView("form");
  }
  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new Date(form.target_datetime);
    if (!form.title.trim() || !form.target_datetime || Number.isNaN(date.getTime()) || form.preparation_duration_minutes < 0 || (form.travel_duration_minutes !== null && form.travel_duration_minutes < 0)) {
      setMessage({ kind: "error", text: "Check the required fields and enter valid, nonnegative durations." });
      return;
    }
    const normalized = { ...form, title: form.title.trim(), description: form.description.trim(), target_datetime: date.toISOString() };
    if (editingId !== null) {
      setSchedules((items) => items.map((item) => item.id === editingId ? { ...item, ...normalized } : item));
      setSelectedId(editingId);
      setMessage({ kind: "success", text: "Changes updated in this temporary demo." });
    } else {
      const id = Math.max(0, ...schedules.map((item) => item.id)) + 1;
      setSchedules((items) => [...items, { ...normalized, id, status: "active" }]);
      setSelectedId(id);
      setMessage({ kind: "success", text: "Schedule added to this temporary demo." });
    }
    setView("detail");
  }
  function cancelSchedule() {
    if (!selected) return;
    setSchedules((items) => items.map((item) => item.id === selected.id ? { ...item, status: "cancelled" } : item));
    setConfirmCancel(false);
    setMessage({ kind: "success", text: "Schedule cancelled in this temporary demo." });
  }

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
        <div className="mb-6 rounded-2xl border border-[var(--state-warning)]/20 bg-[var(--state-warning-bg)] px-4 py-3 text-sm text-[var(--state-warning)]" role="note">
          <strong>Demo mode:</strong> schedules are temporary mock data. Changes are kept in this page only and reset when you reload. Nothing is saved to an account.
        </div>
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULES</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Plan what’s next</h1><p className="mt-2 text-[var(--text-secondary)]">Keep your upcoming plans clear and easy to manage.</p></div>
          <button className={primaryButton} onClick={openCreate}><PlusIcon /> New schedule</button>
        </div>
        {message && <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${message.kind === "success" ? "border-[var(--state-success)]/20 bg-[var(--state-success-bg)] text-[var(--state-success)]" : "border-[var(--state-error)]/20 bg-[var(--state-error-bg)] text-[var(--state-error)]"}`} role={message.kind === "error" ? "alert" : "status"}><span className="font-bold" aria-hidden="true">{message.kind === "success" ? "✓" : "!"}</span><span>{message.text}</span><button className="ml-auto rounded px-2 font-semibold focus-visible:outline-2" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section aria-labelledby="upcoming-heading" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><h2 id="upcoming-heading" className="font-semibold">Upcoming schedules</h2><p className="mt-0.5 text-sm text-[var(--text-muted)]">{activeSchedules.length} active {activeSchedules.length === 1 ? "schedule" : "schedules"}</p></div><span className="rounded-lg bg-[var(--surface-secondary)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">Mock data</span></div>
            {loading ? <div className="space-y-3 p-5" aria-label="Loading schedules" role="status"><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-secondary)]"/><span className="sr-only">Loading schedules…</span></div> : activeSchedules.length === 0 ? <div className="px-6 py-14 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-subtle)] text-[var(--brand-primary)]"><CalendarIcon /></span><h3 className="mt-4 font-semibold">No upcoming schedules</h3><p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-muted)]">Add a schedule to see it here. Your changes will stay temporary in this demo.</p><button className={`${primaryButton} mt-5`} onClick={openCreate}><PlusIcon /> Add a schedule</button></div> : <ul className="divide-y divide-[var(--border)]">{activeSchedules.map((item) => <li key={item.id}><button onClick={() => { setSelectedId(item.id); setView("detail"); setConfirmCancel(false); }} className={`w-full p-5 text-left transition hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--brand-primary)] sm:px-6 ${selectedId === item.id && view === "detail" ? "bg-[var(--brand-subtle)]" : ""}`} aria-current={selectedId === item.id && view === "detail" ? "true" : undefined}><div className="flex items-start justify-between gap-4"><span className="min-w-0"><span className="block truncate font-semibold">{item.title}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{formatDate(item.target_datetime, item.timezone)}</span></span><span className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium capitalize text-[var(--text-secondary)]">{item.time_intent}</span></div><span className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]"><ClockIcon /> {item.timezone} <span aria-hidden="true">·</span><span className="capitalize">{item.status}</span></span></button></li>)}</ul>}
          </section>

          <section aria-label={view === "form" ? (editingId ? "Edit schedule" : "Create schedule") : "Schedule details"} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {view === "form" ? <form onSubmit={saveSchedule} className="p-5 sm:p-6"><div className="mb-6 flex items-start justify-between"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">{editingId ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</p><h2 className="mt-1 text-xl font-bold">{editingId ? "Update your plan" : "Create a schedule"}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Fields match the schedule data model.</p></div><button type="button" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" aria-label="Close form" onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>×</button></div>
              <div className="space-y-4"><label className="block text-sm font-medium">Title <span className="text-[var(--state-error)]">*</span><input className={fieldClass} required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Team planning meeting" /></label><label className="block text-sm font-medium">Description <span className="font-normal text-[var(--text-muted)]">(optional)</span><textarea className={fieldClass} rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Add notes for this schedule" /></label>
                <label className="block text-sm font-medium">Target date and time <span className="text-[var(--state-error)]">*</span><input className={fieldClass} type="datetime-local" required value={form.target_datetime.slice(0, 16)} onChange={(e) => setForm({ ...form, target_datetime: e.target.value })} /></label>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Time intent<select className={fieldClass} value={form.time_intent} onChange={(e) => setForm({ ...form, time_intent: e.target.value as Intent })}><option value="arrival">Arrival</option><option value="departure">Departure</option></select></label><label className="block text-sm font-medium">Timezone <input className={fieldClass} required maxLength={64} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Asia/Manila" /></label></div>
                <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Preparation (minutes)<input className={fieldClass} type="number" min="0" step="1" required value={form.preparation_duration_minutes} onChange={(e) => setForm({ ...form, preparation_duration_minutes: Number(e.target.value) })} /></label><label className="block text-sm font-medium">Travel duration <span className="font-normal text-[var(--text-muted)]">(optional, minutes)</span><input className={fieldClass} type="number" min="0" step="1" value={form.travel_duration_minutes ?? ""} onChange={(e) => setForm({ ...form, travel_duration_minutes: e.target.value === "" ? null : Number(e.target.value) })} /></label></div>
              </div><div className="mt-6 flex flex-col-reverse gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:justify-end"><button type="button" className={secondaryButton} onClick={() => { setView(selected ? "detail" : "list"); setMessage(null); }}>Discard</button><button type="submit" className={primaryButton}><CheckIcon /> {editingId ? "Save changes" : "Add schedule"}</button></div></form> : selected ? <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--brand-primary)]">SCHEDULE DETAILS</p><h2 className="mt-1 text-xl font-bold leading-snug">{selected.title}</h2></div><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${selected.status === "active" ? "bg-[var(--state-success-bg)] text-[var(--state-success)]" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{selected.status}</span></div>
              <div className="mt-6 rounded-xl bg-[var(--surface-secondary)] p-4"><p className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)]"><CalendarIcon /> Target {selected.time_intent}</p><p className="mt-2 text-lg font-semibold tabular-nums">{formatDate(selected.target_datetime, selected.timezone)}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{selected.timezone}</p></div>
              <dl className="mt-5 divide-y divide-[var(--border)]"><DetailRow label="Time intent" value={selected.time_intent} /><DetailRow label="Preparation" value={`${selected.preparation_duration_minutes} minutes`} /><DetailRow label="Travel duration" value={selected.travel_duration_minutes === null ? "Not provided" : `${selected.travel_duration_minutes} minutes (mock value)`} /><DetailRow label="Description" value={selected.description || "No additional notes"} /></dl>
              <p className="mt-4 rounded-xl border border-[var(--border)] px-3.5 py-3 text-xs leading-relaxed text-[var(--text-muted)]">Departure and wake-up estimates are not calculated in this demo.</p>
              {selected.status === "active" && <div className="mt-5 flex flex-wrap gap-3 border-t border-[var(--border)] pt-5"><button className={secondaryButton} onClick={() => openEdit(selected)}><PencilIcon /> Edit</button><button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--state-error)]/30 px-4 py-2 text-sm font-semibold text-[var(--state-error)] hover:bg-[var(--state-error-bg)] focus-visible:outline-2 focus-visible:outline-[var(--state-error)]" onClick={() => setConfirmCancel(true)}><CloseIcon /> Cancel schedule</button></div>}
              {confirmCancel && <div className="mt-4 rounded-xl border border-[var(--state-warning)]/25 bg-[var(--state-warning-bg)] p-4" role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-copy"><h3 id="cancel-title" className="font-semibold text-[var(--state-warning)]">Cancel this schedule?</h3><p id="cancel-copy" className="mt-1 text-sm text-[var(--text-secondary)]">It will be marked cancelled in this temporary demo.</p><div className="mt-3 flex gap-2"><button className="rounded-lg bg-[var(--state-error)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90" onClick={cancelSchedule}>Yes, cancel</button><button className={secondaryButton} onClick={() => setConfirmCancel(false)}>Keep schedule</button></div></div>}
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
