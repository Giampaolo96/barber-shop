import { describe, expect, test } from "vitest";
import { destinationAfterLogin } from "./safe-next-path";

const customer = { role: "customer" as const, profileComplete: true, isBlocked: false };

describe("destinationAfterLogin con il consenso privacy scaduto", () => {
  test("dal flusso di prenotazione passa da /profilo/consenso e porta con sé next", () => {
    const next = "/prenota/quando?servizio=abc";
    expect(destinationAfterLogin(next, { ...customer, privacyConsentOutdated: true })).toBe(
      `/profilo/consenso?next=${encodeURIComponent(next)}`,
    );
  });

  test("le pagine aperte con il consenso scaduto restano la destinazione", () => {
    expect(destinationAfterLogin("/prenotazioni", { ...customer, privacyConsentOutdated: true })).toBe("/prenotazioni");
  });

  test("con il consenso valido nessuna deviazione", () => {
    expect(destinationAfterLogin("/prenota", customer)).toBe("/prenota");
  });
});
