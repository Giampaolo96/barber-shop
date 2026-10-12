// Griglia della vista settimana del calendario staff (SPEC §6.1, §6.3, fetta 8c): logica pura, senza
// I/O. A differenza della vista giorno le righe sono un asse comune ai 7 giorni sull'orologio locale
// (minuti dalla mezzanotte): l'istante di una riga si calcola per ogni giorno (CLAUDE.md regola 2).
// Nel passaggio all'ora legale le righe del buco non esistono; nel ritorno all'ora solare l'ora
// ripetuta compare una volta sola e vale la prima occorrenza.
import { formatInTimeZone } from "date-fns-tz";
import { addDays, exactLocalDateTimeToUtc, localDateOf, startOfLocalDay } from "@/lib/domain/local-time";
import { covers, type Interval, isoWeekday, type LocalBand } from "./grid";
import { nowLineMinutes } from "./now-line";
import { type BookingStatus, isCancelledStatus, type StaffRole } from "./transitions";

/** Asse delle righe: minuti locali da `startMin` (incluso) a `endMin` (escluso), ogni `granularityMin`. */
export type WeekGrid = { granularityMin: number; startMin: number; endMin: number; rows: number[] };

export type SlotKind = "free" | "busy" | "outside" | "timeOff" | "closure" | "nonexistent";
export type SlotState = { kind: SlotKind; past: boolean; clickable: boolean };

const MINUTES_PER_DAY = 24 * 60;
/** Settimana senza fasce né prenotazioni: come dayGrid. */
const FALLBACK = { start: 9 * 60, end: 19 * 60 };

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

/** Minuti dalla mezzanotte → "HH:MM" (etichette delle righe e parametro `ora`). */
export const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Minuto locale dell'istante (orologio del negozio). */
export function localMinute(instant: Date, tz: string): number {
  return minutesOf(formatInTimeZone(instant, tz, "HH:mm"));
}

/** Minuto locale della fine, ritagliata a 24:00 se cade in un giorno successivo all'inizio. */
const endMinute = (interval: Interval, tz: string): number => {
  const startDay = localDateOf(interval.startsAt, tz);
  const endDay = localDateOf(interval.endsAt, tz);
  if (endDay !== startDay) return MINUTES_PER_DAY;
  return localMinute(interval.endsAt, tz);
};

/**
 * Asse comune ai 7 giorni: dall'inizio più presto fra fasce e prenotazioni (per difetto alla griglia)
 * alla fine più tarda (per eccesso). Una prenotazione oltre la mezzanotte si ferma alle 24:00.
 */
export function weekGrid(input: {
  dates: string[];
  tz: string;
  granularityMin: number;
  bands: Record<string, LocalBand[]>;
  bookings: Interval[];
}): WeekGrid {
  const { tz, granularityMin: step } = input;
  const spans = [
    ...input.dates.flatMap((date) =>
      (input.bands[date] ?? []).map((band) => ({ start: minutesOf(band.start), end: minutesOf(band.end) })),
    ),
    ...input.bookings.map((booking) => ({ start: localMinute(booking.startsAt, tz), end: endMinute(booking, tz) })),
  ];
  const all = spans.length === 0 ? [FALLBACK] : spans;
  const startMin = Math.floor(Math.min(...all.map((span) => span.start)) / step) * step;
  const endMin = Math.min(Math.ceil(Math.max(...all.map((span) => span.end)) / step) * step, MINUTES_PER_DAY);

  const rows: number[] = [];
  for (let minute = startMin; minute < endMin; minute += step) rows.push(minute);
  return { granularityMin: step, startMin, endMin, rows };
}

/** Istante della riga `minutes` del giorno locale `date`; null se l'ora non esiste (ora legale). */
export function slotInstant(date: string, minutes: number, tz: string): Date | null {
  if (minutes >= MINUTES_PER_DAY) return startOfLocalDay(addDays(date, 1), tz);
  const instant = exactLocalDateTimeToUtc(date, hhmm(minutes), tz);
  if (!instant) return null;
  // Ora ripetuta: se un'ora prima l'orologio segnava la stessa ora, quella è la prima occorrenza.
  const earlier = new Date(instant.getTime() - 60 * 60_000);
  const same = formatInTimeZone(earlier, tz, "yyyy-MM-dd HH:mm") === `${date} ${hhmm(minutes)}`;
  return same ? earlier : instant;
}

/**
 * Stato di ogni riga del giorno (stesso ordine di `grid.rows`), come nella vista giorno: occupate
 * fino a `blocked_until` solo dalle confirmed; fuori orario, assenze e chiusure sono sfondo ma restano
 * cliccabili (gli avvisi li mostra poi il server, §3.7.5). `past` è solo informativo.
 */
export function daySlots(input: {
  date: string;
  grid: WeekGrid;
  tz: string;
  bands: Interval[];
  timeOff: Interval[];
  closures: Interval[];
  bookings: Array<{ status: BookingStatus; startsAt: Date; blockedUntil: Date }>;
  now: Date;
  barberActive: boolean;
}): SlotState[] {
  const busy = input.bookings
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => ({ startsAt: booking.startsAt, endsAt: booking.blockedUntil }));

  return input.grid.rows.map((minutes) => {
    const instant = slotInstant(input.date, minutes, input.tz);
    if (!instant) return { kind: "nonexistent", past: false, clickable: false };
    const kind: SlotKind = busy.some((interval) => covers(interval, instant))
      ? "busy"
      : input.closures.some((interval) => covers(interval, instant))
        ? "closure"
        : input.timeOff.some((interval) => covers(interval, instant))
          ? "timeOff"
          : input.bands.some((interval) => covers(interval, instant))
            ? "free"
            : "outside";
    return { kind, past: instant.getTime() <= input.now.getTime(), clickable: input.barberActive && kind !== "busy" };
  });
}

/** Il negozio è chiuso per l'intera giornata locale (23 o 25 ore nei giorni del cambio d'ora). */
export function isClosedDay(date: string, closures: Interval[], tz: string): boolean {
  const dayEnd = startOfLocalDay(addDays(date, 1), tz).getTime();
  let reached = startOfLocalDay(date, tz).getTime();
  const sorted = [...closures].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const closure of sorted) {
    if (closure.startsAt.getTime() > reached) break;
    reached = Math.max(reached, closure.endsAt.getTime());
    if (reached >= dayEnd) return true;
  }
  return reached >= dayEnd;
}

/** Riga in cui una prenotazione è disegnata: minuto locale dell'inizio, per difetto alla griglia. */
export function bookingRow(grid: WeekGrid, startsAt: Date, tz: string): number {
  return Math.floor((localMinute(startsAt, tz) - grid.startMin) / grid.granularityMin);
}

export type WeekDropTarget =
  | { kind: "none" }
  | { kind: "past"; date: string; startsAt: Date }
  | { kind: "move"; date: string; startsAt: Date };

/**
 * Destinazione di un trascinamento nella vista settimana, la stessa per l'anteprima e per il
 * rilascio: giorno sotto il puntatore (`overDate`, null se il puntatore non è su una colonna visibile)
 * e riga di arrivo. Il barbiere non cambia mai. Permessi come nella vista giorno: il barbiere (non
 * admin) solo le proprie. `past` se l'arrivo non è futuro (non ammesso).
 */
export function weekDropTarget(input: {
  grid: WeekGrid;
  tz: string;
  role: StaffRole;
  booking: { barberId: string; startsAt: Date };
  isOwn: boolean;
  overDate: string | null;
  deltaRows: number;
  now: Date;
}): WeekDropTarget {
  const { grid, tz, booking, overDate } = input;
  if (!overDate || (input.role !== "admin" && !input.isOwn)) return { kind: "none" };
  const fromDate = localDateOf(booking.startsAt, tz);
  if (overDate === fromDate && input.deltaRows === 0) return { kind: "none" };

  const minutes = grid.rows[bookingRow(grid, booking.startsAt, tz) + input.deltaRows];
  if (minutes === undefined) return { kind: "none" };
  const startsAt = slotInstant(overDate, minutes, tz);
  if (!startsAt || startsAt.getTime() === booking.startsAt.getTime()) return { kind: "none" };
  if (startsAt.getTime() <= input.now.getTime()) return { kind: "past", date: overDate, startsAt };
  return { kind: "move", date: overDate, startsAt };
}

/**
 * Riga di inizio e righe occupate da un blocco nella colonna del giorno `date`, ritagliato al giorno
 * (00:00–24:00 locali) e all'asse; null se non si vede. Come blockPosition della vista giorno, ma
 * sull'orologio locale.
 */
export function dayBlockPosition(
  grid: WeekGrid,
  date: string,
  block: Interval,
  tz: string,
): { row: number; span: number } | null {
  // Minuto locale dell'istante nel giorno `date`: 0 se cade prima, 24:00 se cade dopo.
  const clip = (instant: Date): number => {
    const day = localDateOf(instant, tz);
    if (day < date) return 0;
    return day > date ? MINUTES_PER_DAY : localMinute(instant, tz);
  };
  const start = Math.max(clip(block.startsAt), grid.startMin);
  const end = Math.min(clip(block.endsAt), grid.endMin);
  if (start >= end) return null;
  const row = Math.floor((start - grid.startMin) / grid.granularityMin);
  const last = Math.ceil((end - grid.startMin) / grid.granularityMin);
  return { row, span: Math.max(last - row, 1) };
}

/**
 * Giorni della settimana da disegnare: quelli in cui il negozio ha orari di apertura (`openWeekdays`,
 * weekday ISO di shop_opening_hours) più quelli con prenotazioni da mostrare (le stesse che si
 * disegnano: tutte tranne le cancellate, che contano solo con `showCancelled`). Le chiusure straordinarie non nascondono il giorno. Ordine di `dates`.
 */
export function visibleWeekDays(input: {
  dates: string[];
  openWeekdays: number[];
  bookings: Array<{ status: BookingStatus; startsAt: Date }>;
  showCancelled: boolean;
  tz: string;
}): string[] {
  const withBookings = new Set(
    input.bookings
      .filter((booking) => input.showCancelled || !isCancelledStatus(booking.status))
      .map((booking) => localDateOf(booking.startsAt, input.tz)),
  );
  return input.dates.filter((date) => input.openWeekdays.includes(isoWeekday(date)) || withBookings.has(date));
}

/**
 * Colonna da portare accanto alla colonna delle ore all'apertura: oggi, se è fra i giorni disegnati;
 * altrimenti null e il contenitore parte dalla prima colonna.
 */
export function initialWeekColumn(dates: string[], today: string): string | null {
  return dates.includes(today) ? today : null;
}

/**
 * Linea dell'ora attuale nella vista settimana: colonna del giorno (indice in `dates`) e minuti
 * dall'inizio dell'asse, con nowLineMinutes come nella vista giorno; null se oggi non è fra i giorni
 * disegnati (`dates`, anche se nascosto perché il negozio è chiuso) o l'ora è fuori dall'asse. Nei giorni del cambio d'ora i minuti sono reali mentre l'asse
 * segue l'orologio: limite noto (ADR 008), riguarda solo la notte.
 */
export function weekNowLine(
  now: Date,
  dates: string[],
  grid: WeekGrid,
  tz: string,
): { index: number; offset: number } | null {
  const index = dates.indexOf(localDateOf(now, tz));
  if (index < 0) return null;
  const offset = nowLineMinutes(now, dates[index], tz, grid.startMin, grid.endMin);
  return offset === null ? null : { index, offset };
}
