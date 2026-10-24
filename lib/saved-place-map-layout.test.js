/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("app/schedules/saved-place-map-picker.tsx", "utf8");
const layout = fs.readFileSync("app/schedules/saved-place-map-picker.module.css", "utf8");
const nextConfig = fs.readFileSync("next.config.ts", "utf8");

assert.match(layout, /height:\s*clamp\(18\.75rem,\s*55vw,\s*26\.25rem\)/, "map frame has a responsive, nonzero explicit height");
assert.match(layout, /\.mapContainer\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s, "SDK map target fills its explicitly sized frame");
assert.match(component, /className=\{`relative \$\{styles\.mapFrame\}/, "responsive frame sizing is applied to the map frame");
assert.match(component, /ref=\{mapContainer\} className=\{styles\.mapContainer\}/, "sized target is the element passed to the SDK");
assert.match(nextConfig, /condition:\s*\{\s*not:\s*\{\s*path:\s*"\*\.module\.css"\s*\}\s*\}/, "Tailwind loader excludes CSS Modules so Next preserves their class exports");
assert.doesNotMatch(component, /map-diagnostics|MapDiagnostics|updateMapDiagnosticSizes/, "temporary diagnostics are removed after diagnosis");

console.log("Saved place map container sizing and CSS Module loader regression tests passed.");
