// Griglia del calendario dello staff (SPEC §6.1): logica pura, senza I/O. Le righe sono istanti
// reali ogni `granularityMin` minuti: nei giorni del cambio d'ora la giornata dura 23 o 25 ore e
// le etichette locali saltano o si ripetono (CLAUDE.md regola 2).
import { formatInTimeZone } from "date-fns-tz";
import { addDays, localDateTimeToUtc } from "@/lib/domain/local-time";

/** Fascia di lavoro in ora locale del negozio, `HH:MM` (anche `HH:MM:SS` dal database). */
export type LocalBand = { start: string; end: string };
export type Interval = { startsAt: Date; endsAt: Date };
export type DayGrid = { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] };

const MINUTE = 60_000;
/** Giornata mostrata quando non ci sono né fasce né prenotazioni (giorno di riposo). */
const FALLBACK: LocalBand = { start: "09:00", end: "19:00" };

const hhmm = (time: string): string => time.slice(0, 5);

/** Fasce locali del giorno `date` → intervalli reali. */
export function localBandsToIntervals(date: string, bands: LocalBand[], tz: string): Interval[] {
  return bands.map((band) => ({
    startsAt: localDateTimeToUtc(date, hhmm(band.start), tz),
    endsAt: localDateTimeToUtc(date, hhmm(band.end), tz),
  }));
}

/** Minuti trascorsi dalla mezzanotte sull'orologio locale. */
const localMinutes = (instant: Date, tz: string): number => {
  const [hours, minutes] = formatInTimeZone(instant, tz, "HH:mm").split(":").map(Number);
  return hours * 60 + minutes;
};

/** Arrotonda l'istante alla griglia dell'orologio locale, per difetto o per eccesso. */
const alignToGrid = (instant: Date, tz: string, step: number, mode: "floor" | "ceil"): Date => {
  const round = mode === "floor" ? Math.floor : Math.ceil;
  const whole = round(instant.getTime() / MINUTE) * MINUTE;
  const minutes = localMinutes(new Date(whole), tz);
  return new Date(whole + (round(minutes / step) * step - minutes) * MINUTE);
};

/**
 * Griglia del giorno: dall'inizio più presto fra fasce e prenotazioni (per difetto) alla fine più
 * tarda (per eccesso). Senza fasce né prenotazioni 09:00–19:00.
 */
export function dayGrid(input: {
  date: string;
  tz: string;
  granularityMin: number;
  bands: LocalBand[];
  bookings: Interval[];
}): DayGrid {
  const { date, tz, granularityMin: step } = input;
  const bands = input.bands.length === 0 && input.bookings.length === 0 ? [FALLBACK] : input.bands;
  const intervals = [...localBandsToIntervals(date, bands, tz), ...input.bookings];

  const first = Math.min(...intervals.map((interval) => interval.startsAt.getTime()));
  const last = Math.max(...intervals.map((interval) => interval.endsAt.getTime()));
  const startsAt = alignToGrid(new Date(first), tz, step, "floor");
  const endsAt = alignToGrid(new Date(last), tz, step, "ceil");

  const rows: Date[] = [];
  for (let at = startsAt.getTime(); at < endsAt.getTime(); at += step * MINUTE) rows.push(new Date(at));
  return { startsAt, endsAt, granularityMin: step, rows };
}

/** Riga di inizio e righe occupate da un blocco, ritagliato alla griglia; null se fuori. */
export function blockPosition(grid: DayGrid, block: Interval): { row: number; span: number } | null {
  const from = Math.max(block.startsAt.getTime(), grid.startsAt.getTime());
  const to = Math.min(block.endsAt.getTime(), grid.endsAt.getTime());
  if (from >= to) return null;

  const stepMs = grid.granularityMin * MINUTE;
  const row = Math.floor((from - grid.startsAt.getTime()) / stepMs);
  const end = Math.ceil((to - grid.startsAt.getTime()) / stepMs);
  return { row, span: Math.max(end - row, 1) };
}

/**
 * Righe occupate: quelle che iniziano dentro un intervallo. Per le prenotazioni si passa
 * `[starts_at, blocked_until)`, così anche le righe del buffer risultano occupate.
 */
export function busyRows(grid: DayGrid, blocks: Interval[]): boolean[] {
  return grid.rows.map((row) =>
    blocks.some(
      (block) => block.startsAt.getTime() <= row.getTime() && row.getTime() < block.endsAt.getTime(),
    ),
  );
}

/** Giorno della settimana ISO (1 = lunedì … 7 = domenica) di una data `YYYY-MM-DD`. */
export function isoWeekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

/** Le 7 date della settimana di `date`, da lunedì a domenica. */
export function weekDates(date: string): string[] {
  const monday = addDays(date, 1 - isoWeekday(date));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
