import type { NextConfig } from "next";
import { serviceWorkerVersion } from "./src/lib/pwa/sw-version";

const nextConfig: NextConfig = {
  // Versione della cache del service worker: una per deploy (ADR 009).
  env: { SW_VERSION: serviceWorkerVersion(process.env) },
  async headers() {
    return [
      {
        // Il service worker va sempre ricontrollato: un aggiornamento (o l'interruttore
        // d'emergenza, ADR 009) deve arrivare subito.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
