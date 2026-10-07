"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
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
import { canDrag, dropTarget } from "@/lib/calendar/move";
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
 * Autoscroll solo vicino ai bordi estremi (5% in orizzontale): serve a raggiungere le colonne
 * fuori schermo, ma non deve far scorrere la griglia sotto un puntatore fermo su una colonna
 * visibile. L'anteprima della destinazione segue comunque lo scorrimento.
 */
const AUTO_SCROLL = { threshold: { x: 0.05, y: 0.2 } };

/** Destinazione mostrata durante il trascinamento. */
type DropPreview = { bookingId: string; barberId: string; startsAt: Date };

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
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

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

  const onDragStart = (event: DragStartEvent) => {
    blockClick();
    setActiveId(String(event.active.id));
  };

  const onDragMove = (event: DragMoveEvent) => {
    const result = targetOf(event);
    setPreview(
      result?.target.kind === "move"
        ? { bookingId: result.booking.id, barberId: result.target.barberId, startsAt: result.target.startsAt }
        : null,
    );
  };

  const onDragEnd = (event: DragEndEvent) => {
    releaseClick();
    setPreview(null);
    setActiveId(null);
    const result = targetOf(event);
    if (!result || result.target.kind === "none") return;
    if (result.target.kind === "past") {
      reject(t.move.pastTarget);
      return;
    }
    const { booking, target } = result;
    move(
      booking.id,
      { barberId: booking.barberId, startsAt: booking.startsAt },
      { barberId: target.barberId, startsAt: target.startsAt },
    );
  };

  const onDragCancel = () => {
    releaseClick();
    setPreview(null);
    setActiveId(null);
  };

  const labelOf = (booking: CalendarBooking) =>
    `${time(booking.startsAt)}–${time(booking.endsAt)} ${booking.customerName}`;
  const dragged = bookings.find((booking) => booking.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={AUTO_SCROLL}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
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
              <ColumnDropZone
                key={`${column.barberId}-drop`}
                barberId={column.barberId}
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
                    label={labelOf(booking)}
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
 * Area della colonna su cui si rilascia una scheda; non intercetta i click sulle righe. Durante il
 * trascinamento la colonna di arrivo ha un contorno pieno (`data-drop-target`).
 */
function ColumnDropZone({
  barberId,
  gridColumn,
  highlighted,
}: {
  barberId: string;
  gridColumn: number;
  highlighted: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: barberId });
  return (
    <div
      ref={setNodeRef}
      data-barber-id={barberId}
      data-drop-target={highlighted ? "true" : undefined}
      aria-hidden
      className={cn("pointer-events-none", highlighted && "z-[5] outline-2 -outline-offset-2 outline-ink")}
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
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: booking.id, disabled: !draggable });
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
        // Durante il trascinamento resta al suo posto, tratteggiata: si muove la copia.
        isDragging && "border-dashed",
      )}
      style={style}
    >
      <span className="font-medium">{label}</span>
      <span>
        {booking.serviceName}
        {booking.status === "confirmed" ? "" : `, ${t.statusLabels[booking.status]}`}
      </span>
    </Link>
  );
}

/**
 * Copia della scheda che segue il puntatore, con barbiere e orario di arrivo (es. "Mario, 10:30"):
 * si aggiornano anche durante l'autoscroll, con la stessa funzione usata al rilascio.
 */
function DraggedCard({ label, serviceName, preview }: { label: string; serviceName: string; preview: string | null }) {
  return (
    <div className="flex h-full cursor-grabbing flex-col overflow-hidden rounded-md border border-ink bg-surface px-2 py-1 text-xs select-none">
      {preview && (
        <span data-drop-preview className="self-start bg-ink px-1 font-medium text-surface">
          {preview}
        </span>
      )}
      <span className="font-medium">{label}</span>
      <span>{serviceName}</span>
    </div>
  );
}
