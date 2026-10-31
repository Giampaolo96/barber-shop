import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const port = 3000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Solo in sviluppo: carica una volta le pagine principali prima dei test (compilazione on-demand).
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // In locale un quarto dei core: con il default di Playwright (metà dei core) il dev server e lo
  // stack Supabase locale si saturano e i login dello staff superano i timeout. In CI resta il default.
  workers: isCI ? undefined : "25%",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Il riepilogo fa fallire il giro se un test non è stato eseguito senza uno skip esplicito (ad
  // esempio admin-settings, che non parte se fallisce un test di mobile-chromium).
  reporter: isCI
    ? [["github"], ["html", { open: "never" }], ["./tests/e2e/run-summary-reporter.ts"]]
    : [["list"], ["./tests/e2e/run-summary-reporter.ts"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Area clienti mobile first: Chromium con viewport da telefono.
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      // Le impostazioni del negozio sono condivise: il loro test gira a parte, dopo gli altri.
      testIgnore: /admin-settings\.spec\.ts$/,
    },
    // Rotazione di "Quando?" anche su WebKit (fetta 8g): solo quel file; mobile-chromium lo esegue comunque.
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 14"] },
      testMatch: /booking-when-rotation\.spec\.ts$/,
    },
    {
      name: "admin-settings",
      use: { ...devices["Pixel 7"] },
      testMatch: /admin-settings\.spec\.ts$/,
      // Dopo tutti gli altri: modifica shop_settings, che anche la rotazione legge.
      dependencies: ["mobile-chromium", "mobile-webkit"],
    },
  ],
  webServer: {
    // In CI gli e2e girano sulla build di produzione; in locale basta il dev server.
    command: isCI ? "npm run build && npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
