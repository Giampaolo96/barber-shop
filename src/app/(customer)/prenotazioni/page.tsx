import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";
import { it } from "@/i18n/it";
import { formatDateTime, telHref } from "@/lib/booking/format";
import { getVerifiedUserId } from "@/lib/auth/current-user";
import { loadBookingPageContext } from "@/lib/booking/page-context";
import { BOOK_PATH, MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { MY_BOOKINGS_LIMIT, getMyBookings, type MyBooking, type MyBookings } from "@/lib/booking/queries";
import { canCancel, splitBookings } from "@/lib/booking/rules";
import { formatCents } from "@/lib/domain/money";
import { fillText } from "@/lib/admin/text";
import { cn } from "@/lib/utils";
import { EmptyMark } from "@/themes/active";

// "Le mie prenotazioni" (SPEC §5.3): future e passate; cancellazione fino a cancel_limit_min prima,
// poi "Chiama il negozio". Senza future confermate c'è "Prenota" (anche con passate o cancellate).
export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ esito?: string }>;
}) {
  // Le prenotazioni (RLS: solo le proprie) partono appena getUser() ha verificato l'utente, insieme
  // alla lettura del profilo; la pagina mostra qualcosa solo dopo requireRole (loadBookingPageContext).
  const [{ shop }, own] = await Promise.all([loadBookingPageContext(), loadOwnBookings()]);
  const bookings = own?.bookings ?? null;
  const { esito } = await searchParams;
  const t = it.booking.list;
  const now = new Date();
  const { upcoming, past } = splitBookings(bookings ?? [], now);
  const tel = telHref(shop.phone);
  // Stesso stile del "Prenota" della home.
  const bookLink = (
    <Link
      href={BOOK_PATH}
      className="relative flex h-14 w-full items-center justify-center border-[4px] border-double border-ink font-display text-2xl transition-colors hover:bg-ink hover:text-surface active:bg-ink active:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t.emptyCta}
      <LinkPending />
    </Link>
  );

  // Fetta 8k: la prossima in programma come il biglietto della home (glass-ink), le altre in programma
  // con il riquadro, le passate spente e solo con il divisore.
  const ITEM_CLASS = {
    next: "on-ink glass-ink flex flex-col gap-2 p-4",
    upcoming: "flex flex-col gap-2 border border-line p-4",
    past: "flex flex-col gap-2 border-b border-line py-4 text-muted-foreground",
  } as const;
  const item = (booking: MyBooking, actions: React.ReactNode, kind: keyof typeof ITEM_CLASS) => (
    <li key={booking.id} className={ITEM_CLASS[kind]}>
      <p className="font-display text-2xl leading-tight first-letter:uppercase">
        {formatDateTime(booking.startsAt, shop.timezone)}
      </p>
      <p>{fillText(it.home.withBarber, { service: booking.serviceName, barber: booking.barberName })}</p>
      {/* Sul vetro scuro (nero nel tema chiaro) il grigio secondario non ha contrasto: lì il testo resta pieno. */}
      <p className={kind === "next" ? "text-sm" : "text-sm text-muted-foreground"}>
        {formatCents(booking.priceCents)}, {t.status[booking.status as keyof typeof t.status] ?? booking.status}
      </p>
      {actions}
    </li>
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="mb-4 font-display text-4xl leading-tight text-glow">{t.title}</h1>
      {esito === "cancellata" && <p role="status" className="border border-ink p-4">{t.cancelled}</p>}

      {bookings === null && (
        <div role="alert" className="flex flex-col gap-3 border-l-2 border-destructive p-4">
          <p>{it.booking.errors.listLoad}</p>
          <Link
            href={MY_BOOKINGS_PATH}
            className="relative inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
          >
            {it.booking.errors.retry}
            <LinkPending />
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
                {upcoming.map((booking, index) => {
                  const kind = index === 0 ? "next" : "upcoming";
                  // Nel blocco evidenziato il bordo segue il testo: il bordo --ink sparirebbe sul nero del tema chiaro.
                  const onInk = kind === "next" ? "border-current bg-transparent text-current" : undefined;
                  return item(
                    booking,
                    canCancel(new Date(booking.startsAt), now, shop.cancelLimitMin) ? (
                      <CancelBookingButton bookingId={booking.id} buttonClassName={onInk} />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className={kind === "next" ? "text-sm" : "text-sm text-muted-foreground"}>{t.tooLateHint}</p>
                        {tel && (
                          <a
                            href={tel}
                            className={cn(
                              "inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface",
                              onInk,
                            )}
                          >
                            {t.callShop}
                          </a>
                        )}
                      </div>
                    ),
                    kind,
                  );
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl">{t.past}</h2>
            {past.length === 0 ? (
              <p className="text-muted-foreground">{t.none}</p>
            ) : (
              <ul className="flex flex-col">{past.map((booking) => item(booking, null, "past"))}</ul>
            )}
          </section>

          {/* Avviso sull'intero elenco, fuori dalle passate: con 200 future le passate sarebbero "nessuna". */}
          {own?.truncated && (
            <p role="status" className="text-sm text-muted-foreground">
              {fillText(t.myBookingsTruncated, { count: MY_BOOKINGS_LIMIT })}
            </p>
          )}
        </>
      )}
    </main>
  );
}

async function loadOwnBookings(): Promise<MyBookings | null> {
  const userId = await getVerifiedUserId();
  return userId ? getMyBookings(userId) : null;
}
