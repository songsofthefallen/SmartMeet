"use client";

import { useEffect, useState } from "react";
import styles from "./backend-status.module.css";

type BackendState = "checking" | "connected" | "unavailable";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function BackendStatus() {
  const [state, setState] = useState<BackendState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    async function checkBackend() {
      try {
        const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/health`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setState("unavailable");
          return;
        }

        const body: unknown = await response.json();
        setState(
          typeof body === "object" &&
            body !== null &&
            "status" in body &&
            body.status === "ok"
            ? "connected"
            : "unavailable",
        );
      } catch {
        setState("unavailable");
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkBackend();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const message = {
    checking: "Checking backend…",
    connected: "Backend connected",
    unavailable: "Backend unavailable",
  }[state];

  return (
    <div className={styles.status}>
      <span className={`${styles.indicator} ${styles[state]}`} aria-hidden="true" />
      <p role="status" aria-live="polite">{message}</p>
    </div>
  );
}
