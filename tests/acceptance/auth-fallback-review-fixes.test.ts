// Regressioni della review del ripiego login (scritte durante l'implementazione, non da spec-qa).
// Miglioria 1: la destinazione di ritorno si conserva anche se il code arriva su /auth/confirm.
import { describe, expect, test } from "vitest";
import { callbackDestination } from "@/lib/auth/email-fallback";
import { emailRedirectUrl } from "@/lib/auth/safe-next-path";

const callback = (search: Record<string, string>) => {
  const url = new URL("http://localhost:3000/auth/callback");
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return url;
};

describe("callbackDestination", () => {
  test("code arrivato dalla home: la destinazione è in `n`", () => {
    const redirect = new URL(emailRedirectUrl("http://localhost:3000", "/prenota?servizio=x"));
    const n = redirect.searchParams.get("n") ?? "";
    expect(callbackDestination(callback({ code: "c", n }))).toBe("/prenota?servizio=x");
  });

  test("code arrivato su /auth/confirm: la destinazione è in `next` (URL di redirect con `n`)", () => {
    const next = emailRedirectUrl("http://localhost:3000", "/prenotazioni");
    expect(callbackDestination(callback({ code: "c", next }))).toBe("/prenotazioni");
  });

  test("`next` relativo vale così com'è; senza destinazione si torna alla home", () => {
    expect(callbackDestination(callback({ code: "c", next: "/profilo" }))).toBe("/profilo");
    expect(callbackDestination(callback({ code: "c" }))).toBe("/");
  });

  test("destinazioni esterne scartate, anche codificate", () => {
    expect(callbackDestination(callback({ code: "c", next: "//evil.example/x" }))).toBe("/");
    const evil = emailRedirectUrl("http://localhost:3000", "//evil.example/x");
    expect(callbackDestination(callback({ code: "c", next: evil }))).toBe("/");
    expect(callbackDestination(callback({ code: "c", n: Buffer.from("/\\evil").toString("base64url") }))).toBe("/");
  });
});
