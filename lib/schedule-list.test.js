/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { groupSchedules } = require("./schedule-list.js");

const item = (id, target_datetime, status = "active", is_past = false) => ({ id, target_datetime, status, is_past });
const grouped = groupSchedules([
  item(1, "2026-10-28T09:00:00Z"),
  item(2, "2026-10-27T09:00:00Z"),
  item(3, "2026-10-20T09:00:00Z", "active", true),
  item(4, "2026-10-18T09:00:00Z", "cancelled", true),
  item(5, "2026-10-19T09:00:00Z", "completed", true),
]);

assert.deepEqual(grouped.upcoming.map(({ id }) => id), [2, 1], "upcoming items sort chronologically");
assert.deepEqual(grouped.past.map(({ id }) => id), [3], "past active items are kept in their own section");
assert.deepEqual(grouped.inactive.map(({ id }) => id), [4, 5], "cancelled and completed items remain manageable separately");
assert.deepEqual(groupSchedules(null), { upcoming: [], past: [], inactive: [] }, "missing API data yields empty groups");

const workspace = fs.readFileSync("app/schedules/schedule-workspace.tsx", "utf8");
assert.match(workspace, /get\("open"\)/, "existing open query parameter remains supported");
assert.match(workspace, /onClick=\{\(\) => void selectSchedule\(item\)\}/, "schedule actions open the existing detail flow");
assert.match(workspace, /openEdit\(selected\)/, "existing detail edit action remains available");
assert.match(workspace, /role="status"/, "loading state is announced to assistive technology");
assert.match(workspace, /Schedules couldn&apos;t be loaded/, "API failure has its own visible state");
assert.match(workspace, /No schedules yet/, "successful empty response has its own empty state");
assert.match(workspace, /lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(360px,0\.9fr\)\]/, "workspace stacks its schedule list and details at narrow widths");

process.stdout.write("Schedule list grouping checks passed.\n");
