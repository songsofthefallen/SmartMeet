/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { arrivalPreparationNote, suggestedTimeRows } = require("./suggested-times.js");

const format = (value, timezone) => `${value} (${timezone})`;
const base = {
  timezone: "Asia/Manila",
  target_datetime: "2026-10-15T00:00:00Z",
  time_intent: "arrival",
  preparation_duration_minutes: 30,
  travel_duration_minutes: 41,
  calculated_departure_time: "2026-10-14T23:19:00Z",
  calculated_arrival_time: "2026-10-15T00:00:00Z",
  calculated_wake_time: "2026-10-14T22:49:00Z",
  departure_unavailable_reason: null,
  arrival_unavailable_reason: null,
  wake_unavailable_reason: null,
};

const arrival = suggestedTimeRows(base, format);
assert.deepEqual(arrival.map((row) => row.label), ["Suggested departure", "Wake-up / preparation start"]);
assert.match(arrival[0].value, /2026-10-14T23:19:00Z/);
assert.match(arrival[1].value, /2026-10-14T22:49:00Z/);
assert.equal(arrivalPreparationNote(base), null);

const arrivalUnknownTravel = suggestedTimeRows({
  ...base,
  travel_duration_minutes: null,
  calculated_departure_time: null,
  departure_unavailable_reason: "Travel duration is unknown.",
}, format);
assert.equal(arrivalUnknownTravel[0].value, "Travel duration is unknown.");
assert.equal(arrivalPreparationNote({ ...base, travel_duration_minutes: null, calculated_departure_time: null }), "Travel duration is unknown. This preparation-start suggestion is measured back from the target arrival time.");

const arrivalUnknownPreparation = suggestedTimeRows({
  ...base,
  preparation_duration_minutes: null,
  calculated_wake_time: null,
  wake_unavailable_reason: "Preparation duration is unknown.",
}, format);
assert.equal(arrivalUnknownPreparation[1].value, "Wake-up time cannot be calculated because preparation duration is unknown.");

const departure = suggestedTimeRows({
  ...base,
  time_intent: "departure",
  calculated_departure_time: "ignored; target is authoritative",
}, format);
assert.deepEqual(departure.map((row) => row.label), ["Departure time", "Estimated arrival", "Wake-up / preparation start"]);
assert.match(departure[0].value, /2026-10-15T00:00:00Z/);
assert.match(departure[1].value, /2026-10-15T00:00:00Z/);

const departureUnknownTravel = suggestedTimeRows({
  ...base,
  time_intent: "departure",
  travel_duration_minutes: null,
  calculated_arrival_time: null,
  arrival_unavailable_reason: "Travel duration is unknown.",
}, format);
assert.match(departureUnknownTravel[0].value, /2026-10-15T00:00:00Z/);
assert.equal(departureUnknownTravel[1].value, "Estimated arrival is unavailable because travel duration is unknown.");

const departureUnknownPreparation = suggestedTimeRows({
  ...base,
  time_intent: "departure",
  preparation_duration_minutes: null,
  calculated_wake_time: null,
  wake_unavailable_reason: "Preparation duration is unknown.",
}, format);
assert.equal(departureUnknownPreparation[2].value, "Wake-up time cannot be calculated because preparation duration is unknown.");

process.stdout.write("Suggested times display tests passed (both intents and unknown durations).\n");
