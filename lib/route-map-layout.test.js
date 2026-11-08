/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("app/schedules/route-comparison-map.tsx", "utf8");
const layout = fs.readFileSync("app/schedules/route-comparison-map.module.css", "utf8");

assert.match(layout, /\.mapViewport\s*\{[^}]*width:\s*100%;[^}]*height:\s*clamp\(18rem,\s*62vh,\s*30rem\);/s, "route map frame has explicit production-safe dimensions");
assert.match(layout, /\.mapCanvas\s*\{[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;/s, "SDK target fills its sized route frame");
assert.match(component, /className=\{styles\.mapViewport\}/, "route frame uses its CSS module dimensions");
assert.match(component, /ref=\{containerRef\} className=\{styles\.mapCanvas\}/, "SDK target uses the full-size canvas class");
assert.match(component, /nativeMap\.resize\(\);\s*const current = currentMapData\.current;\s*setRouteLayers/s, "map is resized before route layers and fit bounds are applied");
assert.match(component, /new ResizeObserver\(\(\) => nativeMap\.resize\(\)\)/, "later layout changes resize the map");

console.log("Route map layout and resize lifecycle tests passed.");
