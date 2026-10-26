"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Check, CircleAlert, CircleHelp } from "lucide-react";
import { scheduleApi, type Schedule } from "@/lib/schedule-api";
import { accountRegistrationStatus, browserSubscriptionStatus, canSendTestNotification, permissionStatus } from "@/lib/notification-status.js";
import NotificationPreview from "./notification-preview";

const primaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--background)] hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:cursor-not-allowed disabled:opacity-60";

type PushState = "loading" | "unsupported" | "denied" | "disabled" | "enabled" | "error";
type RegistrationState = "unknown" | "registered" | "not_registered" | "error";

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
  const [supported, setSupported] = useState<boolean | null>(null);
  const [registration, setRegistration] = useState<RegistrationState>("unknown");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hasSubscription, setHasSubscription] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("example");
  const [scheduleListError, setScheduleListError] = useState(false);
  const [scheduleListLoaded, setScheduleListLoaded] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const selectedSchedule = schedules.find((schedule) => String(schedule.id) === selectedScheduleId) ?? null;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const items = await scheduleApi.list(await getToken());
        if (!active) return;
        const activeSchedules = items.filter((item) => item.status === "active");
        setSchedules(activeSchedules);
        setSelectedScheduleId(activeSchedules.length ? String(activeSchedules[0].id) : "example");
        setScheduleListLoaded(true);
      } catch {
        if (active) { setScheduleListError(true); setScheduleListLoaded(true); }
      }
    })();
    return () => { active = false; };
  }, [getToken]);

  const refreshState = useCallback(async () => {
    const available = typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
    setSupported(available);
    if (!available) {
      setState("unsupported");
      setHasSubscription(false);
      setRegistration("unknown");
      return;
    }
    try {
      const serviceWorker = await navigator.serviceWorker.register("/service-worker.js");
      const subscription = await serviceWorker.pushManager.getSubscription();
      setHasSubscription(Boolean(subscription));
      setRegistration("unknown");
      setState(Notification.permission === "denied" ? "denied" : subscription ? "enabled" : "disabled");
    } catch {
      setState("error");
      setRegistration("unknown");
      setMessage("The notification service worker could not be started. Check the site configuration and retry.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => { if (active) await refreshState(); });
    return () => { active = false; };
  }, [refreshState]);

  async function enable() {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported"); setSupported(false); return;
    }
    setBusy(true); setMessage(""); setTestFeedback(null);
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        setMessage(permission === "denied" ? "Notifications are blocked in browser settings. Allow them for this site, then try again." : "Notification permission was not granted.");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("Notifications are not configured. Set the public VAPID key and restart the frontend.");
      const serviceWorker = await navigator.serviceWorker.register("/service-worker.js");
      const subscription = await serviceWorker.pushManager.getSubscription() ?? await serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) });
      setHasSubscription(true);
      const keys = getSubscriptionKeys(subscription);
      await scheduleApi.registerPushSubscription({ endpoint: subscription.endpoint, keys }, await getToken());
      setState("enabled"); setRegistration("registered"); setMessage("This browser is registered with your SmartMeet account.");
    } catch (error) {
      setState("error"); setRegistration("error"); setMessage(error instanceof Error ? error.message : "Could not register this browser. Try again.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage(""); setTestFeedback(null);
    try {
      const serviceWorker = await navigator.serviceWorker.getRegistration("/");
      const subscription = await serviceWorker?.pushManager.getSubscription();
      if (!subscription) { setState("disabled"); setHasSubscription(false); setRegistration("unknown"); setMessage("No browser subscription is active."); return; }
      try {
        await scheduleApi.removePushSubscription(subscription.endpoint, await getToken());
      } catch (error) {
        setState("enabled");
        if (registration !== "registered") setRegistration("unknown");
        setMessage(`The server could not remove this subscription, so the browser subscription remains active. Retry when connected. ${error instanceof Error ? error.message : ""}`);
        return;
      }
      setRegistration("not_registered");
      const browserRemoved = await subscription.unsubscribe();
      setHasSubscription(!browserRemoved);
      setState(browserRemoved ? "disabled" : "error");
      setMessage(browserRemoved ? "This browser subscription was removed from your account and browser." : "The account registration was removed, but this browser could not unsubscribe. Retry to finish.");
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "Could not remove this browser subscription.");
    } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!canSendTestNotification(state, registration)) return;
    setBusy(true); setMessage(""); setTestFeedback(null);
    try {
      const result = await scheduleApi.testPushNotification(await getToken(), selectedSchedule?.id);
      if (result.accepted !== true) throw new Error("The push service did not confirm acceptance.");
      setTestFeedback({ kind: "success", text: "The push service accepted the SmartMeet test notification. Check your browser or device; acceptance does not confirm that it was displayed." });
    } catch (error) {
      setTestFeedback({ kind: "error", text: error instanceof Error ? error.message : "Could not send the test notification." });
    } finally { setBusy(false); }
  }

  const permission = supported === null ? "unsupported" : supported ? Notification.permission : "unsupported";
  const permissionLabel = supported === null ? "Checking browser support" : permissionStatus(supported, permission);
  const subscriptionLabel = browserSubscriptionStatus(supported, state === "loading" ? "loading" : state === "error" ? "error" : "ready", hasSubscription);
  const registrationLabel = accountRegistrationStatus(registration);
  const canTest = canSendTestNotification(state, registration);
  const title = state === "loading" ? "Checking this browser…" : state === "unsupported" ? "Push notifications are unsupported" : state === "denied" ? "Browser permission is blocked" : state === "enabled" ? registration === "registered" ? "This browser is registered" : "A browser subscription exists" : state === "error" ? "Notification setup needs attention" : "No browser subscription";
  const description = state === "unsupported" ? "This browser does not support service worker push notifications. Your schedules remain available in SmartMeet." : state === "denied" ? "Change this site’s notification permission in your browser settings, then check again here." : state === "enabled" && registration !== "registered" ? "Register this browser with your SmartMeet account before sending a test notification." : state === "enabled" ? "This browser is registered for push reminders. A test can confirm push-service acceptance, not device display." : "Enable notifications to ask your browser for permission and register a push subscription with SmartMeet.";

  return <section className="space-y-6" aria-label="Notification controls and preview">
    <div>
      <h3 className="text-base font-semibold">Permission and registration</h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Browser permission, this device&apos;s subscription, and account registration are checked separately.</p>
      <dl className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        <StatusRow label="Browser permission" value={permissionLabel} Icon={permission === "granted" ? Check : permission === "denied" ? CircleAlert : CircleHelp} />
        <StatusRow label="This browser" value={subscriptionLabel} Icon={hasSubscription ? Bell : BellOff} />
        <StatusRow label="SmartMeet account" value={registrationLabel} Icon={registration === "registered" ? Check : registration === "error" ? CircleAlert : CircleHelp} />
      </dl>
    </div>
    <div>
      <label htmlFor="notification-preview-schedule" className="block text-sm font-medium">Preview schedule</label>
      <select id="notification-preview-schedule" className="mt-1.5 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)]" value={selectedScheduleId} onChange={(event) => { setSelectedScheduleId(event.target.value); setTestFeedback(null); }}>
        <option value="example">Example preview</option>
        {schedules.map((schedule) => <option key={schedule.id} value={String(schedule.id)}>{schedule.title}</option>)}
      </select>
      {scheduleListError && <p className="mt-1 text-xs text-[var(--state-warning)]">Saved schedules could not be loaded. The example preview is shown until they are available.</p>}
      {!scheduleListLoaded && <p className="mt-1 text-xs text-[var(--text-muted)]" role="status">Loading saved schedules…</p>}
      {scheduleListLoaded && !scheduleListError && !schedules.length && <p className="mt-1 text-xs text-[var(--text-muted)]">No active schedules are available, so this is an example preview.</p>}
    </div>
    <NotificationPreview schedule={selectedSchedule} />
    <div className="border-t border-[var(--border)] pt-5">
      <p className="font-semibold" role="status" aria-live="polite">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
      {message && <p className="mt-3 text-sm text-[var(--text-secondary)]" role="status">{message}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {(state === "disabled" || state === "error" || (state === "enabled" && registration !== "registered")) && <button className={primaryButton} disabled={busy} onClick={() => void enable()}>{busy ? "Working…" : hasSubscription ? "Register this browser" : "Enable notifications"}</button>}
        {state === "denied" && <button className={secondaryButton} disabled={busy} onClick={() => void refreshState()}>Check permission again</button>}
        {canTest && <button className={secondaryButton} disabled={busy} onClick={() => void sendTest()}>{busy ? "Sending test…" : "Send test notification"}</button>}
        {hasSubscription && state !== "unsupported" && state !== "loading" && <button className={secondaryButton} disabled={busy} onClick={() => void disable()}>{registration === "registered" ? "Disable notifications" : "Remove browser subscription"}</button>}
      </div>
      {testFeedback && <p className={`mt-3 text-sm ${testFeedback.kind === "success" ? "text-[var(--state-success)]" : "text-[var(--state-error)]"}`} role="status" aria-live="polite">{testFeedback.text}</p>}
      {canTest && <p className="mt-3 text-xs text-[var(--text-muted)]">Test notifications are separate from scheduled reminders and are labeled as tests. Push-service acceptance does not confirm that your device displayed the notification.</p>}
    </div>
  </section>;
}

function StatusRow({ label, value, Icon }: { label: string; value: string; Icon: typeof Check }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm"><dt className="text-[var(--text-muted)]">{label}</dt><dd className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]"><Icon className="size-4 text-[var(--brand-primary)]" aria-hidden="true" />{value}</dd></div>;
}
