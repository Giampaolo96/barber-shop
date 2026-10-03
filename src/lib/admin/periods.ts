// Periodi di assenza e chiusura: conversione fra il modulo (ora locale del negozio) e i
// timestamptz del database. Logica pura, senza I/O.
import { addDays, allDayRangeToUtc, localDateTimeToUtc, utcToLocalParts } from "./local-time";
import type { Period } from "./schemas";

/** Periodo del modulo → intervallo UTC [startsAt, endsAt). */
export function periodToUtc(period: Period, tz: string): { startsAt: Date; endsAt: Date } {
  if (period.mode === "allDay") return allDayRangeToUtc(period.fromDate, period.toDate, tz);
  const [startDate, startTime] = period.start.split("T");
  const [endDate, endTime] = period.end.split("T");
  return {
    startsAt: localDateTimeToUtc(startDate, startTime, tz),
    endsAt: localDateTimeToUtc(endDate, endTime, tz),
  };
}

export type PeriodView =
  | { mode: "allDay"; fromDate: string; toDate: string }
  | { mode: "timed"; fromDate: string; fromTime: string; toDate: string; toTime: string };

/**
 * Intervallo UTC → periodo in ora locale. Da mezzanotte a mezzanotte è "a giornata intera" e
 * l'ultimo giorno mostrato è quello prima della fine (la fine è esclusa).
 */
export function describePeriod(startsAt: Date, endsAt: Date, tz: string): PeriodView {
  const start = utcToLocalParts(startsAt, tz);
  const end = utcToLocalParts(endsAt, tz);
  if (start.time === "00:00" && end.time === "00:00" && end.date > start.date) {
    return { mode: "allDay", fromDate: start.date, toDate: addDays(end.date, -1) };
  }
  return { mode: "timed", fromDate: start.date, fromTime: start.time, toDate: end.date, toTime: end.time };
}
