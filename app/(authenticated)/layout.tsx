import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import AuthenticatedNavigation from "./navigation";

export const instant = false;

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  await auth.protect();

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <AuthenticatedNavigation />
      <div className="min-w-0">
        {children}
      </div>
    </div>
  );
}
