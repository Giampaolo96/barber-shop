"use client";

import Link from "next/link";
import { useRef } from "react";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { blockPosition, busyRows, type DayGrid, type Interval } from "@/lib/calendar/grid";
import { canDrag, canDropOn, dropStart } from "@/lib/calendar/move";
import { bookingDetailPath, newBookingPath } from "@/lib/calendar/paths";
import type { DayColumn } from "@/lib/calendar/page-data";
import type { CalendarBooking } from "@/lib/calendar/queries";
import type { StaffRole } from "@/lib/calendar/transitions";
import { cn } from "@/lib/utils";
import { MoveFeedback } from "./move-feedback";
import { type Position, useBookingMove } from "./use-booking-move";

const t = it.admin.calendar;
const ROW_HEIGHT = "2.25rem";

/**
 * Il rilascio di un trascinamento genera anche un click sulla scheda, che è un link al dettaglio.
 * dnd-kit ne ferma la propagazione (React non lo vede) ma non l'azione predefinita: senza questo
 * blocco il browser aprirebbe il dettaglio. Il click arriva nello stesso task del rilascio, quindi
 * il blocco si toglie subito dopo, così non ne intercetta altri.
 */
const preventClick = (event: Event) => event.preventDefault();
const blockClick = () => window.addEventListener("click", preventClick, { capture: true });
const releaseClick = () => setTimeout(() => window.removeEventListener("click", preventClick, { capture: true }), 0);

const covers = (interval: Interval, at: Date): boolean =>
  interval.startsAt.getTime() <= at.getTime() && at.getTime() < interval.endsAt.getTime();

/** Prenotazione nella posizione mostrata (quella ottimistica durante uno spostamento). */
const placed = (booking: CalendarBooking, position: Position | undefined): CalendarBooking => {
  if (!position) return booking;
  const shift = position.startsAt.getTime() - booking.startsAt.getTime();
  return {
    ...booking,
    barberId: position.barberId,
    startsAt: position.startsAt,
    endsAt: new Date(booking.endsAt.getTime() + shift),
    blockedUntil: new Date(booking.blockedUntil.getTime() + shift),
  };
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

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const bookings = columns.flatMap((column) => column.bookings).map((booking) => placed(booking, positions[booking.id]));
  const activeById = new Map(columns.map((column) => [column.barberId, column.isActive]));
  const draggableAt = (booking: CalendarBooking, at: Date): boolean =>
    !busy &&
    canDrag({ role, status: booking.status, startsAt: booking.startsAt, now: at, isOwn: booking.barberId === ownBarberId });

  const onDragEnd = ({ active, over, delta }: DragEndEvent) => {
    releaseClick();
    const booking = bookings.find((candidate) => candidate.id === active.id);
    const rowHeight = gridRef.current?.querySelector("[data-grid-row]")?.getBoundingClientRect().height;
    if (!booking || !rowHeight) return;

    const targetBarberId = typeof over?.id === "string" ? over.id : booking.barberId;
    const allowed = canDropOn({
      role,
      sourceBarberId: booking.barberId,
      targetBarberId,
      targetActive: activeById.get(targetBarberId) ?? false,
    });
    const startsAt = dropStart(grid, booking.startsAt, Math.round(delta.y / rowHeight));
    if (!allowed || !startsAt) return;
    if (targetBarberId === booking.barberId && startsAt.getTime() === booking.startsAt.getTime()) return;
    // Mai verso il passato (review fetta 6c): lo rifiuterebbe anche il server.
    // Falso positivo di react-hooks/purity: onDragEnd è definita nel corpo del componente, ma la
    // chiama solo dnd-kit al rilascio (gestore di evento), mai durante il rendering.
    // eslint-disable-next-line react-hooks/purity
    if (startsAt.getTime() <= Date.now()) {
      reject(t.move.pastTarget);
      return;
    }
    move(booking.id, { barberId: booking.barberId, startsAt: booking.startsAt }, { barberId: targetBarberId, startsAt });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={blockClick}
      onDragEnd={onDragEnd}
      onDragCancel={releaseClick}
    >
      <MoveFeedback notice={notice} dialog={dialog} busy={busy} />
      <div className="overflow-x-auto">
        <div
          ref={gridRef}
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
                className="pb-2 text-sm font-semibold"
                style={{ gridColumn, gridRow: 1 }}
              >
                {column.barberName}
              </h2>,
              <ColumnDropZone key={`${column.barberId}-drop`} barberId={column.barberId} gridColumn={gridColumn} />,
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
                      className={cn(cellClass, busyRow[index] && "bg-disabled")}
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
              ...columnBookings.map((booking) => {
                const position = blockPosition(grid, booking);
                if (!position) return null;
                return (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    label={`${time(booking.startsAt)}–${time(booking.endsAt)} ${booking.customerName}`}
                    draggable={draggableAt(booking, now)}
                    canGrab={() => draggableAt(booking, new Date())}
                    style={{ gridColumn, gridRow: `${position.row + 2} / span ${position.span}` }}
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
    </DndContext>
  );
}

/** Area della colonna su cui si rilascia una scheda; non intercetta i click sulle righe. */
function ColumnDropZone({ barberId, gridColumn }: { barberId: string; gridColumn: number }) {
  const { setNodeRef } = useDroppable({ id: barberId });
  return (
    <div
      ref={setNodeRef}
      data-barber-id={barberId}
      aria-hidden
      className="pointer-events-none"
      style={{ gridColumn, gridRow: "2 / -1" }}
    />
  );
}

/**
 * Scheda di una prenotazione. Se è trascinabile non usa gli attributi ARIA di dnd-kit (resta un
 * link verso il dettaglio, dove c'è anche il modulo per spostarla) e niente menu del link né
 * selezione del testo alla pressione prolungata su iOS. Quando la si afferra si ricontrolla con
 * l'ora corrente (`canGrab`): con la pagina aperta a lungo l'appuntamento può essere iniziato.
 */
function BookingCard({
  booking,
  label,
  draggable,
  canGrab,
  style,
}: {
  booking: CalendarBooking;
  label: string;
  draggable: boolean;
  canGrab: () => boolean;
  style: React.CSSProperties;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id: booking.id, disabled: !draggable });
  const grabListeners =
    draggable && listeners
      ? Object.fromEntries(
          Object.entries(listeners).map(([name, handler]) => [
            name,
            (event: React.SyntheticEvent) => {
              if (canGrab()) handler(event);
            },
          ]),
        )
      : {};
  const cancelled = booking.status.startsWith("cancelled");
  return (
    <Link
      ref={setNodeRef}
      href={bookingDetailPath(booking.id)}
      draggable={false}
      data-draggable={draggable ? "true" : undefined}
      {...grabListeners}
      className={cn(
        "z-10 m-px flex flex-col overflow-hidden rounded-md border bg-surface px-2 py-1 text-xs",
        booking.status === "confirmed" && "border-ink",
        booking.status === "completed" && "border-line text-muted-foreground",
        booking.status === "no_show" && "border-destructive text-destructive",
        cancelled && "border-dashed border-line text-ink-disabled line-through",
        draggable && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
        isDragging && "z-20 cursor-grabbing",
      )}
      style={{
        ...style,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      <span className="font-medium">{label}</span>
      <span>
        {booking.serviceName}
        {booking.status === "confirmed" ? "" : `, ${t.statusLabels[booking.status]}`}
      </span>
    </Link>
  );
}
