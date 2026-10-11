// "Aggiungi al calendario" (fetta 8b): file iCalendar di una prenotazione propria, confermata e
// futura. Lettura con l'utente della richiesta (RLS), mai la service role; l'UID non dipende dal
// dominio, così un nuovo download aggiorna l'evento invece di duplicarlo.
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { buildBookingIcs } from "@/lib/booking/ics";
import { getOwnBooking, getShopInfo } from "@/lib/booking/queries";
import { isUpcoming } from "@/lib/booking/rules";
import { calendarUidHost } from "@/themes/active";

const notFound = () => new Response(null, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["customer"]);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();

  const [result, shop] = await Promise.all([getOwnBooking(user.id, id.data), getShopInfo()]);
  if (!result.ok || !shop) return new Response(null, { status: 500 });
  const now = new Date();
  if (!result.booking || !isUpcoming(result.booking, now)) return notFound();

  const body = buildBookingIcs({
    id: result.booking.id,
    startsAt: result.booking.startsAt,
    endsAt: result.booking.endsAt,
    serviceName: result.booking.serviceName,
    shopName: shop.name,
    address: shop.address,
    now,
    uidHost: calendarUidHost,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="prenotazione.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}
