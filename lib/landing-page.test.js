/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const home = read("app/page.tsx");
const landing = read("app/landing-page.tsx");
const signInRoute = read("app/sign-in/[[...sign-in]]/page.tsx");
const signUpRoute = read("app/sign-up/[[...sign-up]]/page.tsx");

assert.match(home, /await auth\(\)/, "root route checks the Clerk session");
assert.match(home, /if \(userId\) redirect\("\/dashboard"\)/, "signed-in users reach Dashboard");
assert.match(landing, /<SignIn routing="hash"/, "panel uses Clerk's real sign-in flow");
assert.match(landing, /<SignUp routing="hash"/, "panel uses Clerk's real sign-up flow");
assert.match(landing, /fallbackRedirectUrl="\/dashboard"/g, "both Clerk flows return to Dashboard");
assert.match(landing, /href="\/\?auth=sign-in"/, "sign-in tab selects sign-in mode");
assert.match(landing, /href="\/\?auth=sign-up"/, "create-account tab selects sign-up mode");
assert.match(signInRoute, /<SignIn fallbackRedirectUrl="\/dashboard"/, "standalone sign-in route is preserved");
assert.match(signUpRoute, /<SignUp fallbackRedirectUrl="\/dashboard"/, "standalone sign-up route is preserved");
assert.doesNotMatch(landing, /<form|type="password"|name="password"/, "credentials are collected only by Clerk");

process.stdout.write("Landing layout, Clerk modes, and authenticated redirect checks passed.\n");
