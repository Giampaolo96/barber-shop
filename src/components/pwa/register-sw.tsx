"use client";

import { useEffect } from "react";

/** Registra il service worker solo nella build di produzione: in sviluppo non intralcia (ADR 009). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("service worker non registrato:", error);
    });
  }, []);
  return null;
}
