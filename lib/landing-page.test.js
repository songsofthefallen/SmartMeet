/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const home = read("app/page.tsx");
const landing = read("app/landing-page.tsx");
const signInRoute = read("app/sign-in/[[...sign-in]]/page.tsx");
const signUpRoute = read("app/sign-up/[[...sign-up]]/page.tsx");
const globalStyles = read("app/globals.css");

assert.match(home, /await auth\(\)/, "root route checks the Clerk session");
assert.match(home, /if \(userId\) redirect\("\/dashboard"\)/, "signed-in users reach Dashboard");
assert.match(landing, /<SignIn routing="hash"/, "panel uses Clerk's real sign-in flow");
assert.match(landing, /<SignUp routing="hash"/, "panel uses Clerk's real sign-up flow");
assert.match(landing, /fallbackRedirectUrl="\/dashboard"/g, "both Clerk flows return to Dashboard");
assert.match(landing, /href="\/\?auth=sign-in"/, "sign-in tab selects sign-in mode");
assert.match(landing, /href="\/\?auth=sign-up"/, "create-account tab selects sign-up mode");
assert.match(landing, /src="\/images\/smartmeet-hero-map\.webp"/, "hero artwork uses the generated local map asset");
assert.match(landing, /absolute inset-0 -z-10/, "hero artwork stays within its own positioned column");
assert.match(landing, /lg:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.9fr\)\]/, "desktop columns share available width without a forced auth minimum");
assert.doesNotMatch(landing, /minmax\(430px|right-\[\d+%\]/, "hero artwork and auth column do not extend past their grid tracks");
assert.match(landing, /cardBox: "[^"]*!bg-transparent/, "Clerk's nested card wrapper is transparent inside the single auth surface");
assert.ok(fs.existsSync("public/images/smartmeet-hero-map.webp"), "generated hero background is present in public assets");
assert.match(landing, /Plan <span className="text-brand-primary">smarter\.<\/span><br \/>Arrive <span className="text-brand-primary">on time\.<\/span>/, "headline keeps the reference's two-line blue emphasis");
for (const feature of ["Natural input", "Just describe your plans", "Real routes", "Traffic-aware travel times", "Smart reminders", "Get notified on time", "Weather insights", "Plan with confidence"]) {
  assert.ok(landing.includes(feature), `hero includes the ${feature} feature copy`);
}
assert.match(landing, /Illustrative sample route: 10 minutes and 5\.8 kilometers\. This is not live route data\./, "route summary identifies its values as illustrative");
assert.match(globalStyles, /--brand-cyan:/, "cyan feature accent is a semantic token");
assert.match(globalStyles, /--brand-violet:/, "violet feature accent is a semantic token");
assert.match(globalStyles, /\.landing-hero-art::after[\s\S]*var\(--background\) 100%/, "hero art fades into the page color at its bounds");
assert.match(signInRoute, /<SignIn fallbackRedirectUrl="\/dashboard"/, "standalone sign-in route is preserved");
assert.match(signUpRoute, /<SignUp fallbackRedirectUrl="\/dashboard"/, "standalone sign-up route is preserved");
assert.doesNotMatch(landing, /<form|type="password"|name="password"/, "credentials are collected only by Clerk");

process.stdout.write("Landing layout, Clerk modes, and authenticated redirect checks passed.\n");
