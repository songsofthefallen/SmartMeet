/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const savedPlacesPage = read("app/(authenticated)/saved-places/page.tsx");
const settingsPage = read("app/(authenticated)/settings/page.tsx");
const dashboardPage = read("app/(authenticated)/dashboard/page.tsx");
const authenticatedLayout = read("app/(authenticated)/layout.tsx");
const navigation = read("app/(authenticated)/navigation.tsx");
const schedulesPage = read("app/(authenticated)/schedules/page.tsx");
const scheduleWorkspace = read("app/schedules/schedule-workspace.tsx");
const savedPlacesManager = read("app/schedules/saved-places.tsx");
const notificationSettings = read("app/dashboard/notification-settings.tsx");

assert.match(authenticatedLayout, /await auth\.protect\(\)/, "authenticated route group retains Clerk protection");
for (const route of ["/dashboard", "/schedules", "/saved-places", "/settings"]) {
  assert.ok(navigation.includes(`href: "${route}"`), `${route} remains in shared navigation`);
}
assert.match(savedPlacesPage, /<SavedPlacesManager\s*\/>/, "Saved Places route mounts its existing management UI");
assert.doesNotMatch(scheduleWorkspace, /SavedPlacesPanel|SavedPlacesManager/, "Schedules no longer embeds the duplicate manager");
assert.match(savedPlacesManager, /scheduleApi\.savedPlaces/);
assert.match(savedPlacesManager, /scheduleApi\.createSavedPlace/);
assert.match(savedPlacesManager, /scheduleApi\.updateSavedPlace/);
assert.match(savedPlacesManager, /scheduleApi\.deleteSavedPlace/);
assert.match(savedPlacesManager, /<SavedPlaceMapPicker/, "manager retains the interactive map picker");
assert.match(settingsPage, /<NotificationSettings\s*\/>/, "Settings route mounts the existing notification controls and preview");
assert.doesNotMatch(dashboardPage, /NotificationSettings/, "Dashboard no longer duplicates notification management");
assert.match(schedulesPage, /searchParams/);
assert.match(scheduleWorkspace, /get\("open"\)/, "existing schedule detail query remains supported");
assert.match(scheduleWorkspace, /startInCreate/, "existing create-workspace handoff remains supported");
assert.match(notificationSettings, /Notification\.requestPermission\(\)/, "permission is requested only by its explicit action");
assert.match(notificationSettings, /push service accepted the SmartMeet test notification/i);
assert.match(notificationSettings, /does not confirm that it was displayed/);

process.stdout.write("Phase 4 route, navigation, saved-place reuse, and notification-flow regression checks passed.\n");
