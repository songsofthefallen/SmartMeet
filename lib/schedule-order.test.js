/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { upsertScheduleNewestFirst } = require("./schedule-order.js");

const schedule = (id, created_at) => ({ id, created_at });

const existing = [
  schedule(8, "2026-10-16T10:00:00Z"),
  schedule(7, "2026-10-15T10:00:00Z"),
];

assert.deepEqual(
  upsertScheduleNewestFirst(existing, schedule(9, "2026-10-17T10:00:00Z")).map((item) => item.id),
  [9, 8, 7],
);

assert.deepEqual(
  upsertScheduleNewestFirst(existing, schedule(7, "2026-10-15T10:00:00Z")).map((item) => item.id),
  [8, 7],
  "an idempotent retry keeps the existing schedule's created order without duplicating it",
);

assert.deepEqual(
  upsertScheduleNewestFirst([schedule(8, "2026-10-16T10:00:00Z")], schedule(9, "2026-10-16T10:00:00Z")).map((item) => item.id),
  [9, 8],
  "higher IDs break equal creation timestamps in the same order as the API",
);

process.stdout.write("Schedule ordering tests passed (new create, idempotent retry, timestamp tie-break).\n");
