import { auth } from "@clerk/nextjs/server";
import DashboardOverview from "@/app/dashboard/dashboard-overview";

export const instant = false;

export default async function DashboardPage() {
  await auth.protect();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <DashboardOverview />
    </main>
  );
}
