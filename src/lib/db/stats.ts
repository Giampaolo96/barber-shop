import "server-only";

// Letture delle statistiche (SPEC §6.9, ADR 010) con il client della richiesta: i gruppi da
// admin_booking_stats (solo admin, verificato nel database), nomi e stato di barbieri e servizi
// dalla RLS, che all'admin mostra anche quelli disattivati.
import { z } from "zod";
import type { createClient } from "@/lib/db/server";
import { BOOKING_STATUSES, type StatsGroup } from "@/lib/stats/aggregate";

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
