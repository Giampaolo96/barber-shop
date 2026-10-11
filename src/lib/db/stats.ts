import "server-only";

// Letture delle statistiche (SPEC §6.9, ADR 010) con il client della richiesta: i gruppi da
// admin_booking_stats (solo admin, verificato nel database), nomi e stato di barbieri e servizi
// dalla RLS, che all'admin mostra anche quelli disattivati.
import { z } from "zod";
import type { createClient } from "@/lib/db/server";
import { addDays, startOfLocalDay } from "@/lib/domain/local-time";
import { BOOKING_STATUSES, type StatsGroup } from "@/lib/stats/aggregate";
import { isDemoNote } from "@/lib/stats/demo";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type StatsCatalogItem = { id: string; name: string; isActive: boolean };

const count = z.number().int().nonnegative();
const groupsSchema = z.array(
  z.object({
    day: z.iso.date(),
    barber_id: z.uuid(),
    service_id: z.uuid(),
    status: z.enum(BOOKING_STATUSES),
    started: z.boolean(),
    bookings: count,
    revenue_cents: count,
  }),
);

const fail = (what: string, error: { code?: string; message?: string } | null): never => {
  throw new Error(`${what} non leggibili: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
};

export async function getBookingStats(
  supabase: ServerClient,
  period: { from: string; to: string; excludeDemo: boolean },
): Promise<StatsGroup[]> {
  const { data, error } = await supabase.rpc("admin_booking_stats", {
    p_from: period.from,
    p_to: period.to,
    p_exclude_demo: period.excludeDemo,
  });
  if (error) return fail("statistiche", error);
  return groupsSchema.parse(data);
}

export async function getStatsCatalog(
  supabase: ServerClient,
): Promise<{ barbers: StatsCatalogItem[]; services: StatsCatalogItem[] }> {
  const [barbers, services] = await Promise.all([
    supabase.from("barbers").select("id, display_name, is_active").order("display_name"),
    supabase.from("services").select("id, name, is_active").order("sort_order").order("name"),
  ]);
  if (barbers.error) return fail("barbieri", barbers.error);
  if (services.error) return fail("servizi", services.error);
  return {
    barbers: barbers.data.map((row) => ({ id: row.id, name: row.display_name, isActive: row.is_active })),
    services: services.data.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active })),
  };
}

/** Righe massime dell'elenco "Da aggiornare". */
export const TO_UPDATE_LIMIT = 200;

export type BookingToUpdate = {
  id: string;
  startsAt: Date;
  barberName: string;
  customerName: string;
  serviceName: string;
};

/**
 * "Da aggiornare": prenotazioni già iniziate ancora `confirmed`, con giorno locale nel periodo
 * (stessa regola del riquadro, ADR 010), dalla più vecchia. `truncated` se ce ne sono altre.
 */
export async function getBookingsToUpdate(
  supabase: ServerClient,
  filters: { from: string; to: string; barberId: string | null; excludeDemo: boolean; timezone: string; now: Date },
): Promise<{ bookings: BookingToUpdate[]; truncated: boolean }> {
  const startsFrom = startOfLocalDay(filters.from, filters.timezone);
  const startsBefore = startOfLocalDay(addDays(filters.to, 1), filters.timezone);
  let query = supabase
    .from("bookings")
    .select(
      "id, starts_at, notes, guest_name, barber:barbers(display_name), service:services(name), customer:profiles!bookings_customer_id_fkey(full_name)",
    )
    .eq("status", "confirmed")
    .gte("starts_at", startsFrom.toISOString())
    .lt("starts_at", startsBefore.toISOString())
    .lte("starts_at", filters.now.toISOString())
    .order("starts_at")
    .order("id")
    .limit(TO_UPDATE_LIMIT + 1);
  if (filters.barberId) query = query.eq("barber_id", filters.barberId);
  const { data, error } = await query;
  if (error) return fail("prenotazioni da aggiornare", error);

  const rows = data.filter((row) => !(filters.excludeDemo && isDemoNote(row.notes)));
  return {
    bookings: rows.slice(0, TO_UPDATE_LIMIT).map((row) => ({
      id: row.id,
      startsAt: new Date(row.starts_at),
      barberName: row.barber?.display_name ?? "",
      customerName: row.guest_name ?? row.customer?.full_name ?? "",
      serviceName: row.service?.name ?? "",
    })),
    truncated: data.length > TO_UPDATE_LIMIT,
  };
}
