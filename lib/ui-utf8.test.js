/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const workspaceBytes = readFileSync("app/schedules/schedule-workspace.tsx");
const workspace = new TextDecoder("utf-8", { fatal: true }).decode(workspaceBytes);
const mapBytes = readFileSync("app/schedules/route-comparison-map.tsx");
const map = new TextDecoder("utf-8", { fatal: true }).decode(mapBytes);

assert.ok(workspace.includes("Schedule updated."));
assert.ok(workspace.includes("Finding driving routes…"));
assert.ok(workspace.includes("✓"));
assert.ok(workspace.includes("Asia/Manila"));
assert.ok(workspace.includes('aria-hidden="true">·</span>'));
assert.ok(workspace.includes(" · Selected"));
assert.equal(map.includes("Hospital"), false, "route preview no longer advertises nearby hospitals");
assert.equal(map.includes("School"), false, "route preview no longer advertises nearby schools");
assert.equal(map.includes("Near selected route"), false, "nearby-place results are absent from the route preview");
assert.equal(map.includes("Nearby labels depend on map coverage."), false, "custom map footer is removed while SDK attribution remains map-managed");
assert.ok(map.includes("A · {origin?.name"));
assert.ok(map.includes("B · {destination?.name"));
const visibleUiText = `${workspace}\n${map}`;
const mojibakeMarkers = [
  String.fromCharCode(0x00c2, 0x00b7),
  String.fromCharCode(0x00c3, 0x2014),
  String.fromCharCode(0x00e2, 0x20ac, 0x2026),
  String.fromCharCode(0xfffd),
];
for (const marker of mojibakeMarkers) assert.equal(visibleUiText.includes(marker), false);

console.log("Affected UI strings are valid UTF-8 and retain intended punctuation.");
