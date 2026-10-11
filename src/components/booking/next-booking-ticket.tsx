import Link from "next/link";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { bookingCountdown, type Countdown } from "@/lib/booking/countdown";
import { formatLongDate, formatTime } from "@/lib/booking/format";
import { MY_BOOKINGS_PATH } from "@/lib/booking/paths";

const t = it.home.ticket;

const countdownLabel = (countdown: Countdown): string =>
  countdown.kind === "today"
    ? t.today
    : countdown.kind === "tomorrow"
      ? t.tomorrow
      : t.inDays.replace("{count}", String(countdown.days));

/**
 * Prossima prenotazione come biglietto (fetta 8b): blocco nero con conto alla rovescia, data e ora;
 * sotto la perforazione servizio, barbiere e "Gestisci". Le tacche hanno il colore del fondo.
 */
export function NextBookingTicket({
  booking,
  now,
  timezone,
}: {
  booking: { startsAt: string; serviceName: string; barberName: string };
  now: Date;
  timezone: string;
}) {
  return (
    <section className="on-ink bg-ink text-surface">
      <div className="flex flex-col gap-1 p-5 pb-6">
        <h2 className="text-sm">{t.title}</h2>
        <p className="font-display text-2xl italic">{countdownLabel(bookingCountdown(booking.startsAt, now, timezone))}</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <p className="font-display text-2xl leading-tight first-letter:uppercase">
            {formatLongDate(booking.startsAt, timezone)}
          </p>
          <time dateTime={booking.startsAt} className="font-display text-5xl leading-none">
            {formatTime(booking.startsAt, timezone)}
          </time>
        </div>
      </div>
      <div aria-hidden="true" className="relative mx-5 border-t-2 border-dashed border-line">
        <span className="absolute -top-3.5 -left-8 size-6 rounded-full bg-background" />
        <span className="absolute -top-3.5 -right-8 size-6 rounded-full bg-background" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 p-5 pt-3">
        <p>{fillText(it.home.withBarber, { service: booking.serviceName, barber: booking.barberName })}</p>
        <Link
          href={MY_BOOKINGS_PATH}
          className="inline-flex h-11 items-center text-sm font-medium underline underline-offset-4 hover:no-underline"
        >
          {t.manage}
        </Link>
      </div>
    </section>
  );
}
