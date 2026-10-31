"use client";

// Parti comuni alle griglie del calendario staff (vista giorno e vista settimana, fette 6c, 8b, 8c).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { it } from "@/i18n/it";
import type { LaneSlot } from "@/lib/calendar/overlap-layout";
import { bookingDetailPath } from "@/lib/calendar/paths";
import type { CalendarBooking } from "@/lib/calendar/queries";
import type { cardGeometry } from "@/lib/calendar/grid";
import { isCancelledStatus } from "@/lib/calendar/transitions";
import { cn } from "@/lib/utils";
import type { Position } from "./use-booking-move";

const t = it.admin.calendar;
/** Altezza di una riga: la variabile cambia con la larghezza (44 px su telefono, 36 su desktop). */
export const ROW_HEIGHT = "var(--calendar-row)";
export const GRID_ROW_CLASS = "[--calendar-row:2.75rem] md:[--calendar-row:2.25rem]";

/** Geometria esatta (`cardGeometry`) e passo della griglia. */
export type CardBox = ReturnType<typeof cardGeometry> & { granularityMin: number };

const minutesToHeight = (minutes: number, granularityMin: number): string => `${minutes / granularityMin} * ${ROW_HEIGHT}`;

/** Sotto i 15 minuti la scheda è più bassa di due righe di testo: una riga sola. */
const COMPACT_BELOW_MIN = 15;
/** Fino a qui le due righe di testo stanno solo senza spazio sopra e sotto. */
const TIGHT_BELOW_MIN = 20;

/** Prenotazione nella posizione mostrata (quella ottimistica durante uno spostamento). */
export const placed = (booking: CalendarBooking, position: Position | undefined): CalendarBooking => {
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
 * Linea dell'ora attuale (fetta 8b): `locate` dice dove disegnarla (minuti dall'inizio della griglia e
 * colonna) oppure null se l'ora attuale non è nella griglia. Aggiornata ogni minuto; parte dall'istante
 * del server per non cambiare l'HTML all'idratazione.
 */
export function NowLine({
  serverNow,
  rows,
  granularityMin,
  locate,
}: {
  serverNow: Date;
  rows: number;
  granularityMin: number;
  locate: (now: Date) => { offset: number; gridColumn: string | number } | null;
}) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const place = locate(now);
  if (!place) return null;

  return (
    <div
      aria-hidden="true"
      data-now-line
      className="pointer-events-none relative z-10"
      style={{ gridColumn: place.gridColumn, gridRow: `2 / span ${rows}` }}
    >
      <div
        className="absolute inset-x-0 flex items-center"
        style={{ top: `calc(${place.offset / granularityMin} * ${ROW_HEIGHT})` }}
      >
        <span className="size-2 shrink-0 rounded-full bg-ink" />
        <span className="h-0.5 flex-1 bg-ink" />
      </div>
    </div>
  );
}

/**
 * Area di una colonna su cui si rilascia una scheda; non intercetta i click sulle righe. Durante il
 * trascinamento la colonna di arrivo ha un contorno pieno (`data-drop-target`). `attributes` porta gli
 * attributi propri della vista (es. `data-barber-id`, `data-date`); `className` uno sfondo in più.
 */
export function ColumnDropZone({
  id,
  gridColumn,
  highlighted,
  attributes,
  className,
}: {
  id: string;
  gridColumn: number;
  highlighted: boolean;
  attributes: Record<string, string | undefined>;
  className?: string;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      data-drop-target={highlighted ? "true" : undefined}
      aria-hidden
      className={cn("pointer-events-none", className, highlighted && "z-[5] outline-2 -outline-offset-2 outline-ink")}
      style={{ gridColumn, gridRow: "2 / -1" }}
    />
  );
}

/**
 * Scheda di una prenotazione. Se si sovrappone ad altre (una cancellata nello stesso orario di una
 * confermata) occupa solo la sua corsia: larghezza 1/lanes, spostata di lane/lanes. Quando la
 * corsia è troppo stretta per il testo mostra l'ora e il nome del cliente troncato; il testo
 * completo resta nel titolo e nel nome accessibile. Una cancellata in corsia condivisa sta un livello
 * sotto le altre schede (ma sopra le righe), così la confermata resta in primo piano. Se è trascinabile non usa gli attributi ARIA di dnd-kit (resta un
 * link verso il dettaglio, dove c'è anche il modulo per spostarla) e niente menu del link né
 * selezione del testo alla pressione prolungata su iOS. Quando la si afferra si ricontrolla con
 * l'ora corrente (`canGrab`): con la pagina aperta a lungo l'appuntamento può essere iniziato.
 */
export function BookingCard({
  booking,
  label,
  lane,
  timeLabel,
  draggable,
  canGrab,
  style,
  box,
}: {
  booking: CalendarBooking;
  label: string;
  /** Corsia nel gruppo di schede sovrapposte; assente o `lanes` = 1 se a larghezza piena. */
  lane: LaneSlot | undefined;
  timeLabel: string;
  draggable: boolean;
  canGrab: () => boolean;
  style: React.CSSProperties;
  box: CardBox;
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
  const cancelled = isCancelledStatus(booking.status);
  const details = `${booking.serviceName}${booking.status === "confirmed" ? "" : `, ${t.statusLabels[booking.status]}`}`;
  const shared = lane !== undefined && lane.lanes > 1;
  // Il margine di 1 px (m-px) resta su entrambi i lati della corsia.
  const laneStyle: React.CSSProperties = shared
    ? { width: `calc(100% / ${lane.lanes} - 2px)`, marginLeft: `calc(100% * ${lane.lane} / ${lane.lanes} + 1px)` }
    : {};
  const compact = box.serviceMin < COMPACT_BELOW_MIN;
  const fullName = `${label}, ${details}`;
  const boxStyle: React.CSSProperties = {
    alignSelf: "start",
    marginTop: `calc(${minutesToHeight(box.offsetMin, box.granularityMin)} + 1px)`,
    height: `calc(${minutesToHeight(box.serviceMin, box.granularityMin)} - 2px)`,
  };
  return (
    <>
    <Link
      ref={setNodeRef}
      href={bookingDetailPath(booking.id)}
      draggable={false}
      data-draggable={draggable ? "true" : undefined}
      data-lane={shared ? `${lane.lane}/${lane.lanes}` : undefined}
      data-booking-compact={compact ? "true" : undefined}
      aria-label={shared || compact ? fullName : undefined}
      title={shared || compact ? fullName : undefined}
      {...grabListeners}
      className={cn(
        "relative m-px flex flex-col overflow-hidden rounded-md border bg-surface px-2 text-xs",
        // Alta una riga meno i margini: l'area di tocco li riprende, fino alla scheda vicina e non oltre.
        box.serviceMin === box.granularityMin &&
          "max-md:overflow-visible max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-0.5 max-md:after:content-['']",
        box.serviceMin < TIGHT_BELOW_MIN ? "py-0" : "py-1",
        booking.status === "confirmed" && "border-ink",
        booking.status === "completed" && "border-line text-muted-foreground",
        booking.status === "no_show" && "border-destructive text-destructive",
        cancelled && "border-dashed border-line text-ink-disabled line-through",
        draggable && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
        // Durante il trascinamento resta al suo posto, tratteggiata: si muove la copia.
        isDragging && "border-dashed",
        shared && "@container",
        shared && cancelled ? "z-[9]" : "z-10",
      )}
      style={{ ...style, ...laneStyle, ...boxStyle }}
    >
      {/* Il ritaglio sta qui: una scheda da una riga lascia uscire solo l'area di tocco. */}
      <span className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {compact ? (
        <span className="w-0 min-w-full truncate font-medium">
          {timeLabel} {booking.customerName}
        </span>
      ) : shared ? (
        <>
          <span className="font-medium @max-[7rem]:hidden">{label}</span>
          <span className="@max-[7rem]:hidden">{details}</span>
          <span aria-hidden="true" className="hidden truncate font-medium @max-[7rem]:block">
            {timeLabel} {booking.customerName}
          </span>
        </>
      ) : (
        <>
          <span className="font-medium">{label}</span>
          <span>{details}</span>
        </>
      )}
      </span>
    </Link>
    {box.bufferMin > 0 && booking.status === "confirmed" && (
      <div
        data-booking-buffer
        title={t.bufferBlock}
        className="pointer-events-none z-[9] m-px rounded-b-md border border-t-0 border-line bg-disabled"
        style={{
          gridColumn: style.gridColumn,
          gridRow: style.gridRow,
          ...laneStyle,
          alignSelf: "start",
          marginTop: `calc(${minutesToHeight(box.offsetMin + box.serviceMin, box.granularityMin)} - 1px)`,
          height: `calc(${minutesToHeight(box.bufferMin, box.granularityMin)})`,
        }}
      />
    )}
    </>
  );
}

/**
 * Copia della scheda che segue il puntatore, con la destinazione (es. "Mario, 10:30" o "gio 15 gen,
 * 10:30"): si aggiorna anche durante l'autoscroll, con la stessa funzione usata al rilascio.
 */
export function DraggedCard({ label, serviceName, preview }: { label: string; serviceName: string; preview: string | null }) {
  return (
    // Larghezza minima: trascinata da una corsia condivisa la copia sarebbe stretta come la corsia.
    <div className="flex h-full min-w-[11rem] cursor-grabbing flex-col overflow-hidden rounded-md border border-ink bg-surface px-2 py-1 text-xs select-none">
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
