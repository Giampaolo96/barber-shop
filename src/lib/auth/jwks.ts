import type { JWK } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/db/env";

/** Durata della cache delle chiavi pubbliche di Supabase Auth. */
export const JWKS_TTL_MS = 10 * 60_000;

type Fetcher = () => Promise<JWK[]>;

/**
 * Cache delle chiavi pubbliche (JWKS) condivisa fra le richieste dello stesso processo (ADR 015):
 * ogni client Supabase è nuovo a ogni richiesta e senza cache scaricherebbe le chiavi ogni volta.
 * Scade dopo `ttlMs`; una chiave sconosciuta (rotazione) la invalida, e intanto getClaims la
 * scarica da sé, quindi nessuno resta bloccato. Un errore di scaricamento dà [] (getClaims fa da sé).
 */
export function createJwksCache(fetchKeys: Fetcher, ttlMs = JWKS_TTL_MS) {
  let cached: { keys: JWK[]; at: number } | null = null;
  return {
    async keys(now = Date.now()): Promise<JWK[]> {
      if (cached && now - cached.at < ttlMs) return cached.keys;
      try {
        cached = { keys: await fetchKeys(), at: now };
        return cached.keys;
      } catch {
        cached = null;
        return [];
      }
    },
    /** Dopo una verifica con una chiave `kid` assente dalla cache: al prossimo uso si riscarica. */
    seen(kid: string | undefined): void {
      if (cached && kid && !cached.keys.some((key) => key.kid === kid)) cached = null;
    },
  };
}

type ClaimsClient = {
  auth: {
    getClaims: (
      jwt?: string,
      options?: { jwks?: { keys: JWK[] } },
    ) => Promise<{ data: { claims: Record<string, unknown>; header?: { kid?: string } } | null }>;
  };
};

const shared = createJwksCache(async () => {
  const response = await fetch(`${supabaseEnv().url}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  return ((await response.json()) as { keys?: JWK[] }).keys ?? [];
});

/** getClaims() con le chiavi della cache condivisa; claim null se il token non è valido. */
export async function getClaimsCached(supabase: ClaimsClient): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.auth.getClaims(undefined, { jwks: { keys: await shared.keys() } });
  shared.seen(data?.header?.kid);
  return data?.claims ?? null;
}
