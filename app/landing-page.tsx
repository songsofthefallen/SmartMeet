"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import {
  Bell,
  CarFront,
  CloudSun,
  MapPin,
  MapPinned,
  MessageCircleMore,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

type AuthMode = "sign-in" | "sign-up";

const clerkAppearance = {
  variables: {
    colorBackground: "transparent",
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
    rootBox: "w-full !max-w-none",
    cardBox: "w-full !max-w-none !border-0 !bg-transparent !p-0 !shadow-none !rounded-none",
    card: "w-full !max-w-none !border-0 !bg-transparent !p-0 !shadow-none !rounded-none",
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

function HeroArtwork() {
  return (
    <>
      <div aria-hidden="true" className="landing-hero-art pointer-events-none absolute inset-0 -z-10">
        <Image
          src="/images/smartmeet-hero-map.webp"
          alt=""
          fill
          preload
          sizes="(min-width: 1024px) 58vw, 100vw"
          className="object-cover object-[62%_center]"
        />
      </div>
      <div role="img" aria-label="Illustrative sample route: 10 minutes and 5.8 kilometers. This is not live route data." className="landing-route-label absolute left-[66%] top-[22%] hidden items-center gap-2.5 rounded-xl border border-border/80 bg-background/90 px-3 py-2.5 shadow-lg backdrop-blur-sm xl:flex">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-subtle text-brand-primary"><CarFront size={17} /></span>
        <span className="leading-tight"><span className="block text-sm font-semibold text-text-primary">10 min</span><span className="mt-1 block text-[11px] text-text-muted">5.8 km · sample route</span></span>
      </div>
    </>
  );
}

export default function LandingPage({ initialMode }: { initialMode: AuthMode }) {
  const signInSelected = initialMode === "sign-in";
  return (
    <main className="min-h-screen bg-background text-text-primary">
      <div className="mx-auto min-h-screen w-full max-w-[1450px] px-5 sm:px-8 lg:px-10">
        <header className="flex min-h-[82px] items-center justify-between border-b border-border/80">
          <Link href="/" aria-label="SmartMeet home" className="flex items-center gap-2.5 rounded-md">
            <span className="grid size-9 place-items-center rounded-xl border border-brand-primary/30 bg-brand-subtle text-brand-primary"><MapPinned size={19} strokeWidth={2.2} /></span>
            <span className="text-[19px] font-semibold tracking-[-0.04em]">Smart<span className="text-brand-primary">Meet</span></span>
          </Link>
          <p className="hidden text-sm text-text-muted sm:block">Plan when to leave. Arrive on time.</p>
          <span className="text-xs text-text-muted sm:hidden">Plan. Leave. Arrive.</span>
        </header>

        <div className="grid min-h-[calc(100vh-83px)] items-start gap-8 py-8 md:gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)] lg:gap-8 lg:py-8 lg:pb-0 xl:gap-12">
          <section aria-labelledby="hero-title" className="relative isolate mx-auto flex w-full min-w-0 max-w-[820px] flex-col justify-center py-4 lg:mx-0 lg:self-stretch lg:justify-start">
            <HeroArtwork />
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-primary/25 bg-brand-subtle/70 px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-brand-hover sm:text-[11px]">
              <span className="size-1.5 rounded-full bg-brand-violet" /> YOUR PERSONAL TRAVEL PLANNER
            </div>
            <h1 id="hero-title" className="mt-6 max-w-[650px] text-[clamp(2.75rem,4.5vw,4.7rem)] font-bold leading-[1.02] tracking-[-0.06em]">
              Plan <span className="text-brand-primary">smarter.</span><br />Arrive <span className="text-brand-primary">on time.</span>
            </h1>
            <p className="mt-6 max-w-[510px] text-base leading-[1.55] text-text-secondary sm:text-[17px]">
              Tell SmartMeet your plans in natural language and get smart travel times, traffic-aware routes, and timely reminders.
            </p>

            <ul className="mt-8 grid max-w-[790px] grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-4 sm:gap-x-5" aria-label="SmartMeet features">
              <li className="min-w-0"><span className="grid size-[54px] place-items-center rounded-xl border border-brand-cyan/25 bg-brand-cyan-subtle text-brand-cyan"><MessageCircleMore size={24} /></span><strong className="mt-3 block text-sm font-semibold">Natural input</strong><span className="mt-1.5 block max-w-[130px] text-xs leading-[1.45] text-text-muted">Just describe your plans</span></li>
              <li className="min-w-0"><span className="grid size-[54px] place-items-center rounded-xl border border-brand-primary/25 bg-brand-subtle text-brand-primary"><CarFront size={24} /></span><strong className="mt-3 block text-sm font-semibold">Real routes</strong><span className="mt-1.5 block max-w-[130px] text-xs leading-[1.45] text-text-muted">Traffic-aware travel times</span></li>
              <li className="min-w-0"><span className="grid size-[54px] place-items-center rounded-xl border border-brand-violet/25 bg-brand-violet-subtle text-brand-violet"><Bell size={23} fill="currentColor" strokeWidth={1.8} /></span><strong className="mt-3 block text-sm font-semibold">Smart reminders</strong><span className="mt-1.5 block max-w-[130px] text-xs leading-[1.45] text-text-muted">Get notified on time</span></li>
              <li className="min-w-0"><span className="grid size-[54px] place-items-center rounded-xl border border-brand-violet/25 bg-brand-violet-subtle text-brand-violet"><CloudSun size={24} /></span><strong className="mt-3 block text-sm font-semibold">Weather insights</strong><span className="mt-1.5 block max-w-[130px] text-xs leading-[1.45] text-text-muted">Plan with confidence</span></li>
            </ul>
          </section>

          <aside aria-label="Account access" className="mx-auto w-full min-w-0 max-w-[520px] lg:mx-0 lg:justify-self-end">
            <div className="w-full min-w-0 rounded-[22px] border border-border bg-surface p-5 sm:p-7">
              <div className="mb-6">
                <p className="text-sm text-text-secondary">Welcome to</p>
                <h2 className="mt-1 text-[32px] font-semibold tracking-[-0.05em]">Smart<span className="text-brand-primary">Meet</span></h2>
                <p className="mt-1 text-sm text-text-muted">Plan when to leave. Arrive on time.</p>
              </div>

              <nav aria-label="Choose an account action" className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-background p-1">
                <Link aria-current={signInSelected ? "page" : undefined} href="/?auth=sign-in" className={`rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors ${signInSelected ? "bg-surface-hover text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}>Sign in</Link>
                <Link aria-current={!signInSelected ? "page" : undefined} href="/?auth=sign-up" className={`rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors ${!signInSelected ? "bg-surface-hover text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}>Create account</Link>
              </nav>

              <div className="landing-clerk w-full min-w-0">
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
