import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";
import type { Database } from "./database";

/**
 * Client service_role: aggira la RLS. Lo usano solo le server action degli account staff
 * (`src/lib/admin/staff-accounts.ts`), sempre dopo `requireRole(["admin"])`, e il limite dei
 * tentativi del login con codice (`src/lib/auth/login-code.ts`, solo le rpc `login_code_*`).
 * Nessuna sessione salvata: non tocca mai i cookie dell'utente.
 */
export function createAdminClient() {
  const { url } = supabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY mancante: vedi .env.example");
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
