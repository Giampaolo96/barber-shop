import Link from "next/link";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";
import { it } from "@/i18n/it";
import { formatDateTime, telHref } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { getMyBookings, type MyBooking } from "@/lib/booking/queries";
import { canCancel, splitBookings } from "@/lib/booking/rules";
import { formatCents } from "@/lib/domain/money";

// "Le mie prenotazioni" (SPEC §5.3): future e passate; cancellazione fino a cancel_limit_min prima,
// poi "Chiama il negozio".
export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ esito?: string }>;
}) {
  const { user, shop } = await loadBookingPageContext();
  const { esito } = await searchParams;
  const t = it.booking.list;
  const now = new Date();
  const bookings = await getMyBookings(user.id);
  const { upcoming, past } = splitBookings(bookings ?? [], now);
  const tel = telHref(shop.phone);

  const item = (booking: MyBooking, actions: React.ReactNode) => (
    <li key={booking.id} className="flex flex-col gap-2 rounded-xl border p-4">
      <p>
        <span className="font-medium">{booking.serviceName}</span> · {booking.barberName}
      </p>
      <p className="first-letter:uppercase">{formatDateTime(booking.startsAt, shop.timezone)}</p>
      <p className="text-sm opacity-70">
        {formatCents(booking.priceCents)} · {t.status[booking.status as keyof typeof t.status] ?? booking.status}
      </p>
      {actions}
    </li>
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {esito === "confermata" && <p role="status" className="rounded-xl border p-3">{t.confirmed}</p>}
      {esito === "cancellata" && <p role="status" className="rounded-xl border p-3">{t.cancelled}</p>}

      {bookings === null && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border p-4">
          <p>{it.booking.errors.listLoad}</p>
          <Link
            href={MY_BOOKINGS_PATH}
            className="inline-flex h-11 w-fit items-center rounded-lg border px-4 text-sm font-medium"
          >
            {it.booking.errors.retry}
          </Link>
        </div>
      )}

      {bookings !== null && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t.upcoming}</h2>
            {upcoming.length === 0 ? (
              <p className="opacity-70">{t.none}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((booking) =>
                  item(
                    booking,
                    canCancel(new Date(booking.startsAt), now, shop.cancelLimitMin) ? (
                      <CancelBookingButton bookingId={booking.id} />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm opacity-70">{t.tooLateHint}</p>
                        {tel && (
                          <a href={tel} className="inline-flex h-11 w-fit items-center rounded-lg border px-4 text-sm font-medium">
                            {t.callShop}
                          </a>
                        )}
                      </div>
                    ),
                  ),
                )}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t.past}</h2>
            {past.length === 0 ? (
              <p className="opacity-70">{t.none}</p>
            ) : (
              <ul className="flex flex-col gap-2">{past.map((booking) => item(booking, null))}</ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
