import { auth } from "@clerk/nextjs/server";
import DashboardIdentity from "./dashboard-identity";

export const instant = false;

export default async function DashboardPage() {
  await auth.protect();
  return (
    <main className="flex min-h-screen justify-center bg-[var(--background)] px-6 py-16 text-[var(--text-primary)]">
      <section className="h-fit w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Signed-in account</p>
        <DashboardIdentity />
      </section>
    </main>
  );
}
