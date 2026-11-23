import { beforeEach, describe, expect, test, vi } from "vitest";

// acceptPrivacyUpdate (fetta 9b, review): ruolo, profilo completo, schema Zod e `next` sicuro.
const fake = vi.hoisted(() => ({
  log: [] as string[],
  user: { id: "u1", role: "customer", isBlocked: false, profileComplete: true } as Record<string, unknown>,
  cookies: [] as Array<{ name: string; options: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, _value: string, options: unknown) => fake.cookies.push({ name, options }),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("./current-user", () => ({
  requireRole: async (roles: string[]) => {
    fake.log.push(`requireRole:${roles.join(",")}`);
    return fake.user;
  },
}));
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({ maybeSingle: async () => ({ data: { privacy_policy_version: "2026-12" } }) }),
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            fake.log.push(`update:${table}:${JSON.stringify(values)}`);
            return { data: [{ id: "u1" }], error: null };
          },
        }),
      }),
    }),
  }),
}));

const { acceptPrivacyUpdate } = await import("./account-actions");

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const run = async (values: Record<string, string>): Promise<{ state?: unknown; redirect?: string }> => {
  try {
    return { state: await acceptPrivacyUpdate({ status: "idle" }, form(values)) };
  } catch (error) {
    return { redirect: (error as { to?: string }).to };
  }
};

beforeEach(() => {
  fake.log = [];
  fake.user = { id: "u1", role: "customer", isBlocked: false, profileComplete: true };
});

describe("acceptPrivacyUpdate", () => {
  test("solo il cliente, con la casella: versione corrente e ritorno a next", async () => {
    expect(await run({ privacyConsent: "on", next: "/prenota" })).toEqual({ redirect: "/prenota" });
    expect(fake.log).toEqual(['requireRole:customer', 'update:profiles:{"privacy_policy_version":"2026-12"}']);
  });

  test.each<Record<string, string>>([{}, { privacyConsent: "true" }, { privacyConsent: "" }])("casella assente o non valida: %o", async (values) => {
    expect(await run(values)).toEqual({ state: { status: "invalid" } });
    expect(fake.log.some((entry) => entry.startsWith("update:"))).toBe(false);
  });

  test("profilo incompleto: a /profilo/completa, nessun consenso registrato qui", async () => {
    fake.user = { ...fake.user, profileComplete: false };
    expect(await run({ privacyConsent: "on" })).toEqual({ redirect: "/profilo/completa" });
    expect(fake.log.some((entry) => entry.startsWith("update:"))).toBe(false);
  });

  test("next esterno o troppo lungo: si torna alla home", async () => {
    expect(await run({ privacyConsent: "on", next: "//evil.example" })).toEqual({ redirect: "/" });
    expect(await run({ privacyConsent: "on", next: `/${"a".repeat(3000)}` })).toEqual({ redirect: "/" });
  });
});
