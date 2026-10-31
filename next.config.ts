import type { NextConfig } from "next";
import { serviceWorkerVersion } from "./src/lib/pwa/sw-version";

const nextConfig: NextConfig = {
  // In sviluppo l'indicatore di Next sta in basso a sinistra, proprio sopra "Esci" dell'area staff.
  devIndicators: false,
  // Versione della cache del service worker: una per deploy (ADR 009).
  env: { SW_VERSION: serviceWorkerVersion(process.env) },
  experimental: {
    // Il ritratto di un barbiere arriva fino a 1 MB (fetta 8d): col limite predefinito di 1 MB
    // Next rifiuterebbe il corpo prima che l'azione possa rispondere.
    serverActions: { bodySizeLimit: "2mb" },
  },
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
