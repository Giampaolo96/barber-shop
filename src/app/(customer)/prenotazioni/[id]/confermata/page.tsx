import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { it } from "@/i18n/it";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { seeYouPhrase } from "@/lib/booking/countdown";
import { formatLongDate, formatTime } from "@/lib/booking/format";
import { MY_BOOKINGS_PATH, calendarFilePath } from "@/lib/booking/paths";
import { getOwnBooking, getShopInfo } from "@/lib/booking/queries";
import { isUpcoming } from "@/lib/booking/rules";
import { ConfirmationBackground, ConfirmationMark } from "@/themes/active";

const t = it.booking.confirmation;

const actionBase = "flex h-12 items-center justify-center border border-on-marble px-4 text-sm font-medium transition-colors";
/** Azione principale: piena, si svuota al passaggio e alla pressione. */
const primaryActionClass = `${actionBase} bg-on-marble text-ink hover:bg-marble hover:text-on-marble active:bg-marble active:text-on-marble`;
/** Azioni secondarie: bordo, si riempiono al passaggio e alla pressione. */
const actionClass = `${actionBase} hover:bg-on-marble hover:text-ink active:bg-on-marble active:text-ink`;

// Schermata dopo la conferma (fetta 8b, SPEC §5.2): solo il cliente proprietario (RLS), altrimenti
// 404; una prenotazione propria cancellata o già iniziata rimanda a "Le mie prenotazioni".
export default async function BookingConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();

  const [result, shop] = await Promise.all([getOwnBooking(user.id, id.data), getShopInfo()]);
  if (!result.ok || !shop) throw new Error("conferma non leggibile");
  if (!result.booking) notFound();
  const now = new Date();
  const booking = result.booking;
  if (!isUpcoming(booking, now)) redirect(MY_BOOKINGS_PATH);

  return (
    <main className="on-ink relative flex flex-1 flex-col overflow-hidden bg-marble text-on-marble">
      <ConfirmationBackground />
      <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-6 pb-10">
        <ConfirmationMark />
        <div className="flex flex-col gap-3">
          <h1 className="text-sm font-medium">{t.title}</h1>
          <p className="font-display text-5xl leading-none">
            {t.seeYou.replace("{when}", seeYouPhrase(booking.startsAt, now, shop.timezone))}
          </p>
          <p className="font-display text-2xl italic first-letter:uppercase">
            {formatLongDate(booking.startsAt, shop.timezone)},{" "}
            <time dateTime={booking.startsAt}>{formatTime(booking.startsAt, shop.timezone)}</time>
          </p>
        </div>
        <dl className="flex flex-col border-y-[3px] border-double border-on-marble">
          <Detail label={t.service}>{booking.serviceName}</Detail>
          <Detail label={t.barber}>{booking.barberName}</Detail>
          <Detail label={t.shop}>
            {shop.name}
            {shop.address && <address className="not-italic">{shop.address}</address>}
          </Detail>
        </dl>
        <div className="flex flex-col gap-3">
          <a href={calendarFilePath(booking.id)} className={primaryActionClass}>
            {t.addToCalendar}
          </a>
          <Link href={MY_BOOKINGS_PATH} className={actionClass}>
            {t.myBookings}
          </Link>
          <Link href="/" className={actionClass}>
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
