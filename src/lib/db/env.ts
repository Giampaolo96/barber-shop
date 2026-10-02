// URL e chiave pubblica di Supabase lato server (la chiave pubblica è protetta dalla RLS).
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY mancanti: vedi .env.example",
    );
  }
  return { url, anonKey };
}
