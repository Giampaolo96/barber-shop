import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database";

/** Client per i componenti "use client": solo URL e chiave pubblica. */
export function createClient() {
  // Accesso statico a process.env: Next include nel bundle solo le variabili lette così.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY mancanti: vedi .env.example",
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
