import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { blockPosition, busyRows, type DayGrid, type Interval } from "@/lib/calendar/grid";
import { bookingDetailPath, newBookingPath } from "@/lib/calendar/paths";
import type { DayColumn } from "@/lib/calendar/page-data";
import { cn } from "@/lib/utils";

const t = it.admin.calendar;
const ROW_HEIGHT = "2.25rem";

const covers = (interval: Interval, at: Date): boolean =>
  interval.startsAt.getTime() <= at.getTime() && at.getTime() < interval.endsAt.getTime();

/**
 * Vista giorno (SPEC §6.1): una colonna per barbiere. Ogni riga libera è un link alla nuova
 * prenotazione (click su slot vuoto); ogni prenotazione porta al dettaglio. Fuori fascia, assenze
 * e chiusure sono solo sfondo: lo staff può comunque prenotare, dopo gli avvisi (§3.7.5).
 */
export function DayGridView({
  grid,
  date,
  timezone,
  columns,
}: {
  grid: DayGrid;
  date: string;
  timezone: string;
  columns: DayColumn[];
}) {
  const time = (instant: Date) => formatInTimeZone(instant, timezone, "HH:mm");

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-max gap-x-2"
        style={{
          gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(11rem, 1fr))`,
          gridTemplateRows: `auto repeat(${grid.rows.length}, ${ROW_HEIGHT})`,
        }}
      >
        <div className="text-xs font-medium text-muted-foreground" style={{ gridColumn: 1, gridRow: 1 }}>
          {t.timeColumn}
        </div>
        {grid.rows.map((row, index) => (
          <div
            key={row.toISOString()}
            className={cn(
              "border-t pt-0.5 text-xs tabular-nums",
              // Le ore intere guidano la lettura; i quarti d'ora restano in secondo piano.
              time(row).endsWith(":00") ? "border-ink/30 text-ink" : "border-line/60 text-ink-disabled",
            )}
            style={{ gridColumn: 1, gridRow: index + 2 }}
          >
            {time(row)}
          </div>
        ))}

        {columns.map((column, columnIndex) => {
          const gridColumn = columnIndex + 2;
          // Occupato fino a blocked_until: anche le righe del buffer non sono prenotabili.
          const busy = busyRows(
            grid,
            column.bookings
              .filter((booking) => booking.status === "confirmed")
              .map((booking) => ({ startsAt: booking.startsAt, endsAt: booking.blockedUntil })),
          );
          return [
            <h2
              key={`${column.barberId}-head`}
              className="pb-2 text-sm font-semibold"
              style={{ gridColumn, gridRow: 1 }}
            >
              {column.barberName}
            </h2>,
            ...grid.rows.map((row, index) => {
              const working = column.bands.some((band) => covers(band, row));
              const period = column.periods.find((candidate) => covers(candidate, row));
              const cellClass = cn(
                "border-t",
                time(row).endsWith(":00") ? "border-ink/30" : "border-line/60",
                !working && "bg-disabled",
                period && "bg-hatch",
              );
              if (busy[index] || !column.isActive) {
                return (
                  <div
                    key={`${column.barberId}-${index}`}
                    className={cn(cellClass, busy[index] && "bg-disabled")}
                    title={busy[index] ? t.bufferBlock : t.inactiveBarberNoBooking}
                    style={{ gridColumn, gridRow: index + 2 }}
                  />
                );
              }
              const label = t.newAt.replace("{barber}", column.barberName).replace("{time}", time(row));
              return (
                <Link
                  key={`${column.barberId}-${index}`}
                  href={newBookingPath({ barberId: column.barberId, date, time: time(row) })}
                  aria-label={label}
                  title={label}
                  className={cn(cellClass, "block hover:bg-disabled focus-visible:bg-disabled")}
                  style={{ gridColumn, gridRow: index + 2 }}
                />
              );
            }),
            ...column.periods.map((period, index) => {
              const position = blockPosition(grid, period);
              if (!position) return null;
              return (
                <div
                  key={`${column.barberId}-period-${index}`}
                  className="pointer-events-none z-0 self-start bg-surface px-1 text-xs text-muted-foreground"
                  style={{ gridColumn, gridRow: `${position.row + 2} / span ${position.span}` }}
                >
                  {period.kind === "closure" ? t.closureBlock : t.timeOffBlock}
                  {period.reason ? `, ${period.reason}` : ""}
                </div>
              );
            }),
            ...column.bookings.map((booking) => {
              const position = blockPosition(grid, booking);
              if (!position) return null;
              const cancelled = booking.status.startsWith("cancelled");
              return (
                <Link
                  key={booking.id}
                  href={bookingDetailPath(booking.id)}
                  className={cn(
                    "z-10 m-px flex flex-col overflow-hidden rounded-md border bg-surface px-2 py-1 text-xs",
                    booking.status === "confirmed" && "border-ink",
                    booking.status === "completed" && "border-line text-muted-foreground",
                    booking.status === "no_show" && "border-destructive text-destructive",
                    cancelled && "border-dashed border-line text-ink-disabled line-through",
                  )}
                  style={{ gridColumn, gridRow: `${position.row + 2} / span ${position.span}` }}
                >
                  <span className="font-medium">
                    {time(booking.startsAt)}–{time(booking.endsAt)} {booking.customerName}
                  </span>
                  <span>
                    {booking.serviceName}
                    {booking.status === "confirmed" ? "" : `, ${t.statusLabels[booking.status]}`}
                  </span>
                </Link>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}
