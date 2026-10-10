// Regressione del bug in produzione su Safari iOS (dopo la fetta 8, scritta durante la correzione,
// non da spec-qa): con una sessione revocata ma ancora nei cookie, il proxy (getClaims) vedeva un
// cliente e rimandava /accedi e /admin/login alla home, mentre le pagine (getUser) vedevano un
// anonimo. Il proxy ora conferma la sessione prima di un redirect dovuto all'utente loggato.
import { describe, expect, test, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/profile";
import { isAuthTokenCookie, resolveAccess, type SessionCheck, sessionIsGone } from "@/lib/auth/stale-session";

const customer: CurrentUser = { id: "c1", role: "customer", isBlocked: false, profileComplete: true };
const admin: CurrentUser = { id: "a1", role: "admin", isBlocked: false, profileComplete: true };

const check = (result: SessionCheck) => vi.fn(async () => result);

describe("resolveAccess: conferma della sessione solo prima di un redirect da utente loggato", () => {
  test("anonimo: nessuna conferma, decisione invariata", async () => {
    const confirm = check("gone");
    expect(await resolveAccess("/prenota", null, confirm)).toEqual({
      decision: { type: "redirect", to: "/accedi" },
      user: null,
      clearAuthCookies: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  test.each(["/", "/prenota", "/prenotazioni", "/profilo"])("cliente su %s (consentito): nessuna conferma", async (path) => {
    const confirm = check("gone");
    const result = await resolveAccess(path, customer, confirm);
    expect(result.decision).toEqual({ type: "allow" });
    expect(result.clearAuthCookies).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  test.each([
    ["/accedi", customer],
    ["/admin/login", customer],
    ["/admin", customer],
    ["/accedi", admin],
    ["/profilo/completa", admin],
  ] as const)("sessione che non esiste più su %s: decisione da anonimo e cookie da cancellare", async (path, user) => {
    const confirm = check("gone");
    const result = await resolveAccess(path, user, confirm);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result.user).toBeNull();
    expect(result.clearAuthCookies).toBe(true);
    expect(result.decision).toEqual(
      path === "/admin" ? { type: "redirect", to: "/admin/login" } : path === "/profilo/completa" ? { type: "redirect", to: "/accedi" } : { type: "allow" },
    );
  });

  test("sessione valida: resta il redirect del cliente da /accedi alla home", async () => {
    expect(await resolveAccess("/accedi", customer, check("valid"))).toEqual({
      decision: { type: "redirect", to: "/" },
      user: customer,
      clearAuthCookies: false,
    });
  });

  test("conferma senza risposta (rete): resta la decisione di partenza, cookie intatti", async () => {
    expect(await resolveAccess("/admin/login", customer, check("unknown"))).toEqual({
      decision: { type: "redirect", to: "/" },
      user: customer,
      clearAuthCookies: false,
    });
  });
});

describe("sessionIsGone", () => {
  test.each([
    [{ status: 403, code: "session_not_found" }, true],
    [{ status: 404, code: "user_not_found" }, true],
    [{ status: 403, code: "bad_jwt" }, true],
    [{ status: 401 }, true],
    // Quello che arriva davvero da supabase-js con una sessione revocata
    [{ status: 400, name: "AuthSessionMissingError" }, true],
    [{ status: 400, code: "validation_failed", name: "AuthApiError" }, false],
    [{ status: 500, code: "unexpected_failure" }, false],
    [{ status: 0, code: "AuthRetryableFetchError" }, false],
    [null, false],
  ])("%o → %s", (error, gone) => {
    expect(sessionIsGone(error)).toBe(gone);
  });
});

describe("isAuthTokenCookie", () => {
  test.each([
    ["sb-hughgiftxsdvintaoceo-auth-token", true],
    ["sb-127-auth-token", true],
    ["sb-127-auth-token.0", true],
    ["sb-127-auth-token.1", true],
    ["sb-127-auth-token-code-verifier", false],
    ["sb-127-auth-token-flow-d8f3-code-verifier", false],
    ["_vercel_sso_nonce", false],
  ])("%s → %s", (name, expected) => {
    expect(isAuthTokenCookie(name)).toBe(expected);
  });
});
