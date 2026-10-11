// "Aggiungi al calendario" (fetta 8b): file iCalendar di una prenotazione propria, confermata e
// futura. Lettura con l'utente della richiesta (RLS), mai la service role; l'UID non dipende dal
// dominio, così un nuovo download aggiorna l'evento invece di duplicarlo.
import { redirect } from "next/navigation";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { buildBookingIcs } from "@/lib/booking/ics";
import { loadOwnUpcomingBooking } from "@/lib/booking/own-booking";
import { calendarUidHost } from "@/themes/active";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Stessi controlli della pagina di conferma.
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const now = new Date();
  const result = await loadOwnUpcomingBooking(user.id, (await params).id, now);
  if (result.status === "error") return new Response(null, { status: 500 });
  if (result.status !== "ok") return new Response(null, { status: 404 });

  const { booking, shop } = result;
  const body = buildBookingIcs({
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    serviceName: booking.serviceName,
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
