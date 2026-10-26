import { MapPinned } from "lucide-react";
import { SavedPlacesManager } from "@/app/schedules/saved-places";

export default function SavedPlacesPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-9 sm:px-8 sm:py-12 lg:px-10">
      <header className="border-b border-border pb-7 sm:pb-9">
        <MapPinned className="mb-4 size-6 text-brand-primary" strokeWidth={1.7} aria-hidden="true" />
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Saved Places</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-text-secondary">Manage the locations you reuse when planning a schedule.</p>
      </header>
      <SavedPlacesManager />
    </main>
  );
}
