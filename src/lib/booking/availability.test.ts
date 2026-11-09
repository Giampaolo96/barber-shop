import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }), headers: async () => new Headers() }));

const { inputRowsSchema } = await import("./availability");
const row = (starts_at: string, ends_at = "2026-11-09T10:00:00+00:00") => [
  { kind: "busy", barber_id: null, starts_at, ends_at },
];

describe("inputRowsSchema: date ISO con offset", () => {
  test.each(["2026-11-09T09:00:00+00:00", "2026-11-09T09:00:00.123456+01:00", "2026-11-09T09:00:00Z"])(
    "accetta %s (formato di timestamptz in jsonb)",
    (value) => expect(inputRowsSchema.safeParse(row(value)).success).toBe(true),
  );

  test.each(["", "domani", "2026-11-09", "2026-11-09T09:00:00", "2026-13-40T09:00:00+00:00"])(
    "rifiuta %j",
    (value) => {
      expect(inputRowsSchema.safeParse(row(value)).success).toBe(false);
      expect(inputRowsSchema.safeParse(row("2026-11-09T09:00:00+00:00", value)).success).toBe(false);
    },
  );
});
