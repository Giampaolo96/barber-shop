// Regressioni della review fetta 8 (scritte durante l'implementazione, non da spec-qa).
// M4: codice giusto ma sessione non aperta → messaggio dedicato. M5: disegno dell'icona solo lato
// server. M6: cache del service worker con la versione del deploy, senza costanti da aggiornare.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeEach, describe, expect, test, vi } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readText = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

const fake = vi.hoisted(() => ({
  sessionResult: { status: "invalid" } as { status: string },
  log: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-variable", style: { fontFamily: "font" } });
  return { Bodoni_Moda: font, Hanken_Grotesk: font };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ auth: {} }) }));
vi.mock("@/lib/auth/current-user", () => ({ loadCurrentUser: async () => null, requireRole: async () => null }));
vi.mock("@/lib/auth/email-link", () => ({
  createEmailLinkVerifier: () => ({
    auth: {
      verifyOtp: async () => ({ data: { session: { access_token: "a", refresh_token: "r" } }, error: null }),
    },
  }),
  openCustomerSession: async () => fake.sessionResult,
}));
vi.mock("@/lib/auth/login-code", () => ({
  checkLoginCode: async () => ({ blocked: false, remaining: 5 }),
  registerLoginCodeFailure: async () => {
    fake.log.push("failure");
    return { blocked: false, remaining: 4 };
  },
  resetLoginCode: async () => undefined,
  clearLoginCode: async () => {
    fake.log.push("clear");
  },
}));

beforeEach(() => {
  fake.sessionResult = { status: "invalid" };
  fake.log = [];
});

describe("M4: codice giusto, sessione non aperta", () => {
  const form = () => {
    const data = new FormData();
    data.set("email", "cliente@qa.test");
    data.set("token", "123456");
    return data;
  };

  test("verifyLoginCode restituisce sessionFailed, non invalid, e non conta un tentativo", async () => {
    const { verifyLoginCode } = await import("@/lib/auth/actions");
    expect(await verifyLoginCode({ status: "idle" }, form())).toEqual({ status: "sessionFailed" });
    expect(fake.log).toEqual(["clear"]);
  });

  test("il modulo mostra il messaggio dedicato, diverso da quello del formato", async () => {
    const { it } = await import("@/i18n/it");
    expect(it.auth.loginCode.sessionFailed).toMatch(/\S/);
    expect(it.auth.loginCode.sessionFailed).not.toBe(it.auth.loginCode.invalidFormat);
    expect(readText("src/components/auth/customer-login-form.tsx")).toMatch(
      /state\.status === "sessionFailed"\s*\?\s*t\.sessionFailed/,
    );
  });
});

describe("M5: disegno dell'icona solo lato server", () => {
  test("appIdentity contiene solo i colori", async () => {
    const { appIdentity } = await import("@/themes/active");
    expect(Object.keys(appIdentity).sort()).toEqual(["backgroundColor", "themeColor"]);
  });

  test("fuori dai temi solo src/lib/pwa/icons.ts (server-only) usa il disegno", () => {
    const users = ["src/app/icon.tsx", "src/app/apple-icon.tsx", "src/app/manifest.ts", "src/lib/pwa/icons.ts"].filter(
      (file) => readText(file).includes("appIconSvg"),
    );
    expect(users).toEqual(["src/lib/pwa/icons.ts"]);
    expect(readText("src/lib/pwa/icons.ts")).toMatch(/^import "server-only";/);
  });

  test("appIconDataUri è l'SVG del tema in base64", async () => {
    const { appIconDataUri } = await import("@/lib/pwa/icons");
    const { appIconSvg } = await import("@/themes/active");
    const uri = appIconDataUri();
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1] ?? "", "base64").toString()).toBe(appIconSvg());
  });
});

// ---------------------------------------------------------------------------
// M6: service worker con la versione del deploy
// ---------------------------------------------------------------------------
const ORIGIN = "https://barber.test";

/** public/sw.js in una sandbox con cache condivise tra installazioni successive. */
const runWorker = (stores: Map<string, Map<string, Response>>, scriptUrl: string) => {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) as Map<string, Response>;
      return {
        add: async (path: string) => void store.set(new URL(path, ORIGIN).href, new Response("offline")),
        put: async (request: Request, response: Response) => void store.set(request.url, response),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const sandbox: Record<string, unknown> = {
    URL,
    Response,
    caches,
    fetch: async () => new Response("rete"),
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    location: new URL(scriptUrl, ORIGIN),
  };
  sandbox.self = sandbox;
  vm.runInNewContext(readText("public/sw.js"), sandbox, { filename: "sw.js" });
  const dispatch = async (type: string) => {
    const waits: Array<Promise<unknown>> = [];
    for (const listener of listeners.get(type) ?? []) listener({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { install: () => dispatch("install"), activate: () => dispatch("activate") };
};

describe("M6: cache del service worker per deploy", () => {
  test("serviceWorkerVersion: commit del deploy, poi id del deploy, poi local", async () => {
    const { serviceWorkerVersion } = await import("@/lib/pwa/sw-version");
    expect(serviceWorkerVersion({ VERCEL_GIT_COMMIT_SHA: "a1b2c3d", VERCEL_DEPLOYMENT_ID: "dpl_X" })).toBe("a1b2c3d");
    expect(serviceWorkerVersion({ VERCEL_DEPLOYMENT_ID: "dpl_X9" })).toBe("dpl_X9");
    expect(serviceWorkerVersion({})).toBe("local");
    expect(serviceWorkerVersion({ VERCEL_GIT_COMMIT_SHA: "../<x>" })).toBe("x");
  });

  test("next.config inlinea SW_VERSION e register-sw la passa a /sw.js", async () => {
    const config = (await import("../../next.config")).default;
    expect(config.env?.SW_VERSION).toMatch(/^[\w-]+$/);
    expect(readText("src/components/pwa/register-sw.tsx")).toMatch(
      /register\(\s*"\/sw\.js" \+ serviceWorkerQuery\(process\.env\.SW_VERSION/,
    );
    const { serviceWorkerQuery } = await import("@/lib/pwa/sw-version");
    expect(serviceWorkerQuery("a1b2c3d")).toBe("?v=a1b2c3d");
  });

  test("il worker del nuovo deploy usa una cache nuova e cancella quella del deploy precedente", async () => {
    const stores = new Map<string, Map<string, Response>>();
    const first = runWorker(stores, "/sw.js?v=a1b2c3d");
    await first.install();
    await first.activate();
    const [firstCache] = [...stores.keys()];
    expect(firstCache).toContain("a1b2c3d");
    stores.get(firstCache ?? "")?.set(`${ORIGIN}/_next/static/chunks/old.js`, new Response("vecchio"));

    const second = runWorker(stores, "/sw.js?v=e4f5a6b");
    await second.install();
    await second.activate();
    expect([...stores.keys()]).toHaveLength(1);
    expect([...stores.keys()][0]).toContain("e4f5a6b");
    expect([...(stores.values().next().value?.keys() ?? [])]).toEqual([`${ORIGIN}/offline`]);
  });

  test("senza ?v= (o con caratteri non ammessi) il worker funziona con una versione di ripiego", async () => {
    for (const [script, cache] of [
      ["/sw.js", "barber-shop-static-local"],
      ["/sw.js?v=%3Cx%3E", "barber-shop-static-x"],
    ]) {
      const stores = new Map<string, Map<string, Response>>();
      await runWorker(stores, script ?? "").install();
      expect([...stores.keys()]).toEqual([cache]);
    }
  });
});
