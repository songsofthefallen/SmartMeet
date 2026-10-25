import { auth } from "@clerk/nextjs/server";
import ScheduleWorkspace from "@/app/schedules/schedule-workspace";

export const instant = false;

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  await auth.protect();
  const { create } = await searchParams;
  return <ScheduleWorkspace startInCreate={create === "1"} />;
}
