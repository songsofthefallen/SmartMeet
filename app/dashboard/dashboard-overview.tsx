"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CarFront, CloudRain, MapPin, RefreshCw, Route } from "lucide-react";
import { getAvailableWeather, getDashboardContentState, getDepartureRecommendation, getScheduleHref, getTrafficSummary, getUpcomingSchedules, getValidTravelEstimate } from "@/lib/dashboard-overview.js";
import { isTrafficEstimateStale, trafficStatusLabel } from "@/lib/traffic-display.js";
import { ScheduleApiError, scheduleApi, type Schedule, type WeatherAdvisory } from "@/lib/schedule-api";

type LoadState = "loading" | "ready" | "error";

function formatDateTime(value: string, timezone: string) {
  try {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Time unavailable";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return "Time unavailable";
  }
}

function formatTime(value: string, timezone: string) {
  try {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Time unavailable";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date);
  } catch {
    return "Time unavailable";
  }
}

function locationLabel(location: Schedule["location"]) {
  if (!location) return "Destination not set";
  const detail = [location.locality, location.region, location.country].filter(Boolean).join(", ");
  return detail ? location.name + " · " + detail : location.name;
}

export default function DashboardOverview() {
  const { getToken, isLoaded } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [clockNow, setClockNow] = useState(0);

  useEffect(() => {
    if (!isLoaded) return;
    const controller = new AbortController();
    let current = true;

    void (async () => {
      setState("loading");
      setError("");
      try {
        const result = await scheduleApi.list(await getToken(), { signal: controller.signal });
        if (!current) return;
        setSchedules(result);
        setClockNow(Date.now());
        setState("ready");
      } catch (cause) {
        if (!current || (cause instanceof ScheduleApiError && cause.code === "cancelled")) return;
        setError(cause instanceof Error ? cause.message : "Schedules could not be loaded.");
        setState("error");
      }
    })();

    return () => {
      current = false;
      controller.abort();
    };
  }, [attempt, getToken, isLoaded]);

  useEffect(() => {
    if (state !== "ready") return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [state]);

  const upcoming = useMemo(() => getUpcomingSchedules(schedules, clockNow), [clockNow, schedules]);
  const next = upcoming[0] ?? null;
  const laterSchedules = upcoming.slice(1, 5);
  const contentState = getDashboardContentState(state, upcoming.length > 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-10 pt-9 sm:px-8 sm:pb-12 sm:pt-12 lg:px-10 lg:pt-14">
      <header className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between sm:pb-10">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-primary">SmartMeet</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Your next event, in view.</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">A clear look at what’s coming up and what’s known about the trip.</p>
        </div>
        <Link href="/schedules?create=1" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-brand-primary px-5 text-sm font-semibold text-background transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:self-auto">
          <CalendarDays className="size-[18px]" aria-hidden="true" />
          Plan a schedule
        </Link>
      </header>

      {contentState === "loading" && <LoadingOverview />}
      {contentState === "error" && (
        <section className="py-12 sm:py-16" role="alert" aria-labelledby="dashboard-error-title">
          <h2 id="dashboard-error-title" className="text-xl font-semibold tracking-tight">Your schedules aren’t available right now.</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary">{error || "Check your connection, then try again."}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
        </section>
      )}
      {contentState === "upcoming" && next && (
        <>
          <NextEvent schedule={next} />
          <UpcomingTimeline schedules={laterSchedules} />
        </>
      )}
      {contentState === "empty" && <EmptyOverview />}
    </div>
  );
}

function LoadingOverview() {
  return (
    <div className="animate-pulse py-9 sm:py-12" role="status" aria-label="Loading your schedules">
      <span className="sr-only">Loading your schedules…</span>
      <div className="h-4 w-28 rounded bg-surface-secondary" />
      <div className="mt-5 h-12 max-w-lg rounded bg-surface-secondary" />
      <div className="mt-3 h-4 max-w-sm rounded bg-surface-secondary" />
      <div className="mt-10 border-y border-border py-8">
        <div className="h-10 w-52 rounded bg-surface-secondary" />
        <div className="mt-5 h-7 max-w-md rounded bg-surface-secondary" />
        <div className="mt-3 h-4 max-w-xl rounded bg-surface-secondary" />
      </div>
    </div>
  );
}

function NextEvent({ schedule }: { schedule: Schedule }) {
  const estimate = getValidTravelEstimate(schedule);
  const departure = getDepartureRecommendation(schedule);
  const weather = getAvailableWeather(schedule);
  const traffic = getTrafficSummary(schedule);
  const staleEstimate = estimate ? isTrafficEstimateStale(estimate.retrieved_at) : false;
  const intentLabel = schedule.time_intent === "arrival" ? "Arrive by" : "Leave at";
  const weatherAdvisories: WeatherAdvisory[] = weather?.advisories ?? [];

  return (
    <section aria-labelledby="next-event-title" className="grid gap-8 border-b border-border py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10 lg:py-12">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <span className="size-1.5 rounded-full bg-brand-primary" aria-hidden="true" />
          <span>Next event</span>
        </div>
        <p className="mt-5 text-3xl font-medium leading-tight tracking-[-0.045em] tabular-nums sm:text-5xl">
          {formatDateTime(schedule.target_datetime, schedule.timezone)}
        </p>
        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="next-event-title" className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{schedule.title}</h2>
          <span className="text-sm font-medium text-brand-primary">{intentLabel}</span>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-text-secondary">
          <MapPin className="mt-1 size-4 shrink-0 text-text-muted" aria-hidden="true" />
          <span>{locationLabel(schedule.location)}</span>
        </p>
        {schedule.origin_location && (
          <p className="mt-1 pl-6 text-sm text-text-muted">From {locationLabel(schedule.origin_location)}</p>
        )}
        <Link href={getScheduleHref(schedule.id)} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary">
          View schedule
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <aside className="flex flex-col gap-5 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1" aria-label="Available travel guidance">
        {schedule.time_intent === "arrival" && (
          <div>
            <p className="text-xs font-medium text-text-muted">Suggested departure</p>
            {departure ? (
              <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{formatTime(departure, schedule.timezone)}</p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                {schedule.departure_unavailable_reason || "A route estimate is needed to calculate a departure time."}
              </p>
            )}
          </div>
        )}
        {schedule.time_intent === "departure" && (
          <div>
            <p className="text-xs font-medium text-text-muted">Scheduled departure</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{formatTime(schedule.target_datetime, schedule.timezone)}</p>
          </div>
        )}
        {estimate && (
          <div className="border-t border-border pt-4">
            <p className="flex items-center gap-2 text-xs font-medium text-text-muted">
              <CarFront className="size-4" aria-hidden="true" />
              Travel estimate
            </p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{estimate.duration_minutes} min</p>
            {traffic && <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary"><Route className="size-3.5" aria-hidden="true" />{trafficStatusLabel(traffic.status)}{traffic.delayMinutes !== null ? " · " + traffic.delayMinutes + " min reported delay" : ""}</p>}
            {staleEstimate && <p className="mt-2 text-xs leading-5 text-state-warning">This traffic estimate may be out of date.</p>}
          </div>
        )}
        {weather && (
          <div className="border-t border-border pt-4">
            <p className="flex items-center gap-2 text-xs font-medium text-text-muted">
              <CloudRain className="size-4" aria-hidden="true" />
              Weather
            </p>
            {weatherAdvisories.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm leading-5 text-text-secondary">
                {weatherAdvisories.map((advisory, index) => (
                  <li key={advisory.endpoint + "-" + advisory.condition + "-" + index}>
                    {advisory.condition} near the {advisory.endpoint}
                    {advisory.forecast_at ? " around " + formatTime(advisory.forecast_at, schedule.timezone) : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-5 text-text-secondary">{weather.summary}</p>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}

function UpcomingTimeline({ schedules }: { schedules: Schedule[] }) {
  return (
    <section aria-labelledby="upcoming-title" className="py-8 sm:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="upcoming-title" className="text-xl font-semibold tracking-[-0.035em]">Coming up</h2>
        <Link href="/schedules" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand-primary hover:text-brand-hover focus-visible:rounded-sm">
          All schedules
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {schedules.length > 0 ? (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {schedules.map((schedule) => (
            <li key={schedule.id}>
              <Link href={getScheduleHref(schedule.id)} className="group grid min-h-[5.25rem] gap-2 py-4 transition-colors hover:bg-surface-hover/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-primary sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-3">
                <span className="text-sm tabular-nums text-text-muted">{formatDateTime(schedule.target_datetime, schedule.timezone)}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:text-brand-primary">{schedule.title}</span>
                  <span className="mt-1 block truncate text-sm text-text-secondary">{locationLabel(schedule.location)}</span>
                </span>
                <span className="text-xs font-medium text-text-muted sm:text-right">{schedule.time_intent === "arrival" ? "Arrive by" : "Leave at"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-y border-border py-5 text-sm text-text-muted">No other upcoming schedules.</p>
      )}
    </section>
  );
}

function EmptyOverview() {
  return (
    <section className="max-w-2xl py-12 sm:py-16" aria-labelledby="empty-title">
      <CalendarDays className="size-7 text-brand-primary" strokeWidth={1.6} aria-hidden="true" />
      <h2 id="empty-title" className="mt-5 text-2xl font-semibold tracking-[-0.04em]">Make space for what’s next.</h2>
      <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">Plan an event to keep its time, route estimate, and departure guidance together. Travel details appear when the information is available.</p>
    </section>
  );
}
