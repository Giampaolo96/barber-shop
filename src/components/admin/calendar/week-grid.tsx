"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  pointerWithin,
} from "@dnd-kit/core";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { formatDayLabel } from "@/lib/booking/format";
import { canDrag } from "@/lib/calendar/move";
import { overlapLayout } from "@/lib/calendar/overlap-layout";
import type { WeekDay } from "@/lib/calendar/page-data";
import { newBookingPath } from "@/lib/calendar/paths";
import type { CalendarBooking } from "@/lib/calendar/queries";
import type { StaffRole } from "@/lib/calendar/transitions";
import { calendarHref } from "@/lib/calendar/view";
import {
  dayBlockPosition,
  daySlots,
  hhmm,
  initialWeekColumn,
  type WeekGrid,
  weekDropTarget,
  weekNowLine,
} from "@/lib/calendar/week-grid";
import { localDateOf } from "@/lib/domain/local-time";
import { cn } from "@/lib/utils";
import { BookingCard, ColumnDropZone, DraggedCard, NowLine, placed, ROW_HEIGHT } from "./grid-parts";
import { MoveFeedback } from "./move-feedback";
import { useBookingMove } from "./use-booking-move";
import { AUTO_SCROLL, useCalendarDrag } from "./use-calendar-drag";

const t = it.admin.calendar;

/** Destinazione mostrata durante il trascinamento. */
type DropPreview = { bookingId: string; date: string; startsAt: Date };

/**
 * Vista settimana di un barbiere (SPEC §6.1, fetta 8c): una colonna per giorno da lunedì a domenica,
 * senza i giorni di chiusura settimanale fissa del negozio che non hanno prenotazioni da mostrare
 * (visibleWeekDays, li sceglie il server in `days`), con le stesse righe della vista giorno, su un asse comune sull'orologio locale. Si comporta come la vista giorno:
 * ogni riga libera è un link alla nuova prenotazione (fuori orario, assenze e chiusure sono solo
 * sfondo, gli avvisi arrivano dopo, §3.7.5), le righe occupate fino a blocked_until no; le confirmed
 * non iniziate si trascinano (§6.3, ADR 008) su un altro giorno o orario, sempre per lo stesso barbiere.
 *
 * La griglia scorre in entrambe le direzioni dentro il proprio contenitore, alto al massimo quanto lo
 * schermo (dvh), con la colonna delle ore e le intestazioni dei giorni fisse: la pagina non scorre in
 * orizzontale. Il dito scorre il contenitore (nessun touch-action: none); il trascinamento parte solo
 * dopo la pressione prolungata. Durante il trascinamento la destinazione è sempre ciò che si vede: il
 * puntatore sopra la colonna delle ore o le intestazioni (che coprono le colonne sotto) non ha
 * destinazione, e l'autoscroll parte solo vicino ai bordi estremi.
 */
export function WeekGridView({
  grid,
  days,
  barberId,
  barberActive,
  timezone,
  today,
  showCancelled,
  role,
  ownBarberId,
  now,
}: {
  grid: WeekGrid;
  days: WeekDay[];
  barberId: string;
  barberActive: boolean;
  timezone: string;
  /** Oggi nella timezone del negozio, dal server. */
  today: string;
  showCancelled: boolean;
  role: StaffRole;
  ownBarberId: string | null;
  /** Istante del server per mostrare cosa è trascinabile; alla presa si usa l'ora corrente. */
  now: Date;
}) {
  const time = (instant: Date) => formatInTimeZone(instant, timezone, "HH:mm");
  const { positions, notice, dialog, busy, move, reject } = useBookingMove(days);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const dates = days.map((day) => day.date);

  // Posizioni ottimistiche: una scheda spostata passa nella colonna del suo nuovo giorno.
  const bookings = days.flatMap((day) => day.bookings).map((booking) => placed(booking, positions[booking.id]));
  const bookingsOn = (date: string) => bookings.filter((booking) => localDateOf(booking.startsAt, timezone) === date);

  const draggableAt = (booking: CalendarBooking, at: Date): boolean =>
    !busy &&
    canDrag({ role, status: booking.status, startsAt: booking.startsAt, now: at, isOwn: booking.barberId === ownBarberId });

  // All'apertura la colonna di oggi, se è fra quelle disegnate, si porta accanto alla colonna delle
  // ore; altrimenti (oggi fuori settimana o nascosto) il contenitore parte dalla prima colonna.
  const initialColumn = initialWeekColumn(dates, today);
  const firstDate = dates[0];
  useEffect(() => {
    const container = scrollRef.current;
    const corner = cornerRef.current;
    if (!container || !corner) return;
    const column = initialColumn && container.querySelector<HTMLElement>(`[data-date="${initialColumn}"]`);
    if (!column) {
      container.scrollLeft = 0;
      return;
    }
    container.scrollLeft += column.getBoundingClientRect().left - corner.getBoundingClientRect().right;
  }, [firstDate, initialColumn]);

  /**
   * Solo ciò che si vede: fuori dal contenitore, sopra la colonna delle ore o sopra le intestazioni
   * (fisse, coprono le colonne che ci scorrono sotto) non c'è destinazione.
   */
  const visibleOnly: CollisionDetection = (args) => {
    const pointer = args.pointerCoordinates;
    const area = scrollRef.current?.getBoundingClientRect();
    const corner = cornerRef.current?.getBoundingClientRect();
    if (!pointer || !area || !corner) return [];
    const outside = pointer.x < area.left || pointer.x > area.right || pointer.y < area.top || pointer.y > area.bottom;
    if (outside || pointer.x < corner.right || pointer.y < corner.bottom) return [];
    return pointerWithin(args);
  };

  /**
   * Destinazione dell'evento di trascinamento, con la stessa funzione per l'anteprima e per il
   * rilascio: il giorno è la colonna sotto il puntatore, la riga viene da `delta` di dnd-kit, che tiene
   * conto dello scorrimento (anche dell'autoscroll).
   */
  const targetOf = ({ active, over, delta }: DragMoveEvent | DragEndEvent) => {
    const booking = bookings.find((candidate) => candidate.id === active.id);
    const rowHeight = scrollRef.current?.querySelector("[data-grid-row]")?.getBoundingClientRect().height;
    if (!booking || !rowHeight) return null;
    const target = weekDropTarget({
      grid,
      tz: timezone,
      role,
      booking,
      isOwn: booking.barberId === ownBarberId,
      overDate: typeof over?.id === "string" ? over.id : null,
      deltaRows: Math.round(delta.y / rowHeight),
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
      target.kind === "move" ? { bookingId: booking.id, date: target.date, startsAt: target.startsAt } : null,
    onDrop: ({ booking, target }) => {
      if (target.kind === "none") return;
      if (target.kind === "past") {
        reject(t.move.pastTarget);
        return;
      }
      move(
        booking.id,
        { barberId: booking.barberId, startsAt: booking.startsAt },
        { barberId: booking.barberId, startsAt: target.startsAt },
      );
    },
  });

  const labelOf = (booking: CalendarBooking) =>
    `${time(booking.startsAt)}–${time(booking.endsAt)} ${booking.customerName}`;
  const dragged = bookings.find((booking) => booking.id === activeId);

  return (
    <DndContext sensors={sensors} collisionDetection={visibleOnly} autoScroll={AUTO_SCROLL} {...handlers}>
      <MoveFeedback notice={notice} dialog={dialog} busy={busy} />
      {!barberActive && <p className="text-sm text-muted-foreground">{t.inactiveBarberNoBooking}</p>}
      <div
        ref={scrollRef}
        data-week-scroll
        className="max-h-[calc(100dvh-6rem)] min-h-[20rem] overflow-auto border-y border-line"
      >
        {/* Larghezza minima fissa (non max-content): il testo delle schede non allarga le colonne. */}
        <div
          className="grid w-full"
          style={{
            minWidth: `calc(3.5rem + ${days.length} * 7rem)`,
            gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(7rem, 1fr))`,
            gridTemplateRows: `auto repeat(${grid.rows.length}, ${ROW_HEIGHT})`,
          }}
        >
          <div
            ref={cornerRef}
            className="sticky top-0 left-0 z-30 bg-surface pb-2 text-xs font-medium text-muted-foreground"
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            {t.timeColumn}
          </div>
          {grid.rows.map((minutes, index) => {
            const label = hhmm(minutes);
            return (
              <div
                key={minutes}
                data-grid-row
                data-week-hours
                className={cn(
                  "sticky left-0 z-20 border-t bg-surface pt-0.5 text-xs tabular-nums",
                  // Le ore intere guidano la lettura; i quarti d'ora restano in secondo piano.
                  label.endsWith(":00") ? "border-ink/30 text-ink" : "border-line/60 text-ink-disabled",
                )}
                style={{ gridColumn: 1, gridRow: index + 2 }}
              >
                {label}
              </div>
            );
          })}

          {days.map((day, dayIndex) => {
            const gridColumn = dayIndex + 2;
            const dayLabel = formatDayLabel(day.date);
            const dayBookings = bookingsOn(day.date);
            const slots = daySlots({
              date: day.date,
              grid,
              tz: timezone,
              bands: day.bands,
              timeOff: day.periods.filter((period) => period.kind === "timeOff"),
              closures: day.periods.filter((period) => period.kind === "closure"),
              bookings: dayBookings,
              now,
              barberActive,
            });
            const placedBookings = dayBookings.flatMap((booking) => {
              const position = dayBlockPosition(grid, day.date, booking, timezone);
              return position ? [{ booking, position }] : [];
            });
            // Corsie calcolate sulle righe occupate (quelle che si vedono), come nella vista giorno.
            const lanes = overlapLayout(
              placedBookings.map(({ booking, position }) => ({
                id: booking.id,
                start: position.row,
                end: position.row + position.span,
                status: booking.status,
              })),
            );
            const isToday = day.date === today;
            return [
              <h2
                key={`${day.date}-head`}
                className={cn(
                  // Sui dispositivi touch il link occupa tutta l'intestazione, alta 44 px (riga di 20 px + py-3);
                  // su desktop resta compatta. Link block, non flex: ::first-letter (maiuscola) passa solo nei blocchi.
                  "sticky top-0 z-20 border-b bg-surface px-1 pb-2 text-sm font-semibold first-letter:uppercase pointer-coarse:pb-0",
                  isToday ? "border-ink" : "border-transparent",
                  day.closed && "text-muted-foreground",
                )}
                style={{ gridColumn, gridRow: 1 }}
              >
                <Link
                  href={calendarHref({ date: day.date, showCancelled })}
                  className="hover:underline pointer-coarse:block pointer-coarse:py-3"
                >
                  {dayLabel}
                </Link>
              </h2>,
              ...grid.rows.map((minutes, index) => {
                const slot = slots[index];
                const label = hhmm(minutes);
                const cellClass = cn(
                  "border-t",
                  label.endsWith(":00") ? "border-ink/30" : "border-line/60",
                  (slot.kind === "outside" || slot.kind === "nonexistent") && "bg-disabled",
                  (slot.kind === "timeOff" || slot.kind === "closure") && "bg-hatch",
                );
                if (!slot.clickable) {
                  return (
                    <div
                      key={`${day.date}-${minutes}`}
                      className={cn(cellClass, slot.kind === "busy" && "bg-disabled")}
                      title={slot.kind === "busy" ? t.bufferBlock : barberActive ? undefined : t.inactiveBarberNoBooking}
                      style={{ gridColumn, gridRow: index + 2 }}
                    />
                  );
                }
                const name = t.week.newAt.replace("{day}", dayLabel).replace("{time}", label);
                return (
                  <Link
                    key={`${day.date}-${minutes}`}
                    href={newBookingPath({ barberId, date: day.date, time: label })}
                    aria-label={name}
                    title={name}
                    className={cn(cellClass, "block hover:bg-disabled focus-visible:bg-disabled")}
                    style={{ gridColumn, gridRow: index + 2 }}
                  />
                );
              }),
              // Dopo le righe: nei giorni di chiusura totale le attenua; durante il trascinamento è
              // l'area di rilascio del giorno, con il contorno se è quello di arrivo.
              <ColumnDropZone
                key={`${day.date}-drop`}
                id={day.date}
                attributes={{
                  "data-date": day.date,
                  "data-closed": day.closed ? "true" : undefined,
                  "data-today": isToday ? "true" : undefined,
                }}
                gridColumn={gridColumn}
                highlighted={preview?.date === day.date}
                className={day.closed ? "bg-surface/60" : undefined}
              />,
              ...day.periods.map((period, index) => {
                const position = dayBlockPosition(grid, day.date, period, timezone);
                if (!position) return null;
                return (
                  <div
                    key={`${day.date}-period-${index}`}
                    className="pointer-events-none z-[1] self-start bg-surface px-1 text-xs text-muted-foreground"
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
                />
              )),
            ];
          })}
          <NowLine
            serverNow={now}
            rows={grid.rows.length}
            granularityMin={grid.granularityMin}
            locate={(at) => {
              const line = weekNowLine(at, dates, grid, timezone);
              return line && { offset: line.offset, gridColumn: line.index + 2 };
            }}
          />
        </div>
      </div>
      {/* La copia trascinata sta fuori dal contenitore che scorre (vedi la vista giorno). */}
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <DraggedCard
            label={labelOf(dragged)}
            serviceName={dragged.serviceName}
            preview={
              preview?.bookingId === dragged.id
                ? t.move.dropPreviewDay.replace("{day}", formatDayLabel(preview.date)).replace("{time}", time(preview.startsAt))
                : null
            }
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
