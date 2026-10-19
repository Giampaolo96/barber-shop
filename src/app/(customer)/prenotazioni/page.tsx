import Link from "next/link";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";
import { it } from "@/i18n/it";
import { formatDateTime, telHref } from "@/lib/booking/format";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { BOOK_PATH, MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { getMyBookings, type MyBooking } from "@/lib/booking/queries";
import { canCancel, splitBookings } from "@/lib/booking/rules";
import { formatCents } from "@/lib/domain/money";
import { fillText } from "@/lib/admin/text";
import { EmptyMark } from "@/themes/active";

// "Le mie prenotazioni" (SPEC §5.3): future e passate; cancellazione fino a cancel_limit_min prima,
// poi "Chiama il negozio". Senza future confermate c'è "Prenota" (anche con passate o cancellate).
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
  // Stesso stile del "Prenota" della home.
  const bookLink = (
    <Link
      href={BOOK_PATH}
      className="flex h-14 w-full items-center justify-center border-[4px] border-double border-ink font-display text-2xl transition-colors hover:bg-ink hover:text-surface active:bg-ink active:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t.emptyCta}
    </Link>
  );

  const item = (booking: MyBooking, actions: React.ReactNode) => (
    <li key={booking.id} className="flex flex-col gap-2 border border-line p-4">
      <p className="font-display text-2xl leading-tight first-letter:uppercase">
        {formatDateTime(booking.startsAt, shop.timezone)}
      </p>
      <p>{fillText(it.home.withBarber, { service: booking.serviceName, barber: booking.barberName })}</p>
      <p className="text-sm text-muted-foreground">
        {formatCents(booking.priceCents)}, {t.status[booking.status as keyof typeof t.status] ?? booking.status}
      </p>
      {actions}
    </li>
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      {esito === "cancellata" && <p role="status" className="border border-ink p-4">{t.cancelled}</p>}

      {bookings === null && (
        <div role="alert" className="flex flex-col gap-3 border-l-2 border-destructive p-4">
          <p>{it.booking.errors.listLoad}</p>
          <Link
            href={MY_BOOKINGS_PATH}
            className="inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
          >
            {it.booking.errors.retry}
          </Link>
        </div>
      )}

      {bookings !== null && bookings.length === 0 && (
        <div className="flex flex-col items-start gap-4 border-y-[3px] border-double border-ink py-8">
          <EmptyMark className="size-10" />
          <p className="font-display text-2xl leading-snug">{t.empty}</p>
          {bookLink}
        </div>
      )}

      {bookings !== null && bookings.length > 0 && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl">{t.upcoming}</h2>
            {upcoming.length === 0 ? (
              <div className="flex flex-col gap-4 py-2">
                <p>{t.noUpcoming}</p>
                {bookLink}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((booking) =>
                  item(
                    booking,
                    canCancel(new Date(booking.startsAt), now, shop.cancelLimitMin) ? (
                      <CancelBookingButton bookingId={booking.id} />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm text-muted-foreground">{t.tooLateHint}</p>
                        {tel && (
                          <a href={tel} className="inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface">
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
            <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl">{t.past}</h2>
            {past.length === 0 ? (
              <p className="text-muted-foreground">{t.none}</p>
            ) : (
              <ul className="flex flex-col gap-2">{past.map((booking) => item(booking, null))}</ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
