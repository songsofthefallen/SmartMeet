import Link from "next/link";
import { Settings2 } from "lucide-react";

export default function SettingsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="max-w-2xl">
        <Settings2 className="mb-5 size-6 text-brand-primary" strokeWidth={1.7} aria-hidden="true" />
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Settings</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">Notification controls remain on your Dashboard during this phase.</p>
        <Link href="/dashboard" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-primary px-4 font-semibold text-background hover:bg-brand-hover">Open Dashboard</Link>
      </div>
    </main>
  );
}
