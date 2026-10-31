import Link from "next/link";
import type { ReactNode } from "react";
import { it } from "@/i18n/it";
import { addDays } from "@/lib/domain/local-time";
import { type CalendarQuery, calendarHref } from "@/lib/calendar/view";
import { cn } from "@/lib/utils";

const t = it.admin.calendar;
const linkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center border border-ink px-3 text-sm font-medium hover:bg-disabled";

/** Navigazione per data, scelta della vista e (admin, vista settimana) del barbiere. */
export function CalendarToolbar({
  query,
  today,
  title,
  barbers,
  weekBarberId,
  cancelledCount,
  action,
}: {
  query: CalendarQuery;
  today: string;
  title: string;
  /** Barbieri fra cui scegliere nella vista settimana; vuoto per il barbiere. */
  barbers: Array<{ id: string; displayName: string }>;
  weekBarberId: string | null;
  cancelledCount: number;
  /** "Nuova prenotazione": a destra su desktop, accanto alla vista su telefono. */
  action: ReactNode;
}) {
  const week = query.view === "settimana";
  const step = week ? 7 : 1;
  const keep = { view: query.view, barberId: week ? weekBarberId : null, showCancelled: query.showCancelled };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <Link
          href={calendarHref({ ...keep, date: addDays(query.date, -step) })}
          aria-label={week ? t.previousWeek : t.previousDay}
          className={linkClass}
        >
          ←
        </Link>
        <Link href={calendarHref({ ...keep, date: today })} className={linkClass}>
          {t.today}
        </Link>
        <Link
          href={calendarHref({ ...keep, date: addDays(query.date, step) })}
          aria-label={week ? t.nextWeek : t.nextDay}
          className={linkClass}
        >
          →
        </Link>
        <h1 className={cn(
            "min-w-0 flex-1 font-display whitespace-nowrap first-letter:uppercase md:ml-2 md:flex-none md:text-3xl",
            week ? "text-base" : "text-2xl",
          )}>
          {title}
        </h1>
        {/* Su telefono seconda riga; da md le stesse voci nella riga sopra. */}
        <div className="flex w-full flex-wrap items-center justify-between gap-2 md:contents">
      <nav aria-label={t.viewLabel} className="flex md:ml-2">
        {(["giorno", "settimana"] as const).map((view) => (
          <Link
            key={view}
            href={calendarHref({ ...keep, view, barberId: view === "settimana" ? weekBarberId : null, date: query.date })}
            aria-current={query.view === view ? "page" : undefined}
            className={cn(linkClass, "-ml-px first:ml-0", query.view === view && "relative border-ink bg-ink text-surface")}
          >
            {view === "giorno" ? t.dayView : t.weekView}
          </Link>
        ))}
      </nav>
      {week && barbers.length > 1 && (
        <nav aria-label={t.barberFilterLabel} className="order-last flex w-full flex-wrap gap-2 md:order-none md:ml-2 md:w-auto">
          {barbers.map((barber) => (
            <Link
              key={barber.id}
              href={calendarHref({ ...keep, barberId: barber.id, date: query.date })}
              aria-current={barber.id === weekBarberId ? "page" : undefined}
              className={cn(linkClass, barber.id === weekBarberId && "border-ink bg-ink text-surface")}
            >
              {barber.displayName}
            </Link>
          ))}
        </nav>
      )}
      {action}
        </div>
      </div>
      {(cancelledCount > 0 || query.showCancelled) && (
        <p className="text-sm">
          {t.cancelledCount.replace("{count}", String(cancelledCount))}{" "}
          <Link
            href={calendarHref({ ...keep, date: query.date, showCancelled: !query.showCancelled })}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 md:min-h-0"
          >
            {query.showCancelled ? t.hideCancelled : t.showCancelled}
          </Link>
        </p>
      )}
    </div>
  );
}
