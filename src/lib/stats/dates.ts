// Giorni di calendario "YYYY-MM-DD" per settimane e mesi delle statistiche, senza orari né
// timezone: i giorni arrivano già locali al negozio (admin_booking_stats).
import { addDays } from "@/lib/domain/local-time";

export { addDays, isValidLocalDate } from "@/lib/domain/local-time";

const DAY_MS = 86_400_000;
const toUtcMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Giorni da `from` a `to`, estremi inclusi (1 se coincidono). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS) + 1;
}

/** Lunedì della settimana del giorno dato. */
export function startOfWeek(day: string): string {
  const weekday = new Date(toUtcMs(day)).getUTCDay(); // 0 = domenica
  return addDays(day, -((weekday + 6) % 7));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

/** Primo giorno del mese spostato di `months` mesi. */
export function addMonths(day: string, months: number): string {
  const [year, month] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

export function endOfMonth(day: string): string {
  return addDays(addMonths(day, 1), -1);
}

export const minDay = (a: string, b: string): string => (a < b ? a : b);
export const maxDay = (a: string, b: string): string => (a > b ? a : b);
