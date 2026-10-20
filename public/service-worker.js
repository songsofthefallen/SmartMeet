/* Web Push event handlers. Keep payloads limited to display-safe notification data. */
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: "Deadline Notifier", body: "You have a schedule reminder." }; }
  const title = typeof payload.title === "string" ? payload.title : "Deadline Notifier";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "You have a schedule reminder.",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: { url: typeof payload.url === "string" ? payload.url : "/schedules" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/schedules", self.location.origin);
  const safeTarget = target.origin === self.location.origin ? target.href : new URL("/schedules", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        if ("navigate" in client) void client.navigate(safeTarget);
        return client.focus();
      }
    }
    return self.clients.openWindow(safeTarget);
  }));
});
