import { auth } from "@clerk/nextjs/server";
import ScheduleWorkspace from "./schedule-workspace";

export const instant = false;

export default async function SchedulesPage() {
  await auth.protect();
  return <ScheduleWorkspace />;
}
