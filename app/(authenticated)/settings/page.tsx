import { BellRing, Settings2 } from "lucide-react";
import NotificationSettings from "@/app/dashboard/notification-settings";

export default function SettingsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-9 sm:px-8 sm:py-12 lg:px-10">
      <header className="border-b border-border pb-7 sm:pb-9">
        <Settings2 className="mb-4 size-6 text-brand-primary" strokeWidth={1.7} aria-hidden="true" />
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Settings</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">Manage reminder delivery for this browser and preview how a reminder will read.</p>
      </header>
      <section className="py-7 sm:py-9" aria-labelledby="reminder-settings-heading">
        <div className="mb-5 flex items-start gap-3">
          <BellRing className="mt-1 size-5 shrink-0 text-brand-primary" strokeWidth={1.8} aria-hidden="true" />
          <div>
            <h2 id="reminder-settings-heading" className="text-xl font-semibold tracking-tight">Browser notifications</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">Permission is controlled by your browser. SmartMeet can register this browser for push reminders after you grant permission.</p>
          </div>
        </div>
        <NotificationSettings />
      </section>
    </main>
  );
}
