import Link from "next/link";
import { it } from "@/i18n/it";
import { getShopTimezone } from "@/lib/admin/queries";
import { fillText, formatItDate } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { formatTime } from "@/lib/booking/format";
import { bookingDetailPath } from "@/lib/calendar/paths";
import { createClient } from "@/lib/db/server";
import { type BookingToUpdate, getBookingsToUpdate, TO_UPDATE_LIMIT } from "@/lib/db/stats";
import { localDateOf } from "@/lib/domain/local-time";
import { statsPath } from "@/lib/stats/paths";
import { statsSearchParamsSchema } from "@/lib/stats/schemas";

const t = it.admin.stats.toUpdate;

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Elenco "Da aggiornare" delle statistiche (SPEC §6.9, ADR 010): appuntamenti già passati ancora
// confermati nel periodo e con i filtri della pagina delle statistiche, ciascuno con il
// collegamento al dettaglio, dove si cambia lo stato. Solo admin.
export default async function StatsToUpdatePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // I layout non si rieseguono a ogni navigazione: ogni pagina ricontrolla il ruolo.
  await requireRole(["admin"]);
  const raw = await searchParams;

  // Un solo client per richiesta. Se le impostazioni non si leggono interviene error.tsx.
  const supabase = await createClient();
  const timezone = await getShopTimezone(supabase);
  const now = new Date();
  const params = statsSearchParamsSchema(localDateOf(now, timezone)).parse({
    dal: first(raw.dal),
    al: first(raw.al),
    barbiere: first(raw.barbiere),
    escludi_demo: first(raw.escludi_demo),
  });

  let result: { bookings: BookingToUpdate[]; truncated: boolean } | null;
  try {
    result = await getBookingsToUpdate(supabase, { ...params, timezone, now });
  } catch (error) {
    console.error("StatsToUpdatePage", error);
    result = null;
  }

  return (
    <>
      <Link href={statsPath(params)} className="w-fit text-sm underline underline-offset-4">
        {t.back}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      <p className="max-w-2xl text-sm">{t.intro}</p>
      <p className="text-sm text-muted-foreground">
        {fillText(it.admin.stats.period, { from: formatItDate(params.from), to: formatItDate(params.to) })}
      </p>

      {result === null ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-sm">
          {t.error}
        </p>
      ) : result.bookings.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-y border-line py-6">
          <p className="font-display text-2xl">{t.empty}</p>
          <Link
            href={statsPath(params)}
            className="inline-flex h-11 items-center border border-ink px-4 text-sm font-medium hover:bg-ink hover:text-surface active:bg-ink active:text-surface"
          >
            {t.back}
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <caption className="sr-only">{t.tableTitle}</caption>
              <thead>
                <tr className="border-b border-ink">
                  <th scope="col" className="py-2 pr-4 font-medium">{t.date}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t.time}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t.barber}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t.customer}</th>
                  <th scope="col" className="py-2 font-medium">{t.service}</th>
                </tr>
              </thead>
              <tbody>
                {result.bookings.map((booking) => {
                  const date = formatItDate(localDateOf(booking.startsAt, timezone));
                  const time = formatTime(booking.startsAt, timezone);
                  return (
                    <tr key={booking.id} className="border-b border-line align-middle">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {/* La data apre il dettaglio, dove si cambia lo stato: sempre visibile anche sul telefono */}
                        <Link
                          href={bookingDetailPath(booking.id)}
                          aria-label={fillText(t.openLabel, { customer: booking.customerName, date, time })}
                          className="inline-flex min-h-11 items-center underline underline-offset-4"
                        >
                          {date}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{time}</td>
                      <td className="py-2 pr-4">{booking.barberName}</td>
                      <td className="py-2 pr-4">{booking.customerName}</td>
                      <td className="py-2">{booking.serviceName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.truncated && (
            <p className="text-sm text-muted-foreground">{fillText(t.truncated, { count: TO_UPDATE_LIMIT })}</p>
          )}
        </>
      )}
    </>
  );
}
