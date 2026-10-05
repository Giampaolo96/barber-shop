import "server-only";

// Orari del negozio e chiusure di oggi per la home pubblica (fetta 8a), tramite le funzioni
// shop_opening_hours e shop_closures_today (nessun dato dei singoli barbieri).
import { createClient } from "@/lib/db/server";
import type { OpeningHours, ShopClosure } from "./opening";

/** null se non è stato possibile leggerli: la home li omette invece di mostrare dati sbagliati. */
export async function getOpeningData(): Promise<{ hours: OpeningHours[]; closures: ShopClosure[] } | null> {
  const supabase = await createClient();
  const [hours, closures] = await Promise.all([
    supabase.rpc("shop_opening_hours"),
    supabase.rpc("shop_closures_today"),
  ]);
  if (hours.error || closures.error || !hours.data || !closures.data) {
    console.error("getOpeningData", hours.error?.code, closures.error?.code);
    return null;
  }
  return {
    hours: hours.data.map((row) => ({
      weekday: row.weekday,
      start: row.start_time.slice(0, 5),
      end: row.end_time.slice(0, 5),
    })),
    closures: closures.data.map((row) => ({ startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) })),
  };
}
