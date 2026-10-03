import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const port = 3000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Area clienti mobile first: Chromium con viewport da telefono.
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      // Le impostazioni del negozio sono condivise: il loro test gira a parte, dopo gli altri.
      testIgnore: /admin-settings\.spec\.ts$/,
    },
    {
      name: "admin-settings",
      use: { ...devices["Pixel 7"] },
      testMatch: /admin-settings\.spec\.ts$/,
      dependencies: ["mobile-chromium"],
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
