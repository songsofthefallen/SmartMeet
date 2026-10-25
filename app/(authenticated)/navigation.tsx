"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, MapPinned, Settings2, Signpost, Sparkles } from "lucide-react";
import { UserButton } from "@clerk/nextjs";

const destinations = [
  { href: "/dashboard", label: "Dashboard", Icon: CalendarDays },
  { href: "/schedules", label: "Schedules", Icon: Signpost },
  { href: "/saved-places", label: "Saved Places", Icon: MapPinned },
  { href: "/settings", label: "Settings", Icon: Settings2 },
] as const;

export default function AuthenticatedNavigation() {
  const pathname = usePathname();

  return (
    <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-5 py-5 lg:px-6 lg:py-7">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3 rounded-lg" aria-label="SmartMeet home">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-subtle text-brand-primary" aria-hidden="true">
            <Sparkles className="size-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold tracking-[-0.04em]">SmartMeet</span>
            <span className="mt-0.5 block text-xs text-text-muted">Time to be there.</span>
          </span>
        </Link>
        <div className="lg:hidden"><UserButton /></div>
      </div>

      <nav aria-label="Main navigation" className="grid grid-cols-2 gap-1 px-3 pb-3 md:grid-cols-4 lg:flex lg:flex-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:px-4 lg:py-7">
        {destinations.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary lg:w-full ${active ? "bg-brand-subtle text-brand-primary" : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"}`}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {label === "Dashboard" && <span className="sr-only">, daily overview</span>}
            </Link>
          );
        })}
      </nav>

      <div className="hidden items-center gap-3 border-t border-border px-5 py-5 lg:flex lg:px-6">
        <UserButton />
        <span className="text-xs text-text-muted">Your account</span>
      </div>
    </aside>
  );
}
