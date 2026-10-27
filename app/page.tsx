import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import LandingPage from "./landing-page";

export const instant = false;

type HomeProps = {
  searchParams: Promise<{ auth?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  const { auth: authMode } = await searchParams;
  return <LandingPage initialMode={authMode === "sign-up" ? "sign-up" : "sign-in"} />;
}
