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
