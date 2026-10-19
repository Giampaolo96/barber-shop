import Link from "next/link";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { NextBookingTicket } from "@/components/booking/next-booking-ticket";
import { InstallBanner } from "@/components/pwa/install-banner";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { STAFF_LOGIN_PATH } from "@/lib/auth/access";
import { getCurrentUser, getVerifiedUserId } from "@/lib/auth/current-user";
import { formatTime, telHref } from "@/lib/booking/format";
import { BOOK_PATH, MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { getNextBooking, getShopInfo } from "@/lib/booking/queries";
import { isoWeekday } from "@/lib/calendar/grid";
import { localDateOf } from "@/lib/domain/local-time";
import { splitShopName } from "@/lib/shop/name";
import { type OpeningHours, openingStatus } from "@/lib/shop/opening";
import { getOpeningData } from "@/lib/shop/queries";
import { HeroBackground, HeroMark } from "@/themes/active";

const t = it.home;

// Home (SPEC §5.1): testata del negozio con lo stato di apertura, prossima prenotazione del
// cliente, "Prenota", orari della settimana, indirizzo e telefono (docs/DESIGN.md).
export default async function HomePage() {
  // La prossima prenotazione (RLS: solo le proprie) parte appena getUser() ha verificato l'utente,
  // insieme alla lettura del profilo; si mostra solo se il profilo dice che è un cliente.
  const [user, shop, opening, nextBooking] = await Promise.all([
    getCurrentUser(),
    getShopInfo(),
    getOpeningData(),
    loadNextBooking(),
  ]);
  const next = user?.role === "customer" ? nextBooking : null;
  // Fuso orario sempre dalle impostazioni: senza impostazioni niente stato, orari né data.
  const timezone = shop?.timezone ?? null;
  const name = splitShopName(shop?.name ?? it.shop.name);
  const fullName = [name.lead, name.rest].filter(Boolean).join(" ");
  const now = new Date();
  const status = opening && timezone ? openingStatus({ now, timezone, ...opening }) : null;
  const tel = telHref(shop?.phone ?? null);

  return (
    <>
      <main className="flex flex-1 flex-col">
        <section className="on-ink relative overflow-hidden bg-marble text-on-marble">
          <HeroBackground />
          <div className="relative mx-auto flex w-full max-w-xl flex-col px-4 pt-4 pb-10">
            <HeroMark />
            <h1 aria-label={fullName} className="-mt-10 font-display text-glow">
              <span className="block text-[5.5rem] leading-[0.9] font-medium tracking-tight sm:text-[7rem]">
                {name.lead}
              </span>
              {name.rest && <span className="block text-3xl italic lowercase sm:text-4xl">{name.rest}</span>}
            </h1>
            {status && timezone && (
              <p className="mt-8 text-base">
                {status.state === "open"
                  ? fillText(t.openNow, { time: closingTime(status.until, timezone) })
                  : status.state === "opens_later"
                    ? fillText(t.opensAt, { time: formatTime(status.at, timezone) })
                    : t.closedToday}
              </p>
            )}
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-xl flex-col gap-10 px-4 py-8">
          {user?.role === "customer" &&
            (next?.ok && next.booking && timezone ? (
              <NextBookingTicket booking={next.booking} now={now} timezone={timezone} />
            ) : (
              <section className="on-ink glass-ink flex flex-col gap-3 p-5">
                <h2 className="text-sm font-medium">{t.nextBooking}</h2>
                {next && !next.ok ? (
                  <p role="alert">{it.booking.errors.listLoad}</p>
                ) : next?.booking ? (
                  // C'è una prenotazione ma mancano le impostazioni (fuso orario): non si può mostrare.
                  <p role="alert">{t.nextBookingUnavailable}</p>
                ) : (
                  <p>{t.noBooking}</p>
                )}
                <Link
                  href={MY_BOOKINGS_PATH}
                  className="inline-flex h-11 w-fit items-center text-sm font-medium underline underline-offset-4 hover:no-underline"
                >
                  {t.myBookings}
                </Link>
              </section>
            ))}

          <Link
            href={BOOK_PATH}
            className="flex h-14 items-center justify-center border-[4px] border-double border-ink font-display text-2xl text-glow glow hover:bg-ink hover:text-surface active:bg-ink active:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t.book}
          </Link>

          <InstallBanner />

          {opening && timezone && (
            <WeeklyHours hours={opening.hours} today={isoWeekday(localDateOf(now, timezone))} />
          )}

          {(shop?.address || tel) && (
            <section className="flex flex-col gap-3">
              <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl text-glow">{t.whereTitle}</h2>
              {shop?.address && <address className="not-italic">{shop.address}</address>}
              {tel && shop?.phone && (
                <a
                  href={tel}
                  className="glow-hover inline-flex h-11 w-fit items-center gap-3 border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface"
                >
                  {t.call}
                  <span className="font-normal tabular-nums">{shop.phone}</span>
                </a>
              )}
            </section>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-xl border-t border-line px-4 py-2">
        <Link href={STAFF_LOGIN_PATH} className={secondaryLinkClass}>
          {it.auth.customerLogin.staffLink}
        </Link>
      </footer>
    </>
  );
}

async function loadNextBooking(): Promise<Awaited<ReturnType<typeof getNextBooking>> | null> {
  const userId = await getVerifiedUserId();
  return userId ? getNextBooking(userId) : null;
}

/** Ora di chiusura: una fascia fino a mezzanotte chiude alle 24:00, non alle 00:00. */
function closingTime(until: Date, timezone: string): string {
  const time = formatTime(until, timezone);
  return time === "00:00" ? "24:00" : time;
}

/** Orari della settimana, da lunedì: le fasce unite del negozio o "Chiuso"; oggi in grassetto. */
function WeeklyHours({ hours, today }: { hours: OpeningHours[]; today: number }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b-[3px] border-double border-ink pb-2 font-display text-2xl text-glow">{t.hoursTitle}</h2>
      <dl className="flex flex-col">
        {t.weekdays.map((label, index) => {
          const weekday = index + 1;
          const bands = hours.filter((band) => band.weekday === weekday);
          const isToday = weekday === today;
          return (
            <div
              key={label}
              className={`flex justify-between gap-4 border-b border-line py-2 ${isToday ? "font-semibold" : ""}`}
            >
              <dt>
                {label}
                {isToday && <span className="sr-only"> ({t.today})</span>}
              </dt>
              <dd className="text-right tabular-nums">
                {bands.length === 0 ? (
                  <span className="text-muted-foreground">{t.closedDay}</span>
                ) : (
                  bands.map((band) => (
                    <span key={band.start} className="ml-4 inline-block">
                      {band.start}–{band.end}
                    </span>
                  ))
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
