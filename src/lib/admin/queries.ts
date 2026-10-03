import "server-only";

// Letture ricorrenti dell'area admin, sempre con il client dell'utente (RLS attiva).
import type { createClient } from "@/lib/db/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Timezone del negozio (shop_settings.timezone): mai quella del server (CLAUDE.md regola 2). */
export async function getShopTimezone(supabase: ServerClient): Promise<string> {
  const { data, error } = await supabase.from("shop_settings").select("timezone").single();
  if (error) throw new Error(`impostazioni non leggibili: ${error.code}`);
  return data.timezone;
}

/**
 * Prenotazioni confermate future (starts_at > now) di un servizio o di un barbiere.
 * `null` se il conteggio non è riuscito: l'avviso non deve sparire in silenzio.
 */
export async function countFutureConfirmed(
  supabase: ServerClient,
  column: "service_id" | "barber_id",
  id: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq(column, id)
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString());
  return error || count === null ? null : count;
}

/**
 * Prenotazioni confermate il cui intervallo [starts_at, ends_at) si sovrappone a [start, end):
 * di un barbiere (assenze) o di tutti (chiusure). Il buffer non conta. `null` se il conteggio
 * non è riuscito.
 */
export async function countConfirmedOverlapping(
  supabase: ServerClient,
  startsAt: Date,
  endsAt: Date,
  barberId?: string,
): Promise<number | null> {
  let query = supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed")
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());
  if (barberId !== undefined) query = query.eq("barber_id", barberId);
  const { count, error } = await query;
  return error || count === null ? null : count;
}

/** Barbiere collegato all'utente corrente (anche un admin barbiere), oppure null. */
export async function getOwnBarberId(supabase: ServerClient): Promise<string | null> {
  const { data } = await supabase.rpc("current_barber_id");
  return data ?? null;
}
