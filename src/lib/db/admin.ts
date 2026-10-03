import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Client service_role: aggira la RLS. Lo usano solo le server action degli account staff
 * (`src/lib/admin/staff-accounts.ts`), sempre dopo `requireRole(["admin"])`. Nessuna sessione
 * salvata: non tocca mai i cookie dell'utente.
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
