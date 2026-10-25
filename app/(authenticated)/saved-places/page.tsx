import { MapPinned } from "lucide-react";

export default function SavedPlacesPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="max-w-2xl">
        <MapPinned className="mb-5 size-6 text-brand-primary" strokeWidth={1.7} aria-hidden="true" />
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Saved Places</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">Your saved locations are still managed from Schedules while the planning workspace is being reorganized.</p>
        <a href="/schedules" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-primary px-4 font-semibold text-background hover:bg-brand-hover">Open Schedules</a>
      </div>
    </main>
  );
}
