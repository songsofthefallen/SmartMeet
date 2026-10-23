import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const listeners = new Map();
const notifications = [];
const calls = [];
let existingClient;
const self = {
  location: { origin: "https://smartmeet.example" },
  registration: { showNotification: async (title, options) => notifications.push({ title, options }) },
  clients: {
    matchAll: async () => [existingClient],
    openWindow: async (url) => calls.push(["open", url]),
  },
  addEventListener: (name, handler) => listeners.set(name, handler),
};
existingClient = { url: "https://smartmeet.example/dashboard", navigate: async (url) => { calls.push(["navigate", url]); return existingClient; }, focus: async () => calls.push(["focus"]) };
vm.runInNewContext(fs.readFileSync("public/service-worker.js", "utf8"), { self, URL });

let pushWait;
listeners.get("push")({ data: { json: () => ({ title: "Get ready: Team meeting", body: "Leave at 12:15 PM · Makati, Manila", url: "/schedules?open=42", scheduleId: "42", reminderType: "wake" }) }, waitUntil: (promise) => { pushWait = promise; } });
await pushWait;
assert.equal(notifications[0].title, "Get ready: Team meeting");
assert.equal(notifications[0].options.body, "Leave at 12:15 PM · Makati, Manila");
assert.equal(notifications[0].options.icon, "/smartmeet-notification.svg");
assert.equal(notifications[0].options.badge, "/smartmeet-notification.svg");
assert.equal(notifications[0].options.data.scheduleId, "42");
assert.equal(notifications[0].options.data.reminderType, "wake");
let clickWait;
listeners.get("notificationclick")({ notification: { data: notifications[0].options.data, close: () => {} }, waitUntil: (promise) => { clickWait = promise; } });
await clickWait;
assert.deepEqual(calls[0], ["navigate", "https://smartmeet.example/schedules?open=42"]);
assert.deepEqual(calls[1], ["focus"]);
console.log("Service worker push display and click navigation checks passed");
