import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Gate (npm run test:e2e, CI e hook): e2e sulla build di produzione, come in rilascio. Niente riuso di
// un server già avviato: un dev server sulla 3000 farebbe passare per produzione un giro in sviluppo.
export default defineConfig({
  ...base,
  metadata: { ...base.metadata, production: true },
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
