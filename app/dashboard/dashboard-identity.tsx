"use client";

import { useAuth, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type IdentityState = { status: "loading" } | { status: "ready"; userId: string } | { status: "error" };
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function DashboardIdentity() {
  const { getToken } = useAuth();
  const [identity, setIdentity] = useState<IdentityState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    async function loadIdentity() {
      try {
        const token = await getToken();
        if (!token) throw new Error("No active session token");
        const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Identity request failed");
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null || !("user_id" in body) || typeof body.user_id !== "string") {
          throw new Error("Invalid identity response");
        }
        if (active) setIdentity({ status: "ready", userId: body.user_id });
      } catch {
        if (active) setIdentity({ status: "error" });
      }
    }
    void loadIdentity();
    return () => { active = false; };
  }, [getToken]);

  return (
    <div className="mt-6 flex items-center justify-between rounded-xl bg-[var(--surface-secondary)] p-4">
      <p className="text-sm" role="status" aria-live="polite">
        {identity.status === "loading" && "Verifying your identity…"}
        {identity.status === "ready" && <>Verified Clerk user ID: <span className="font-mono">{identity.userId}</span></>}
        {identity.status === "error" && "Could not verify your identity with the API."}
      </p>
      <UserButton />
    </div>
  );
}
