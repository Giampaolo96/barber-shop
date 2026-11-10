import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import { notFound, redirect } from "next/navigation";
import { it } from "@/i18n/it";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { seeYouPhrase } from "@/lib/booking/countdown";
import { formatLongDate, formatTime } from "@/lib/booking/format";
import { MY_BOOKINGS_PATH, calendarFilePath } from "@/lib/booking/paths";
import { loadOwnUpcomingBooking } from "@/lib/booking/own-booking";
import { ConfirmationBackground, ConfirmationMark } from "@/themes/active";

const t = it.booking.confirmation;

const actionBase = "flex items-center justify-center border border-on-marble px-4 font-medium";
/**
 * Azione principale: piena (e accesa nei temi con la luce), si svuota al passaggio e alla pressione.
 * Stesso peso di "Conferma prenotazione" (h-14, text-base), fetta 8k.
 */
const primaryActionClass = `${actionBase} h-14 text-base glow bg-on-marble text-marble hover:bg-marble hover:text-on-marble active:bg-marble active:text-on-marble`;
/** Azione secondaria: bordo, si riempie al passaggio e alla pressione. */
const actionClass = `${actionBase} h-12 text-sm relative glow-hover hover:bg-on-marble hover:text-marble active:bg-on-marble active:text-marble`;

// Schermata dopo la conferma (fetta 8b, SPEC §5.2): solo il cliente proprietario (RLS), altrimenti
// 404; una prenotazione propria cancellata o già iniziata rimanda a "Le mie prenotazioni".
export default async function BookingConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);
  const now = new Date();
  const result = await loadOwnUpcomingBooking(user.id, (await params).id, now);
  if (result.status === "not_found") notFound();
  if (result.status === "not_upcoming") redirect(MY_BOOKINGS_PATH);
  if (result.status === "error") {
    // La prenotazione è già salvata: si invita a ritrovarla in "Le mie prenotazioni".
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
        <div role="alert" className="flex flex-col gap-3 border-l-2 border-destructive p-4">
          <p>{t.loadError}</p>
          <Link
            href={MY_BOOKINGS_PATH}
            className="relative inline-flex h-11 w-fit items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface active:bg-ink active:text-surface"
          >
            {t.myBookings}
            <LinkPending />
          </Link>
        </div>
      </main>
    );
  }
  const { booking, shop } = result;

  return (
    <main className="on-ink relative flex flex-1 flex-col overflow-hidden bg-marble text-on-marble">
      <ConfirmationBackground />
      <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-6 pb-10">
        <ConfirmationMark />
        <div className="flex flex-col gap-3">
          <h1 className="text-sm font-medium">{t.title}</h1>
          <p className="font-display text-5xl leading-none text-glow">
            {t.seeYou.replace("{when}", seeYouPhrase(booking.startsAt, now, shop.timezone))}
          </p>
          <p className="font-display text-2xl italic first-letter:uppercase">
            {formatLongDate(booking.startsAt, shop.timezone)},{" "}
            <time dateTime={booking.startsAt}>{formatTime(booking.startsAt, shop.timezone)}</time>
          </p>
        </div>
        <dl className="glass flex flex-col border-y-[3px] border-double border-on-marble px-(--glass-pad)">
          <Detail label={t.service}>{booking.serviceName}</Detail>
          <Detail label={t.barber}>{booking.barberName}</Detail>
          <Detail label={t.shop}>
            {shop.name}
            {/* Indirizzo nel testo corrente: il Bodoni resta per nome, data e ora (fetta 8k). */}
            {shop.address && <address className="font-sans text-base not-italic">{shop.address}</address>}
          </Detail>
        </dl>
        <div className="flex flex-col gap-3">
          <a href={calendarFilePath(booking.id)} className={primaryActionClass}>
            {t.addToCalendar}
          </a>
          <Link href={MY_BOOKINGS_PATH} className={actionClass}>
            {t.myBookings}
            <LinkPending />
          </Link>
          {/* Due soli pulsanti: il ritorno alla home è un link (fetta 8k). */}
          <Link
            href="/"
            className="inline-flex h-11 w-fit items-center text-sm font-medium underline underline-offset-4 hover:no-underline"
          >
            {t.backHome}
          </Link>
        </div>
      </div>
    </main>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-vein/40 py-3 last:border-b-0">
      <dt className="text-sm">{label}</dt>
      <dd className="text-right font-display text-lg">{children}</dd>
    </div>
  );
}
