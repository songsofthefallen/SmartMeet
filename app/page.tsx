import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import BackendStatus from "./backend-status";

export const instant = false;

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-6 py-16 text-[var(--text-primary)]">
      <section className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">SmartMeet</h1>
          <Suspense fallback={null}>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </Suspense>
        </div>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Plan when to leave. Arrive on time.
        </p>
        <BackendStatus />
        <Suspense
          fallback={
            <p className="mt-6 text-sm text-[var(--text-muted)]">
              Loading account options…
            </p>
          }
        >
          <div className="mt-6 flex gap-3">
            <Show when="signed-out">
              <SignInButton mode="redirect">
                <button className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="redirect">
                <button className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium">
                  Create account
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <a
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white"
                href="/dashboard"
              >
                Open dashboard
              </a>
            </Show>
          </div>
        </Suspense>
      </section>
    </main>
  );
}
