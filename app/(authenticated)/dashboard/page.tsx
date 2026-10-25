import { auth } from "@clerk/nextjs/server";
import DashboardOverview from "@/app/dashboard/dashboard-overview";
import NotificationSettings from "@/app/dashboard/notification-settings";

export const instant = false;

export default async function DashboardPage() {
  await auth.protect();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <DashboardOverview />
      <section className="mx-auto w-full max-w-6xl px-5 pb-14 sm:px-8 lg:px-10" aria-label="Notification settings">
        <div className="border-t border-border pt-8 sm:pt-10">
          <p className="mb-4 text-sm text-text-muted">Reminder delivery</p>
          <NotificationSettings />
        </div>
      </section>
    </main>
  );
}
