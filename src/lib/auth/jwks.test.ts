import { describe, expect, test, vi } from "vitest";
import { createJwksCache } from "./jwks";

vi.mock("@/lib/db/env", () => ({ supabaseEnv: () => ({ url: "http://auth.test", anonKey: "k" }) }));

const key = (kid: string) => ({ kid, kty: "EC", key_ops: ["verify"] });

describe("createJwksCache (fetta 8h, ADR 015)", () => {
  test("una sola richiesta entro la scadenza, una nuova dopo", async () => {
    const fetchKeys = vi.fn(async () => [key("a")]);
    const cache = createJwksCache(fetchKeys, 1000);
    await cache.keys(0);
    expect(await cache.keys(999)).toEqual([key("a")]);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    await cache.keys(1000);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  test("una chiave sconosciuta (rotazione) fa riscaricare al prossimo uso; una nota no", async () => {
    const fetchKeys = vi.fn(async () => [key("a")]);
    const cache = createJwksCache(fetchKeys, 60_000);
    await cache.keys(0);
    cache.seen("a");
    await cache.keys(1);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    cache.seen("b");
    await cache.keys(2);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  test("errore di scaricamento: [] e nuovo tentativo alla chiamata dopo", async () => {
    const fetchKeys = vi
      .fn<() => Promise<ReturnType<typeof key>[]>>()
      .mockRejectedValueOnce(new Error("rete"))
      .mockResolvedValueOnce([key("a")]);
    const cache = createJwksCache(fetchKeys, 60_000);
    expect(await cache.keys(0)).toEqual([]);
    expect(await cache.keys(1)).toEqual([key("a")]);
  });

  test("getClaimsCached passa le chiavi in cache a getClaims e restituisce i claim", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ keys: [key("k1")] }), { status: 200 }));
    const { getClaimsCached } = await import("./jwks");
    const getClaims = vi.fn(async () => ({ data: { claims: { sub: "u1" }, header: { kid: "k1" } } }));
    const client = { auth: { getClaims } };

    expect(await getClaimsCached(client)).toEqual({ sub: "u1" });
    expect(await getClaimsCached(client)).toEqual({ sub: "u1" });
    expect(getClaims).toHaveBeenCalledWith(undefined, { jwks: { keys: [key("k1")] } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("http://auth.test/auth/v1/.well-known/jwks.json");
    fetchSpy.mockRestore();
  });
});
