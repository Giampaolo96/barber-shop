"use client";

import Link from "next/link";
import { useRef } from "react";
import { DndContext, type DragEndEvent, type DragMoveEvent, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { blockPosition, busyRows, cardGeometry, covers, type DayGrid } from "@/lib/calendar/grid";
import { canDrag, dropTarget } from "@/lib/calendar/move";
import { nowLineMinutes } from "@/lib/calendar/now-line";
import { overlapLayout } from "@/lib/calendar/overlap-layout";
import { newBookingPath } from "@/lib/calendar/paths";
import type { DayColumn } from "@/lib/calendar/page-data";
import type { CalendarBooking } from "@/lib/calendar/queries";
import type { StaffRole } from "@/lib/calendar/transitions";
import { cn } from "@/lib/utils";
import { BookingCard, ColumnDropZone, DraggedCard, GRID_ROW_CLASS, NowLine, placed, ROW_HEIGHT } from "./grid-parts";
import { MoveFeedback } from "./move-feedback";
import { useBookingMove } from "./use-booking-move";
import { AUTO_SCROLL, useCalendarDrag } from "./use-calendar-drag";

const t = it.admin.calendar;

/** Destinazione mostrata durante il trascinamento. */
type DropPreview = { bookingId: string; barberId: string; startsAt: Date };

/** Minuti locali dalla mezzanotte di `date` (24:00 se l'istante cade il giorno dopo). */
const minutesOf = (instant: Date, date: string, timezone: string): number => {
  if (formatInTimeZone(instant, timezone, "yyyy-MM-dd") !== date) return 24 * 60;
  const [hours, minutes] = formatInTimeZone(instant, timezone, "HH:mm").split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Vista giorno (SPEC §6.1): una colonna per barbiere. Ogni riga libera è un link alla nuova
 * prenotazione (click su slot vuoto); ogni prenotazione porta al dettaglio. Fuori fascia, assenze
 * e chiusure sono solo sfondo: lo staff può comunque prenotare, dopo gli avvisi (§3.7.5).
 * Le confirmed non ancora iniziate si spostano trascinandole (§6.3, ADR 008): con il mouse dopo
 * 5 px, al tocco dopo una pressione prolungata, agganciandosi alle righe della griglia.
 */
export function DayGridView({
  grid,
  date,
  timezone,
  columns,
  role,
  ownBarberId,
  now,
}: {
  grid: DayGrid;
  date: string;
  timezone: string;
  columns: DayColumn[];
  role: StaffRole;
  ownBarberId: string | null;
  /** Istante del server per mostrare cosa è trascinabile; alla presa si usa l'ora corrente. */
  now: Date;
}) {
  const time = (instant: Date) => formatInTimeZone(instant, timezone, "HH:mm");
  const { positions, notice, dialog, busy, move, reject } = useBookingMove(columns);
  const gridRef = useRef<HTMLDivElement>(null);

  const bookings = columns.flatMap((column) => column.bookings).map((booking) => placed(booking, positions[booking.id]));
  const activeById = new Map(columns.map((column) => [column.barberId, column.isActive]));
  const draggableAt = (booking: CalendarBooking, at: Date): boolean =>
    !busy &&
    canDrag({ role, status: booking.status, startsAt: booking.startsAt, now: at, isOwn: booking.barberId === ownBarberId });

  const barberName = new Map(columns.map((column) => [column.barberId, column.barberName]));

  /**
   * Destinazione dell'evento di trascinamento, con la stessa funzione per l'anteprima e per il
   * rilascio: `delta` di dnd-kit tiene conto dello scorrimento, anche dell'autoscroll.
   */
  const targetOf = ({ active, over, delta }: DragMoveEvent | DragEndEvent) => {
    const booking = bookings.find((candidate) => candidate.id === active.id);
    const rowHeight = gridRef.current?.querySelector("[data-grid-row]")?.getBoundingClientRect().height;
    if (!booking || !rowHeight) return null;
    const target = dropTarget({
      grid,
      role,
      booking,
      overBarberId: typeof over?.id === "string" ? over.id : null,
      deltaRows: Math.round(delta.y / rowHeight),
      isActive: (barberId) => activeById.get(barberId) ?? false,
      // Falso positivo di react-hooks/purity: targetOf la chiamano solo i gestori di dnd-kit
      // (movimento e rilascio), mai il rendering. Lo spostamento verso il passato non è ammesso.
      // eslint-disable-next-line react-hooks/purity
      now: new Date(Date.now()),
    });
    return { booking, target };
  };

  const { sensors, activeId, preview, handlers } = useCalendarDrag({
    resolve: targetOf,
    previewOf: ({ booking, target }): DropPreview | null =>
      target.kind === "move" ? { bookingId: booking.id, barberId: target.barberId, startsAt: target.startsAt } : null,
    onDrop: ({ booking, target }) => {
      if (target.kind === "none") return;
      if (target.kind === "past") {
        reject(t.move.pastTarget);
        return;
      }
      move(
        booking.id,
        { barberId: booking.barberId, startsAt: booking.startsAt },
        { barberId: target.barberId, startsAt: target.startsAt },
      );
    },
  });

  const labelOf = (booking: CalendarBooking) =>
    `${time(booking.startsAt)}–${time(booking.endsAt)} ${booking.customerName}`;
  const dragged = bookings.find((booking) => booking.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={AUTO_SCROLL}
      {...handlers}
    >
      <MoveFeedback notice={notice} dialog={dialog} busy={busy} />
      {bookings.length === 0 && <EmptyDay />}
      <div className="overflow-x-auto">
        <div
          ref={gridRef}
          className={cn("grid min-w-max gap-x-2", GRID_ROW_CLASS)}
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
              data-grid-row
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
            const columnBookings = bookings.filter((booking) => booking.barberId === column.barberId);
            const placedBookings = columnBookings.flatMap((booking) => {
              const position = blockPosition(grid, booking);
              return position ? [{ booking, position }] : [];
            });
            // Corsie calcolate sulle righe occupate (quelle che si vedono), non sui minuti esatti.
            const lanes = overlapLayout(
              placedBookings.map(({ booking, position }) => ({
                id: booking.id,
                start: position.row,
                end: position.row + position.span,
                status: booking.status,
              })),
            );
            // Occupato fino a blocked_until: anche le righe del buffer non sono prenotabili.
            const busyRow = busyRows(
              grid,
              columnBookings
                .filter((booking) => booking.status === "confirmed")
                .map((booking) => ({ startsAt: booking.startsAt, endsAt: booking.blockedUntil })),
            );
            return [
              <h2
                key={`${column.barberId}-head`}
                className="flex items-center gap-2 pb-2 text-sm font-semibold"
                style={{ gridColumn, gridRow: 1 }}
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center border border-ink font-display text-base font-normal"
                >
                  {column.barberName.charAt(0)}
                </span>
                {column.barberName}
              </h2>,
              <ColumnDropZone
                key={`${column.barberId}-drop`}
                id={column.barberId}
                attributes={{ "data-barber-id": column.barberId }}
                gridColumn={gridColumn}
                highlighted={preview?.barberId === column.barberId}
              />,
              ...grid.rows.map((row, index) => {
                const working = column.bands.some((band) => covers(band, row));
                const period = column.periods.find((candidate) => covers(candidate, row));
                const cellClass = cn(
                  "border-t",
                  time(row).endsWith(":00") ? "border-ink/30" : "border-line/60",
                  !working && "bg-disabled",
                  period && "bg-hatch",
                );
                if (busyRow[index] || !column.isActive) {
                  return (
                    <div
                      key={`${column.barberId}-${index}`}
                      className={cellClass}
                      title={busyRow[index] ? t.bufferBlock : t.inactiveBarberNoBooking}
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
              ...placedBookings.map(({ booking, position }) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  label={labelOf(booking)}
                  lane={lanes.get(booking.id)}
                  timeLabel={time(booking.startsAt)}
                  draggable={draggableAt(booking, now)}
                  canGrab={() => draggableAt(booking, new Date())}
                  style={{ gridColumn, gridRow: `${position.row + 2} / span ${position.span}` }}
                  box={{
                    ...cardGeometry({ rowStartsAt: grid.rows[position.row], clipEndsAt: grid.endsAt }, booking),
                    granularityMin: grid.granularityMin,
                  }}
                />
              )),
            ];
          })}
          <NowLine
            serverNow={now}
            rows={grid.rows.length}
            granularityMin={grid.granularityMin}
            locate={(at) => {
              const offset = nowLineMinutes(at, date, timezone, minutesOf(grid.startsAt, date, timezone), minutesOf(grid.endsAt, date, timezone));
              return offset === null ? null : { offset, gridColumn: "1 / -1" };
            }}
          />
        </div>
      </div>
      {/* La copia trascinata sta fuori dal contenitore che scorre: spostare la scheda originale
          con un transform allargherebbe la griglia e l'autoscroll non finirebbe mai. */}
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <DraggedCard
            label={labelOf(dragged)}
            serviceName={dragged.serviceName}
            preview={
              preview?.bookingId === dragged.id
                ? t.move.dropPreview
                    .replace("{barber}", barberName.get(preview.barberId) ?? "")
                    .replace("{time}", time(preview.startsAt))
                : null
            }
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Giorno senza appuntamenti: solo il testo; l'invito è il pulsante "Nuova prenotazione" della pagina,
 * subito sopra (nell'area staff niente segni del tema).
 */
function EmptyDay() {
  return <p className="border-y border-line py-4 font-display text-xl">{t.emptyDay}</p>;
}
