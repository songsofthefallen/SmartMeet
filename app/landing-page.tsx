"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import {
  Bell,
  CloudSun,
  MapPin,
  Navigation,
  Route,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

type AuthMode = "sign-in" | "sign-up";

const clerkAppearance = {
  variables: {
    colorBackground: "var(--surface)",
    colorText: "var(--text-primary)",
    colorTextSecondary: "var(--text-secondary)",
    colorInputBackground: "var(--background)",
    colorInputText: "var(--text-primary)",
    colorPrimary: "var(--brand-primary)",
    colorDanger: "var(--state-error)",
    borderRadius: "0.75rem",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    card: "w-full bg-transparent shadow-none p-0",
    headerTitle: "text-text-primary",
    headerSubtitle: "text-text-secondary",
    formFieldLabel: "text-text-secondary",
    formFieldInput: "border-border focus:border-brand-primary",
    formButtonPrimary: "bg-brand-primary text-background hover:bg-brand-hover",
    footer: "hidden",
    dividerLine: "bg-border",
    dividerText: "text-text-muted",
    socialButtonsBlockButton: "border-border text-text-secondary hover:bg-surface-hover",
    formFieldAction: "text-brand-primary hover:text-brand-hover",
    identityPreviewText: "text-text-primary",
  },
};

function RouteIllustration() {
  return (
    <div
      aria-hidden="true"
      className="landing-map relative mt-10 hidden h-[190px] overflow-hidden rounded-2xl border border-border/70 sm:block lg:mt-12"
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 720 190" preserveAspectRatio="xMidYMid slice" fill="none">
        <path d="M-15 39 117 65l82-19 104 20 73-17 83 26 84-9 102 23 90-18" stroke="var(--border)" strokeWidth="13" opacity=".42" />
        <path d="m-15 143 121-31 95 15 86-26 96 23 87-37 103 23 91-33 82 17" stroke="var(--border)" strokeWidth="10" opacity=".38" />
        <path d="m103-20 21 49-7 55 32 37-12 91M261-15l-13 49 30 43-10 51 19 70M480-21l11 52-21 42 35 54-3 79M631-13l-23 54 27 43-16 49 22 70" stroke="var(--border)" strokeWidth="7" opacity=".35" />
        <path d="m0 92 107-7 80 21 75-12 62 8 46-45 78 7 49 31 72-8 151 21" stroke="var(--surface-secondary)" strokeWidth="22" opacity=".78" />
        <path d="m0 92 107-7 80 21 75-12 62 8 46-45 78 7 49 31 72-8 151 21" stroke="var(--brand-primary)" strokeWidth="3" strokeDasharray="7 8" opacity=".92" />
        <circle cx="107" cy="85" r="8" fill="var(--brand-primary)" />
        <circle cx="107" cy="85" r="15" stroke="var(--brand-primary)" opacity=".3" />
        <circle cx="720" cy="113" r="8" fill="var(--brand-primary)" />
        <circle cx="720" cy="113" r="15" stroke="var(--brand-primary)" opacity=".3" />
      </svg>
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-xl">
        <span className="grid size-9 place-items-center rounded-lg bg-brand-subtle text-brand-primary"><Route size={18} /></span>
        <span className="text-left">
          <span className="block text-xs font-medium text-text-primary">A route, thoughtfully planned</span>
          <span className="mt-0.5 block text-[11px] text-text-muted">Illustrative map · no live route data</span>
        </span>
      </div>
      <span className="absolute right-4 top-4 rounded-full border border-border bg-background/80 px-2.5 py-1 text-[10px] tracking-wide text-text-muted">ROUTE PREVIEW</span>
    </div>
  );
}

export default function LandingPage({ initialMode }: { initialMode: AuthMode }) {
  const signInSelected = initialMode === "sign-in";
  return (
    <main className="min-h-screen overflow-hidden bg-background text-text-primary">
      <div className="mx-auto min-h-screen w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
        <header className="flex min-h-[82px] items-center justify-between border-b border-border/80">
          <Link href="/" aria-label="SmartMeet home" className="flex items-center gap-2.5 rounded-md">
            <span className="grid size-9 place-items-center rounded-xl border border-brand-primary/30 bg-brand-subtle text-brand-primary"><Navigation size={19} strokeWidth={2.2} /></span>
            <span className="text-[19px] font-semibold tracking-[-0.04em]">Smart<span className="text-brand-primary">Meet</span></span>
          </Link>
          <p className="hidden text-sm text-text-muted sm:block">Plan when to leave. Arrive on time.</p>
          <span className="text-xs text-text-muted sm:hidden">Plan. Leave. Arrive.</span>
        </header>

        <div className="grid min-h-[calc(100vh-83px)] items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(390px,0.76fr)] lg:gap-20 lg:py-14">
          <section aria-labelledby="hero-title" className="mx-auto w-full max-w-[650px] lg:mx-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-secondary sm:text-[11px]">
              <span className="size-1.5 rounded-full bg-brand-primary" /> YOUR PERSONAL TRAVEL PLANNER
            </div>
            <h1 id="hero-title" className="mt-6 max-w-[620px] text-[clamp(3.2rem,7vw,5.8rem)] font-semibold leading-[0.99] tracking-[-0.065em]">
              Plan <span className="text-brand-primary">smarter.</span><br />Arrive <span className="text-brand-primary">on time.</span>
            </h1>
            <p className="mt-6 max-w-[510px] text-base leading-7 text-text-secondary sm:text-[17px] sm:leading-8">
              Tell SmartMeet your plans in natural language and get smart travel times, traffic-aware routes, and timely reminders.
            </p>

            <ul className="mt-8 grid max-w-[590px] grid-cols-1 gap-x-7 gap-y-5 sm:grid-cols-2" aria-label="SmartMeet features">
              <li className="flex items-start gap-3"><span className="mt-0.5 text-brand-primary"><Navigation size={17} /></span><span><strong className="block text-sm font-medium">Natural input</strong><span className="mt-1 block text-xs text-text-muted">Just describe your plans</span></span></li>
              <li className="flex items-start gap-3"><span className="mt-0.5 text-brand-primary"><Route size={17} /></span><span><strong className="block text-sm font-medium">Real routes</strong><span className="mt-1 block text-xs text-text-muted">Traffic-aware travel times</span></span></li>
              <li className="flex items-start gap-3"><span className="mt-0.5 text-brand-primary"><Bell size={17} /></span><span><strong className="block text-sm font-medium">Smart reminders</strong><span className="mt-1 block text-xs text-text-muted">Get notified on time</span></span></li>
              <li className="flex items-start gap-3"><span className="mt-0.5 text-brand-primary"><CloudSun size={17} /></span><span><strong className="block text-sm font-medium">Weather insights</strong><span className="mt-1 block text-xs text-text-muted">Plan with confidence</span></span></li>
            </ul>

            <RouteIllustration />
          </section>

          <aside aria-label="Account access" className="mx-auto w-full max-w-[460px] lg:mr-0">
            <div className="rounded-[22px] border border-border bg-surface p-6 sm:p-8">
              <div className="mb-6">
                <p className="text-sm text-text-secondary">Welcome to</p>
                <h2 className="mt-1 text-[32px] font-semibold tracking-[-0.05em]">Smart<span className="text-brand-primary">Meet</span></h2>
                <p className="mt-1 text-sm text-text-muted">Plan when to leave. Arrive on time.</p>
              </div>

              <nav aria-label="Choose an account action" className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-background p-1">
                <Link aria-current={signInSelected ? "page" : undefined} href="/?auth=sign-in" className={`rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors ${signInSelected ? "bg-surface-hover text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}>Sign in</Link>
                <Link aria-current={!signInSelected ? "page" : undefined} href="/?auth=sign-up" className={`rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors ${!signInSelected ? "bg-surface-hover text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}>Create account</Link>
              </nav>

              <div className="min-h-[300px]">
                <Suspense fallback={<div className="py-10 text-center text-sm text-text-muted">Loading secure account options…</div>}>
                  {signInSelected ? (
                    <SignIn routing="hash" signInUrl="/?auth=sign-in" signUpUrl="/?auth=sign-up" fallbackRedirectUrl="/dashboard" appearance={clerkAppearance} />
                  ) : (
                    <SignUp routing="hash" signInUrl="/?auth=sign-in" fallbackRedirectUrl="/dashboard" appearance={clerkAppearance} />
                  )}
                </Suspense>
              </div>
              <div className="mt-6 flex items-center justify-center gap-2 border-t border-border pt-5 text-[11px] text-text-muted">
                <MapPin size={13} className="text-brand-primary" /> Secure sign-in powered by Clerk
              </div>
            </div>
            <p className="mt-4 text-center text-xs leading-5 text-text-muted">Your plans stay private to your account.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}
