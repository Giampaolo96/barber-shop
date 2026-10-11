import "server-only";

// Lettura comune alla pagina di conferma e al file .ics (fetta 8b): stessa validazione dell'id,
// stessa lettura con RLS (mai la service role) e stessa regola "in programma".
import { z } from "zod";
import { getOwnBooking, getShopInfo, type OwnBooking, type ShopInfo } from "./queries";
import { isUpcoming } from "./rules";

export type OwnUpcomingBooking =
  | { status: "ok"; booking: OwnBooking; shop: ShopInfo }
  /** Id non valido, prenotazione inesistente o di un altro cliente. */
  | { status: "not_found" }
  /** Prenotazione propria cancellata, completata o già iniziata. */
  | { status: "not_upcoming" }
  /** Lettura non riuscita (prenotazione o impostazioni del negozio). */
  | { status: "error" };

export async function loadOwnUpcomingBooking(customerId: string, rawId: string, now: Date): Promise<OwnUpcomingBooking> {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { status: "not_found" };

  const [result, shop] = await Promise.all([getOwnBooking(customerId, id.data), getShopInfo()]);
  if (!result.ok || !shop) return { status: "error" };
  if (!result.booking) return { status: "not_found" };
  if (!isUpcoming(result.booking, now)) return { status: "not_upcoming" };
  return { status: "ok", booking: result.booking, shop };
}
