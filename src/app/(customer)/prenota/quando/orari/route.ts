// Orari liberi dei giorni di "Quando?" (fetta 8g, ADR 014): ricarica in background quando la pagina
// torna visibile e nuovo tentativo su un giorno (da = a). GET e non una server action: Next esegue le server action una alla volta e una
// ricarica in corso farebbe aspettare la conferma del riepilogo. Solo orari e id dei barbieri
// (CLAUDE.md regola 6), letti con l'utente della richiesta, mai la service_role.
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { getCurrentNoShowCount, requireRole } from "@/lib/auth/current-user";
import { getWhenDays } from "@/lib/booking/availability";
import { getShopInfo } from "@/lib/booking/queries";
import { isBlockedForBooking } from "@/lib/booking/rules";
import { isValidLocalDate } from "@/lib/domain/local-time";

// Sempre calcolata alla richiesta: niente cache statica di Next.
export const dynamic = "force-dynamic";

const localDate = z.string().refine(isValidLocalDate);
const querySchema = z
  .object({ servizio: z.uuid(), da: localDate, a: localDate })
  .refine(({ da, a }) => da <= a);

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  // Stessi controlli delle pagine del flusso di prenotazione (loadBookingPageContext).
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return json({ error: "invalid" }, 400);

  // Al cliente bloccato la pagina non mostra orari: nemmeno qui.
  const [shop, noShowCount] = await Promise.all([getShopInfo(), getCurrentNoShowCount()]);
  if (!shop) return json({ error: "error" }, 500);
  if (noShowCount === null || isBlockedForBooking({ isBlocked: user.isBlocked, noShowCount }, shop.noShowBlockThreshold)) {
    return json({ error: "blocked" }, 403);
  }

  const result = await getWhenDays({ serviceId: query.data.servizio, from: query.data.da, to: query.data.a });
  if (!result.ok) return json({ error: result.error }, result.error === "invalid" ? 400 : 500);
  return json({ days: result.days });
}
