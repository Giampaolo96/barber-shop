"use client";

import { useEffect } from "react";
import { serviceWorkerQuery } from "@/lib/pwa/sw-version";

/**
 * Registra il service worker solo nella build di produzione: in sviluppo non intralcia (ADR 009).
 * La versione del deploy nell'URL dà a ogni deploy la sua cache.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js" + serviceWorkerQuery(process.env.SW_VERSION ?? "local"))
      .catch((error: unknown) => {
        console.error("service worker non registrato:", error);
      });
  }, []);
  return null;
}
