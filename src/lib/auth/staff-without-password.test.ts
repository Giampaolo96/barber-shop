// Migliorie della review della fetta 8h: staff senza password e bloccato (proxy) e link all'area
// staff nell'area cliente.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const fake = vi.hoisted(() => ({
  amr: [] as unknown,
  profile: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const USER_ID = "e8000000-0000-4000-8000-0000000080b1";
const fakeClient = vi.hoisted(() => () => {
  const query: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "maybeSingle" || property === "single") return async () => ({ data: fake.profile, error: null });
        if (property === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        return () => query;
      },
    },
  );
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "e8000000-0000-4000-8000-0000000080b1" } }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: "e8000000-0000-4000-8000-0000000080b1", amr: fake.amr }, header: {} },
        error: null,
      }),
    },
    from: () => query,
    rpc: () => query,
  };
});
vi.mock("@/lib/db/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => fakeClient(), createBrowserClient: () => fakeClient() }));
vi.mock("@/lib/db/env", () => ({ supabaseEnv: () => ({ url: "http://127.0.0.1:1", anonKey: "anon-key" }) }));
vi.mock("@/lib/booking/queries", () => ({ getShopInfo: async () => null }));
vi.mock("@/themes/active", () => ({ AmbientBackground: () => null }));

const OTP = [{ method: "otp", timestamp: 1794000000 }];
const PASSWORD = [{ method: "password", timestamp: 1794000000 }];

const signIn = (role: string, amr: unknown, isBlocked = false): void => {
  fake.amr = amr;
  fake.profile = {
    id: USER_ID,
    role,
    is_blocked: isBlocked,
    full_name: "Staff di prova",
    phone: "+39 333 0000081",
    privacy_consent_at: "2026-10-02T10:00:00+00:00",
    privacy_policy_version: "2026-10",
    marketing_consent: false,
    marketing_consent_at: null,
    no_show_count: 0,
  };
};

beforeEach(() => {
  fake.profile = null;
  vi.resetModules();
});

describe("proxy: staff bloccato e senza password", () => {
  test("motivo=disabilitato, non password", async () => {
    signIn("admin", OTP, true);
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest("http://localhost:3000/admin"));
    const to = new URL(response.headers.get("location") ?? "", "http://localhost:3000");
    expect(to.pathname).toBe("/admin/login");
    expect(to.searchParams.get("motivo")).toBe("disabilitato");
  });
});

describe("area cliente: link all'area staff", () => {
  const renderLayout = async (): Promise<string> => {
    const { default: Layout } = await import("@/app/(customer)/layout");
    return renderToStaticMarkup(await Layout({ children: createElement("p", null, "contenuto") }));
  };

  test.each(["admin", "barber"])("%s con codice email: nessun link a /admin", async (role) => {
    signIn(role, OTP);
    expect(await renderLayout()).not.toContain('href="/admin"');
  });

  test("admin con password: link a /admin", async () => {
    signIn("admin", PASSWORD);
    expect(await renderLayout()).toContain('href="/admin"');
  });
});
