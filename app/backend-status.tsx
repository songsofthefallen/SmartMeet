"use client";

import { useEffect, useRef, useState } from "react";
import { checkBackend } from "../lib/backend-status";
import styles from "./backend-status.module.css";

type BackendState = "checking" | "connected" | "unavailable";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function BackendStatus() {
  const [state, setState] = useState<BackendState>("checking");
  const requestVersion = useRef(0);

  useEffect(() => {
    const currentRequestVersion = ++requestVersion.current;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    async function runHealthCheck() {
      const result = await checkBackend(
        fetch,
        `${apiBaseUrl.replace(/\/$/, "")}/health`,
        controller.signal,
      );

      if (
        active &&
        currentRequestVersion === requestVersion.current &&
        result !== "aborted"
      ) {
        setState(result);
      }

      if (active) {
        window.clearTimeout(timeout);
      }
    }

    void runHealthCheck();
    return () => {
      active = false;
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
