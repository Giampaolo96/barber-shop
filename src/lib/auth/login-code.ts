import "server-only";

import { createAdminClient } from "@/lib/db/admin";

// Limite dei tentativi del login con codice (ADR 009): i contatori stanno nel database, per hash
// dell'email normalizzata. Le funzioni sono eseguibili solo dalla service_role. Modulo server-only
// e non "use server": nessuna di queste funzioni deve diventare chiamabile dal browser.

export type LoginCodeLimit = { blocked: boolean; remaining: number };

type LimitResult = {
  data: Array<{ blocked: boolean; remaining: number }> | null;
  error: { code: string } | null;
};

function limitFrom(rpc: string, { data, error }: LimitResult): LoginCodeLimit {
  const row = data?.[0];
  if (error || !row) throw new Error(`${rpc}: ${error?.code ?? "nessuna riga"}`);
  return { blocked: row.blocked, remaining: row.remaining };
}

function ensureOk(rpc: string, { error }: { error: { code: string } | null }): void {
  if (error) throw new Error(`${rpc}: ${error.code}`);
}

/** Tentativi ancora ammessi per questa email. */
export async function checkLoginCode(email: string): Promise<LoginCodeLimit> {
  return limitFrom("login_code_check", await createAdminClient().rpc("login_code_check", { p_email: email }));
}

/** Conta un codice sbagliato e restituisce lo stato dopo l'errore. */
export async function registerLoginCodeFailure(email: string): Promise<LoginCodeLimit> {
  return limitFrom(
    "login_code_register_failure",
    await createAdminClient().rpc("login_code_register_failure", { p_email: email }),
  );
}

/** Nuovo codice inviato: riparte il contatore del codice, il tetto orario resta. */
export async function resetLoginCode(email: string): Promise<void> {
  ensureOk("login_code_reset", await createAdminClient().rpc("login_code_reset", { p_email: email }));
}

/** Codice giusto: azzera entrambi i contatori. */
export async function clearLoginCode(email: string): Promise<void> {
  ensureOk("login_code_clear", await createAdminClient().rpc("login_code_clear", { p_email: email }));
}
