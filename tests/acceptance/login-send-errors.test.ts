// Regressioni dopo la CI rossa della fetta 8 (scritte durante la correzione, non da spec-qa).
// Quando Supabase rifiuta l'invio dell'email, /accedi non deve far credere che sia partita;
// in locale e in CI l'intervallo minimo tra due email è più basso di un secondo.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readText = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const fake = vi.hoisted(() => ({
  signInError: null as null | { message: string; code?: string; status?: number },
  log: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "http://localhost:3000" }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { signInWithOtp: async () => ({ data: {}, error: fake.signInError }) },
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({ loadCurrentUser: async () => null, requireRole: async () => null }));
vi.mock("@/lib/auth/email-link", () => ({ createEmailLinkVerifier: () => ({}), openCustomerSession: async () => null }));
vi.mock("@/lib/auth/login-code", () => ({
  checkLoginCode: async () => ({ blocked: false, remaining: 5 }),
  registerLoginCodeFailure: async () => ({ blocked: false, remaining: 4 }),
  resetLoginCode: async () => {
    fake.log.push("reset");
  },
  clearLoginCode: async () => undefined,
}));

beforeEach(() => {
  fake.signInError = null;
  fake.log = [];
});

const send = async () => {
  const { requestMagicLink } = await import("@/lib/auth/actions");
  const data = new FormData();
  data.set("email", "cliente@qa.test");
  return requestMagicLink({ status: "idle" }, data);
};

describe("requestMagicLink: esito reale dell'invio", () => {
  test("email partita: sent e contatore del codice azzerato", async () => {
    expect(await send()).toEqual({ status: "sent" });
    expect(fake.log).toEqual(["reset"]);
  });

  test("intervallo minimo o tetto orario di Supabase (429): rateLimited, nessun azzeramento", async () => {
    for (const error of [
      { message: "For security purposes, you can only request this after 59 seconds.", code: "over_email_send_rate_limit", status: 429 },
      { message: "Email rate limit exceeded", status: 429 },
    ]) {
      fake.signInError = error;
      expect(await send()).toEqual({ status: "rateLimited" });
    }
    expect(fake.log).toEqual([]);
  });

  test("altri errori (SMTP, rete): error, nessun azzeramento", async () => {
    fake.signInError = { message: "Error sending magic link email", code: "unexpected_failure", status: 500 };
    expect(await send()).toEqual({ status: "error" });
    expect(fake.log).toEqual([]);
  });
});

describe("Modulo di /accedi", () => {
  test("messaggi dedicati, diversi dalla conferma di invio", async () => {
    const { it } = await import("@/i18n/it");
    const t = it.auth.customerLogin;
    expect(t.rateLimited).toMatch(/\S/);
    expect(t.sendFailed).toMatch(/\S/);
    expect(new Set([t.rateLimited, t.sendFailed, t.linkSent]).size).toBe(3);
  });

  test('il campo del codice compare solo con status "sent"; gli errori di invio si mostrano come alert', () => {
    const code = readText("src/components/auth/customer-login-form.tsx");
    expect(code.match(/setSent\(\{/g)).toHaveLength(1);
    expect(code).toMatch(/if \(result\.status === "sent"\) setSent\(\{/);
    expect(code).toMatch(/state\.status === "rateLimited"\) return it\.auth\.customerLogin\.rateLimited/);
    expect(code).toMatch(/state\.status === "error"\) return it\.auth\.customerLogin\.sendFailed/);
  });
});

describe("supabase/config.toml (solo locale e CI)", () => {
  test("max_frequency sotto il secondo e mai 0 (Supabase lo tratterebbe come 60 s)", () => {
    const value = readText("supabase/config.toml").match(/^max_frequency = "(\d+)(ms|s)"/m);
    expect(value, "max_frequency di [auth.email]").not.toBeNull();
    const ms = Number(value?.[1]) * (value?.[2] === "s" ? 1000 : 1);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});
