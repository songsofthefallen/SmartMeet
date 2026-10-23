import { createElement as h, type ReactElement } from "react";
import type { Schedule } from "../../lib/schedule-api";

export type NotificationPreviewContent = {
  title: string;
  body: string;
  eventName: string;
  destination: string | null;
  eventTime: string | null;
  timeLabel: string;
  preparationDuration: string | null;
  travelDuration: string | null;
  example: boolean;
};

function formatEventTime(value: string, timezone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const localDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timezone }).format(date);
  const localTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
  return `${localDate} at ${localTime}`;
}

function formatClock(value: string | null, timezone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
}

function shortText(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  let shortened = normalized.slice(0, limit - 1).trimEnd();
  const wordBoundary = shortened.lastIndexOf(" ");
  if (wordBoundary > limit / 2) shortened = shortened.slice(0, wordBoundary);
  return `${shortened}…`;
}

function destinationLabel(schedule: Schedule): string | null {
  const location = schedule.location;
  if (!location) return null;
  const parts = [location.name, location.locality, location.region]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const uniqueParts = [...new Set(parts)];
  return uniqueParts.length ? uniqueParts.join(", ") : null;
}

export function buildNotificationPreview(schedule: Schedule | null): NotificationPreviewContent {
  if (!schedule) {
    return {
      title: "Get ready: Team meeting",
      body: "Leave at 12:15 PM · Makati",
      eventName: "Team meeting",
      destination: "Makati",
      eventTime: "Oct 23 at 1:00 PM",
      timeLabel: "Event time",
      preparationDuration: "45 minutes",
      travelDuration: "30 minutes",
      example: true,
    };
  }

  const title = shortText(schedule.title.trim() || "your event", 48);
  const destination = destinationLabel(schedule);
  const isArrival = schedule.time_intent === "arrival";
  const eventValue = isArrival ? schedule.target_datetime : schedule.calculated_arrival_time;
  const calculatedEventTime = eventValue ? formatEventTime(eventValue, schedule.timezone) : null;
  const timeLabel = isArrival || calculatedEventTime ? "Event time" : "Departure time";
  const preparationDuration = schedule.preparation_duration_minutes === null
    ? null
    : `${schedule.preparation_duration_minutes} ${schedule.preparation_duration_minutes === 1 ? "minute" : "minutes"}`;
  const travelDuration = schedule.travel_duration_minutes === null
    ? null
    : `${schedule.travel_duration_minutes} ${schedule.travel_duration_minutes === 1 ? "minute" : "minutes"}`;
  const shortDestination = destination ? shortText(destination, 56) : null;
  const departureTime = formatClock(schedule.calculated_departure_time, schedule.timezone);
  const arrivalTime = formatClock(schedule.calculated_arrival_time, schedule.timezone)
    ?? (isArrival ? formatClock(schedule.target_datetime, schedule.timezone) : null);
  const bodyParts = [
    departureTime ? `Leave at ${departureTime}` : arrivalTime ? `Arrive by ${arrivalTime}` : null,
    shortDestination,
  ].filter((part): part is string => Boolean(part));
  const body = bodyParts.length ? bodyParts.join(" · ") : "Check your schedule for details";

  return {
    title: `Get ready: ${title}`,
    body,
    eventName: schedule.title.trim() || "Not set",
    destination,
    eventTime: calculatedEventTime ?? (schedule.time_intent === "departure"
      ? formatEventTime(schedule.target_datetime, schedule.timezone)
      : null),
    timeLabel,
    preparationDuration,
    travelDuration,
    example: false,
  };
}

export default function NotificationPreview({ schedule }: { schedule: Schedule | null }): ReactElement {
  const preview = buildNotificationPreview(schedule);

  return h("section", {
    className: "mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5",
    "aria-labelledby": "notification-preview-title",
  },
  h("div", { className: "flex flex-wrap items-center justify-between gap-2" },
    h("h3", { id: "notification-preview-title", className: "text-base font-semibold" }, "Notification preview"),
    h("span", { className: "rounded-full bg-[var(--brand-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--brand-primary)]" },
      preview.example ? "Example · approximate preview" : "Approximate preview · not delivered"),
  ),
  h("p", { className: "mt-1 text-sm text-[var(--text-secondary)]" }, "This shows the concise wake-up reminder text. Chrome and Windows control the final layout."),
  h("div", {
    className: "mt-4 rounded-2xl border border-[var(--notification-preview-border)] bg-[var(--notification-preview-background)] p-4 text-[var(--notification-preview-text)] shadow-lg",
    "data-testid": "notification-preview-card",
  },
    h("div", { className: "flex items-center gap-3" },
      h("img", { src: "/smartmeet-notification.svg", alt: "", className: "h-10 w-10 rounded-xl", width: 40, height: 40 }),
      h("div", { className: "min-w-0 flex-1" },
        h("p", { className: "text-sm font-semibold" }, "SmartMeet"),
        h("p", { className: "text-xs text-[var(--notification-preview-muted)]" }, "Approximate reminder preview · not delivered"),
      ),
      h("span", { className: "text-xs text-[var(--notification-preview-muted)]" }, "now"),
    ),
    h("p", { className: "mt-3 text-sm font-bold" }, preview.title),
    h("p", { className: "mt-1 text-sm leading-5 text-[var(--notification-preview-text)]" }, preview.body),
  ),
  h("p", { className: "mt-3 text-xs leading-5 text-[var(--text-muted)]" },
    "Full schedule details open when you click a delivered reminder. Actual delivery depends on browser permission, a valid push subscription, the backend reminder worker, connectivity, and browser/OS support. Windows and Chrome may wrap or truncate this preview differently."),
  );
}
