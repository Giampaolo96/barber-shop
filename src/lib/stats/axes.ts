import { format } from "date-fns";
import { it as itLocale } from "date-fns/locale";
import { groupThousands } from "@/lib/domain/money";
import { addDays, addMonths, daysInclusive, startOfWeek } from "./dates";
import { formatRate } from "./format";

// Assi di riferimento del grafico dell'andamento: logica pura, senza I/O né orologio. I giorni sono
// già giorni di calendario del negozio (Europe/Rome), quindi il cambio d'ora non sposta nulla:
// si conta in giorni, mai in ore.

/** Fino a questi giorni un'etichetta per giorno, poi una linea ogni lunedì, ogni mese, ogni anno. */
export const AXIS_MAX_DAYS = { day: 10, week: 62, month: 731 } as const;

export type TimeAxisUnit = "day" | "week" | "month" | "year";

export type TimeAxisTick = {
  /** Giorno "YYYY-MM-DD" a cui si riferisce la tacca. */
  day: string;
  label: string;
  /** Linea verticale all'inizio del giorno; senza linea l'etichetta sta al centro del giorno. */
  line: boolean;
};

// Mezzogiorno UTC: lo stesso giorno di calendario per un processo fra UTC-11 e UTC+11 (come in
// format.ts; il server gira in UTC).
const noon = (day: string): Date => new Date(`${day}T12:00:00Z`);
const label = (day: string, pattern: string): string => format(noon(day), pattern, { locale: itLocale });

/** Tacche dell'asse X per il periodo `start`–`end` (estremi inclusi), scelte in base alla sua ampiezza. */
export function timeAxisTicks(start: string, end: string): { unit: TimeAxisUnit; ticks: TimeAxisTick[] } {
  const days = daysInclusive(start, end);

  if (days <= AXIS_MAX_DAYS.day) {
    const ticks: TimeAxisTick[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) ticks.push({ day, label: label(day, "EEE"), line: false });
    return { unit: "day", ticks };
  }

  if (days <= AXIS_MAX_DAYS.week) {
    const ticks: TimeAxisTick[] = [];
    const firstMonday = startOfWeek(start) === start ? start : addDays(startOfWeek(start), 7);
    for (let day = firstMonday; day <= end; day = addDays(day, 7)) ticks.push({ day, label: label(day, "d LLL"), line: true });
    return { unit: "week", ticks };
  }

  if (days <= AXIS_MAX_DAYS.month) {
    const ticks: TimeAxisTick[] = [];
    const firstMonth = start.endsWith("-01") ? start : addMonths(start, 1);
    for (let day = firstMonth; day <= end; day = addMonths(day, 1)) {
      const withYear = ticks.length === 0 || day.slice(5, 7) === "01";
      ticks.push({ day, label: label(day, withYear ? "LLL yyyy" : "LLL"), line: true });
    }
    return { unit: "month", ticks };
  }

  const ticks: TimeAxisTick[] = [];
  const firstYear = Number(start.slice(0, 4)) + (start.endsWith("-01-01") ? 0 : 1);
  for (let year = firstYear; `${year}-01-01` <= end; year += 1) {
    ticks.push({ day: `${year}-01-01`, label: String(year), line: true });
  }
  return { unit: "year", ticks };
}

/**
 * Posizione orizzontale (0..1) di un istante del giorno `day` sull'asse dei bucket, che hanno tutti
 * la stessa larghezza anche se coprono un numero diverso di giorni: `fraction` 0 è l'inizio del
 * giorno, 0.5 il centro. `null` se il giorno è fuori dai bucket.
 */
export function bucketPosition(
  day: string,
  buckets: readonly { start: string; end: string }[],
  fraction = 0,
): number | null {
  const index = buckets.findIndex((bucket) => bucket.start <= day && day <= bucket.end);
  if (index === -1) return null;
  const bucket = buckets[index];
  const offset = (daysInclusive(bucket.start, day) - 1 + fraction) / daysInclusive(bucket.start, bucket.end);
  return (index + offset) / buckets.length;
}

export type ChartAxisMark = {
  /** Giorno "YYYY-MM-DD" della tacca. */
  day: string;
  label: string;
  /** Centro (0..1) della barra a cui appartiene l'etichetta. */
  at: number;
  /** Indice della barra alla cui sinistra, sul confine con la precedente, passa la linea; null senza linea. */
  line: number | null;
};

/**
 * Asse X sopra le barre dell'andamento. Le linee cadono sempre sul confine fra due bucket, mai
 * dentro una barra; l'etichetta sta sotto la barra che inizia sulla linea.
 * - Barre per mese: un'etichetta sotto ogni barra, una linea solo fra due anni diversi.
 * - Nomi dei giorni: al centro del loro giorno, senza linee.
 * - Lunedì e mesi su barre per giorno o per settimana: sul bucket che inizia in quel giorno; se non
 *   ce n'è uno (inizio mese a metà settimana) sul confine più vicino, e la tacca salta se è la fine
 *   del periodo o un confine già usato.
 * `perBar` dice se le etichette vanno centrate ciascuna sotto la propria barra.
 */
export function chartAxis(
  buckets: readonly { start: string; end: string }[],
  granularity: "giorno" | "settimana" | "mese",
): { unit: TimeAxisUnit; perBar: boolean; marks: ChartAxisMark[] } {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last) return { unit: "day", perBar: true, marks: [] };
  const count = buckets.length;

  if (granularity === "mese") {
    const marks = buckets.map((bucket, index) => {
      const january = bucket.start.slice(5, 7) === "01";
      return {
        day: bucket.start,
        label: label(bucket.start, index === 0 || january ? "LLL yyyy" : "LLL"),
        at: (index + 0.5) / count,
        line: index > 0 && january ? index : null,
      };
    });
    return { unit: "month", perBar: true, marks };
  }

  const { unit, ticks } = timeAxisTicks(first.start, last.end);
  if (unit === "day") {
    const marks = ticks.flatMap((tick) => {
      const at = bucketPosition(tick.day, buckets, 0.5);
      return at === null ? [] : [{ day: tick.day, label: tick.label, at, line: null }];
    });
    return { unit, perBar: true, marks };
  }

  // Confini possibili: l'inizio di ogni bucket e la fine del periodo (indice `count`).
  const boundaries = [...buckets.map((bucket) => bucket.start), addDays(last.end, 1)];
  const distance = (a: string, b: string): number => Math.abs(daysInclusive(a, b) - 1);
  const used = new Set<number>();
  const marks: ChartAxisMark[] = [];
  for (const tick of ticks) {
    let index = boundaries.indexOf(tick.day);
    if (index === -1) {
      index = 0;
      boundaries.forEach((boundary, candidate) => {
        if (distance(tick.day, boundary) <= distance(tick.day, boundaries[index])) index = candidate;
      });
    }
    if (index === count || used.has(index)) continue;
    used.add(index);
    marks.push({ day: tick.day, label: tick.label, at: (index + 0.5) / count, line: index > 0 ? index : null });
  }
  return { unit, perBar: false, marks };
}

/**
 * Etichette dell'asse X da tenere quando non ci stanno tutte (una sì e una no). Le etichette con
 * l'anno ("gen 2027") restano sempre; le altre si alternano senza mai stare accanto a una visibile.
 * La prima etichetta perde la precedenza se la seconda ha l'anno: due anni vicini non ci stanno.
 */
export function alternateLabels(labels: readonly string[]): boolean[] {
  const hasYear = (index: number): boolean => /\s\d{4}$/.test(labels[index] ?? "");
  const pinned = labels.map((_, index) => hasYear(index) && !(index === 0 && hasYear(1)));
  const visible: boolean[] = [];
  labels.forEach((_, index) => {
    visible.push(pinned[index] || (!visible[index - 1] && !pinned[index + 1]));
  });
  return visible;
}

/** Tipo di valore sull'asse Y: conteggi interi, centesimi mostrati in euro interi, tassi 0..1. */
export type ValueKind = "count" | "cents" | "rate";

const NICE_MULTIPLIERS = [1, 2, 2.5, 5] as const;

/**
 * Tacche "tonde" dell'asse Y da 0 al primo valore tondo ≥ `max`: da 3 a 5 tacche, a passi di
 * 1, 2, 2,5 o 5 × 10^n, scegliendo la cima più bassa (a parità, più tacche). Conteggi ed euro
 * solo interi; i tassi hanno sempre la scala 0–100%. Un massimo ≤ 0 vale come 1.
 * Le tacche sono nella stessa unità dei valori (centesimi per "cents").
 */
export function niceScale(max: number, kind: ValueKind): { ticks: number[]; top: number } {
  if (kind === "rate") return { ticks: [0, 0.25, 0.5, 0.75, 1], top: 1 };

  const unit = kind === "cents" ? 100 : 1;
  const target = Math.max(1, Math.ceil(max / unit));
  let best = { step: 1, count: 2 }; // ripiego per target 1: 0, 1, 2
  let bestTop = Infinity;
  for (let power = 1; power <= target; power *= 10) {
    for (const multiplier of NICE_MULTIPLIERS) {
      const step = multiplier * power;
      if (!Number.isInteger(step)) continue;
      const count = Math.ceil(target / step);
      if (count < 2 || count > 4) continue;
      const top = count * step;
      if (top < bestTop || (top === bestTop && count > best.count)) {
        best = { step, count };
        bestTop = top;
      }
    }
  }

  const ticks = Array.from({ length: best.count + 1 }, (_, index) => index * best.step * unit);
  return { ticks, top: best.count * best.step * unit };
}

/** Etichetta di una tacca Y: "1.200", "1.500 €" (euro interi, it-IT), "25%". */
export function formatAxisValue(value: number, kind: ValueKind): string {
  if (kind === "rate") return formatRate(value);
  if (kind === "cents") return `${groupThousands(Math.round(value / 100))} €`;
  return groupThousands(value);
}
