import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// @ts-expect-error Node's TypeScript runner requires explicit source extensions.
import NotificationPreview, { buildNotificationPreview } from "./notification-preview.ts";
import type { Schedule } from "../../lib/schedule-api.ts";

const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  title: "Morning class",
  location: { name: "City Campus", locality: "Manila", region: null },
  time_intent: "arrival",
  target_datetime: "2026-10-23T05:00:00.000Z",
  timezone: "Asia/Manila",
  preparation_duration_minutes: 45,
  travel_duration_minutes: 30,
  calculated_departure_time: null,
  calculated_arrival_time: null,
  ...overrides,
}) as unknown as Schedule;

test("preview renders a realistic example when no schedule is selected", () => {
  const html = renderToStaticMarkup(createElement(NotificationPreview, { schedule: null }));
  assert.match(html, /Example · approximate preview/);
  assert.match(html, /SmartMeet/);
  assert.match(html, /Get ready: Team meeting/);
  assert.match(html, /Leave at 12:15 PM · Makati/);
  assert.match(html, /Chrome and Windows control the final layout/);
  assert.match(html, /Full schedule details open when you click/);
});

test("preview uses selected schedule details and timezone without inventing missing values", () => {
  const content = buildNotificationPreview(schedule());
  assert.equal(content.eventName, "Morning class");
  assert.equal(content.destination, "City Campus, Manila");
  assert.equal(content.eventTime, "Oct 23 at 1:00 PM");
  assert.equal(content.preparationDuration, "45 minutes");
  assert.equal(content.travelDuration, "30 minutes");
  assert.equal(content.title, "Get ready: Morning class");
  assert.equal(content.body, "Arrive by 1:00 PM · City Campus, Manila");
  assert.equal(buildNotificationPreview(schedule({
    calculated_departure_time: "2026-10-23T04:15:00.000Z",
  })).body, "Leave at 12:15 PM · City Campus, Manila");

  const html = renderToStaticMarkup(createElement(NotificationPreview, { schedule: schedule() }));
  assert.match(html, /Approximate preview · not delivered/);
  assert.match(html, /data-testid="notification-preview-card"/);
  assert.match(html, /Arrive by 1:00 PM · City Campus, Manila/);
  assert.doesNotMatch(html, /45 minutes|30 minutes/);
});

test("preview labels only known departure data and leaves unavailable values unset", () => {
  const content = buildNotificationPreview(schedule({
    time_intent: "departure",
    location: null,
    preparation_duration_minutes: null,
    travel_duration_minutes: null,
  }));
  assert.equal(content.timeLabel, "Departure time");
  assert.equal(content.destination, null);
  assert.equal(content.preparationDuration, null);
  assert.equal(content.travelDuration, null);
  assert.doesNotMatch(content.body, /estimated arrival|travel time|minutes to prepare/i);

  const html = renderToStaticMarkup(createElement(NotificationPreview, { schedule: schedule({
    time_intent: "departure",
    location: null,
    preparation_duration_minutes: null,
    travel_duration_minutes: null,
  }) }));
  assert.match(html, /Check your schedule for details/);
  assert.doesNotMatch(html, /Not set/);
});

test("preview caps long schedule labels and handles missing destination and time", () => {
  const content = buildNotificationPreview(schedule({
    title: "Quarterly planning and cross-functional leadership alignment workshop",
    location: { name: "The exceptionally long conference venue at the eastern international business district campus", locality: null, region: null },
    calculated_departure_time: null,
    calculated_arrival_time: null,
    target_datetime: "invalid",
  }));
  assert.equal(content.title, "Get ready: Quarterly planning and cross-functional…");
  assert.equal(content.body, "The exceptionally long conference venue at the…");
});
