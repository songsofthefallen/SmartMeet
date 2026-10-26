/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { permissionStatus, browserSubscriptionStatus, accountRegistrationStatus, canSendTestNotification } = require("./notification-status.js");

assert.equal(permissionStatus(false, "granted"), "Unsupported in this browser");
assert.equal(permissionStatus(true, "denied"), "Blocked in browser settings");
assert.equal(permissionStatus(true, "default"), "Not granted");
assert.equal(permissionStatus(true, "granted"), "Granted in browser settings");
assert.equal(browserSubscriptionStatus(true, "loading", false), "Checking this browser");
assert.equal(browserSubscriptionStatus(null, "loading", false), "Checking browser support");
assert.equal(browserSubscriptionStatus(false, "ready", true), "Unavailable");
assert.equal(browserSubscriptionStatus(true, "ready", false), "No browser subscription");
assert.equal(browserSubscriptionStatus(true, "ready", true), "Subscription exists in this browser");
assert.equal(accountRegistrationStatus("unknown"), "Not verified");
assert.equal(accountRegistrationStatus("registered"), "Registration confirmed in this session");
assert.equal(accountRegistrationStatus("not_registered"), "Removed from this account");
assert.equal(accountRegistrationStatus("error"), "Registration needs attention");
assert.equal(canSendTestNotification("enabled", "registered"), true);
assert.equal(canSendTestNotification("enabled", "unknown"), false);
assert.equal(canSendTestNotification("error", "registered"), false);

process.stdout.write("Notification permission, browser subscription, account registration, and test availability checks passed.\n");
