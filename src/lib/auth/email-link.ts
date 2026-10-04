import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/db/server";
import { supabaseEnv } from "@/lib/db/env";
import type { Database } from "@/lib/db/database";
import { isStaffRole } from "./access";
import { loadCurrentUser } from "./current-user";
import type { CurrentUser } from "./profile";

export type EmailLinkResult =
  | { status: "signed-in"; user: CurrentUser }
  | { status: "staff" }
  | { status: "invalid" };

type Verifier = ReturnType<typeof createEmailLinkVerifier>;
type VerifiedSession = { access_token: string; refresh_token: string };

/** Client senza cookie con cui la server action verifica il token del link (verifyOtp). */
export function createEmailLinkVerifier() {
  const { url, anonKey } = supabaseEnv();
  return createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Accesso con il link ricevuto via email, riservato ai clienti. Il token è già stato
 * verificato con un client senza cookie: la sessione arriva al browser solo dopo aver letto
 * il ruolo da profiles. Lo staff entra solo con email e password: la sessione appena creata
 * dal link viene revocata e quella eventualmente già aperta nel browser non viene toccata.
 */
export async function openCustomerSession(
  verifier: Verifier,
  session: VerifiedSession,
): Promise<EmailLinkResult> {
  const user = await loadCurrentUser(verifier);
  if (!user || isStaffRole(user.role)) {
    await verifier.auth.signOut({ scope: "local" });
    return user ? { status: "staff" } : { status: "invalid" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) return { status: "invalid" };

  return { status: "signed-in", user };
}
