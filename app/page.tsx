import BackendStatus from "./backend-status";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-6 py-16 text-[var(--text-primary)]">
      <section className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Deadline Notifier</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Local application foundation
        </p>
        <BackendStatus />
      </section>
    </main>
  );
}
