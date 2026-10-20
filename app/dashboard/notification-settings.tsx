"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { scheduleApi } from "@/lib/schedule-api";

const primaryButton = "inline-flex min-h-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";

type PushState = "loading" | "unsupported" | "denied" | "disabled" | "enabled" | "error";

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function getSubscriptionKeys(subscription: PushSubscription): { p256dh: string; auth: string } {
  const json = subscription.toJSON();
  if (!subscription.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription. Try enabling notifications again.");
  }
  return { p256dh: json.keys.p256dh, auth: json.keys.auth };
}

export default function NotificationSettings() {
  const { getToken } = useAuth();
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasSubscription, setHasSubscription] = useState(false);

  const refreshState = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register("/service-worker.js");
      const subscription = await registration.pushManager.getSubscription();
      setHasSubscription(Boolean(subscription));
      setState(Notification.permission === "denied" ? "denied" : subscription ? "enabled" : "disabled");
    } catch {
      setState("error");
      setMessage("The notification service worker could not be started. Check the site configuration and retry.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await refreshState();
    });
    return () => { active = false; };
  }, [refreshState]);

  async function enable() {
    setBusy(true); setMessage("");
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        setMessage(permission === "denied" ? "Notifications are blocked in browser settings. Allow them for this site, then try again." : "Notification permission was not granted.");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Notifications are not configured. Set the public VAPID key and restart the frontend.");
      const registration = await navigator.serviceWorker.register("/service-worker.js");
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) });
      const keys = getSubscriptionKeys(subscription);
      const token = await getToken();
      await scheduleApi.registerPushSubscription({ endpoint: subscription.endpoint, keys }, token);
      setState("enabled"); setMessage("Browser notifications are enabled for this account.");
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "Could not enable notifications. Try again.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) { setState("disabled"); setMessage("No browser subscription is active."); return; }
      const token = await getToken();
      let backendRemoved = false;
      try {
        await scheduleApi.removePushSubscription(subscription.endpoint, token);
        backendRemoved = true;
      } catch (error) {
        setState("enabled");
        setMessage(`The server could not remove this subscription, so the browser subscription remains active. Retry when connected. ${error instanceof Error ? error.message : ""}`);
        return;
      }
      if (backendRemoved) {
        const browserRemoved = await subscription.unsubscribe();
        setHasSubscription(!browserRemoved);
        setState(browserRemoved ? "disabled" : "error");
        setMessage(browserRemoved ? "Browser notifications are disabled." : "The server subscription was removed, but this browser could not unsubscribe. Retry disable to finish.");
      }
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "Could not disable notifications.");
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setMessage("");
    try {
      await scheduleApi.testPushNotification(await getToken());
      setMessage("The push service accepted the test notification. Check this browser for it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the test notification.");
    } finally { setBusy(false); }
  }

  const title = state === "loading" ? "Checking notification support…" : state === "unsupported" ? "Notifications are not supported" : state === "denied" ? "Permission is blocked" : state === "enabled" ? "Notifications are enabled" : state === "error" ? "Notification setup needs attention" : "Notifications are disabled";
  const description = state === "unsupported" ? "This browser does not support service worker push notifications." : state === "denied" ? "Allow notifications for this site in your browser settings to enable them." : state === "enabled" ? "Upcoming reminders can be sent to this browser while its push service is available." : "Enable notifications to receive browser reminders for your schedules.";

  return <section className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6" aria-labelledby="notification-settings-title">
    <h2 id="notification-settings-title" className="text-lg font-semibold">Browser notifications</h2>
    <p className="mt-1 text-sm text-[var(--text-secondary)]">Manage this browser&apos;s push subscription.</p>
    <div className="mt-4 rounded-xl bg-[var(--surface-secondary)] p-4">
      <p className="font-semibold" role="status" aria-live="polite">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
      {message && <p className="mt-3 text-sm text-[var(--text-secondary)]" role="status">{message}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {(state === "disabled" || state === "error") && <button className={primaryButton} disabled={busy} onClick={() => void enable()}>{busy ? "Working…" : "Enable notifications"}</button>}
        {state === "enabled" && <><button className={secondaryButton} disabled={busy} onClick={() => void sendTest()}>{busy ? "Working…" : "Send test notification"}</button><button className={secondaryButton} disabled={busy} onClick={() => void disable()}>Disable notifications</button></>}
        {state === "denied" && <><button className={secondaryButton} onClick={() => void refreshState()}>Check permission again</button>{hasSubscription && <button className={secondaryButton} disabled={busy} onClick={() => void disable()}>Remove subscription</button>}</>}
      </div>
      {state === "enabled" && <p className="mt-3 text-xs text-[var(--text-muted)]">Push service acceptance does not guarantee the device will display a notification.</p>}
    </div>
  </section>;
}
