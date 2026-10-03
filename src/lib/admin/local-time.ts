// Conversione fra ora locale del negozio e UTC (CLAUDE.md regola 2): la timezone è sempre un
// parametro (shop_settings.timezone), mai quella del server.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type LocalParts = { date: string; time: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Data di calendario `YYYY-MM-DD` esistente (niente 30 febbraio). */
export function isValidLocalDate(date: string): boolean {
  const match = DATE_PATTERN.exec(date);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

/** Ora `HH:mm` fra 00:00 e 23:59. */
export function isValidLocalTime(time: string): boolean {
  return TIME_PATTERN.test(time);
}

/** Giorno di calendario `YYYY-MM-DD` spostato di n giorni, senza la timezone del processo. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const nextDate = (date: string): string => addDays(date, 1);

/** Data e ora locali del negozio → istante UTC. Lancia un errore se l'input non è valido. */
export function localDateTimeToUtc(date: string, time: string, tz: string): Date {
  if (!isValidLocalDate(date)) throw new Error(`data non valida: ${date}`);
  if (!isValidLocalTime(time)) throw new Error(`ora non valida: ${time}`);
  return fromZonedTime(`${date}T${time}:00`, tz);
}

/** Istante UTC → data e ora locali del negozio. */
export function utcToLocalParts(d: Date, tz: string): LocalParts {
  return {
    date: formatInTimeZone(d, tz, "yyyy-MM-dd"),
    time: formatInTimeZone(d, tz, "HH:mm"),
  };
}

/**
 * "Dal X al Y" a giornata intera: dalle 00:00 di X alle 00:00 del giorno dopo Y (Y incluso),
 * ora locale del negozio. Lancia un errore se le date non sono valide o Y precede X.
 */
export function allDayRangeToUtc(
  fromDate: string,
  toDate: string,
  tz: string,
): { startsAt: Date; endsAt: Date } {
  if (!isValidLocalDate(fromDate)) throw new Error(`data non valida: ${fromDate}`);
  if (!isValidLocalDate(toDate)) throw new Error(`data non valida: ${toDate}`);
  if (toDate < fromDate) throw new Error("la data di fine precede quella di inizio");

  return {
    startsAt: localDateTimeToUtc(fromDate, "00:00", tz),
    endsAt: localDateTimeToUtc(nextDate(toDate), "00:00", tz),
  };
}
