// Logica pura della pagina "Quando?" (SPEC §5.2, fetta 8e): ordine dei barbieri, Mattina/Pomeriggio,
// giorno iniziale e formati. Nessun I/O, `now` in input (CLAUDE.md regola 5).
import { it as itLocale } from "date-fns/locale/it";
import { formatInTimeZone } from "date-fns-tz";
import type { DayStatus } from "@/lib/availability";

/** Stati che non valgono come appuntamento avuto. */
const CANCELLED = new Set(["cancelled_by_customer", "cancelled_by_shop"]);

/** Primo orario del pomeriggio, in minuti locali dalla mezzanotte (13:00). */
const AFTERNOON_FROM_MIN = 13 * 60;

/**
 * Barbieri nell'ordine delle sezioni: il preferito arrivato dall'URL, poi quello dell'ultimo
 * appuntamento, poi gli altri per nome (ordinamento italiano, stabile). Id sconosciuti ignorati.
 */
export function orderBarbers<T extends { id: string; name: string }>(
  barbers: T[],
  opts: { preferredId?: string | null; recentId?: string | null },
): T[] {
  const byName = [...barbers].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const first = [opts.preferredId, opts.recentId].filter((id): id is string => !!id);
  const head = [...new Set(first)].flatMap((id) => byName.filter((b) => b.id === id).slice(0, 1));
  return [...head, ...byName.filter((b) => !head.includes(b))];
}

/** Barbiere dell'ultimo appuntamento già iniziato (starts_at < now), escluse le cancellate. */
export function recentBarberId(
  bookings: Array<{ barberId: string | null; startsAt: string; status: string }>,
  now: Date,
): string | null {
  let best: { barberId: string; at: number } | null = null;
  for (const booking of bookings) {
    const at = new Date(booking.startsAt).getTime();
    if (!booking.barberId || CANCELLED.has(booking.status) || at >= now.getTime()) continue;
    if (!best || at > best.at) best = { barberId: booking.barberId, at };
  }
  return best?.barberId ?? null;
}

/** Orari divisi in Mattina (prima delle 13:00 locali) e Pomeriggio, nell'ordine dato. */
export function splitByPeriod(slots: string[], timezone: string): { morning: string[]; afternoon: string[] } {
  const morning: string[] = [];
  const afternoon: string[] = [];
  for (const iso of slots) {
    const [hours, minutes] = formatInTimeZone(new Date(iso), timezone, "H:m").split(":").map(Number);
    (hours * 60 + minutes < AFTERNOON_FROM_MIN ? morning : afternoon).push(iso);
  }
  return { morning, afternoon };
}

/**
 * Giorno da mostrare all'apertura: quello richiesto se è nella striscia e non chiuso, altrimenti il
 * primo con almeno un orario libero; null se nel periodo non c'è nessun orario (stato vuoto).
 */
export function initialDay(days: DayStatus[], requested?: string | null): string | null {
  // Nessun orario in tutto il periodo: stato vuoto anche se è richiesto un giorno "senza posti".
  if (!days.some((d) => d.status === "open")) return null;
  const wanted = requested ? days.find((d) => d.date === requested && d.status !== "closed") : undefined;
  return wanted?.date ?? days.find((d) => d.status === "open")?.date ?? null;
}

/** Ora di un orario nella pagina "Quando?": "9:30". */
export const formatSlotTime = (iso: string, timezone: string): string =>
  formatInTimeZone(new Date(iso), timezone, "H:mm");

/** Giorno del prossimo orario libero di un barbiere: "mar 20". */
export const formatNextFreeDay = (iso: string, timezone: string): string =>
  formatInTimeZone(new Date(iso), timezone, "EEE d", { locale: itLocale });

/** Prossimo orario libero di un barbiere: "mar 20, 9:30" (giorno e ora, come le due funzioni sopra). */
export const formatNextFree = (iso: string, timezone: string): string =>
  `${formatNextFreeDay(iso, timezone)}, ${formatSlotTime(iso, timezone)}`;

/**
 * "Primo libero" da mostrare fra i barbieri della pagina (`barberIds`): quello scelto dal server se
 * è fra questi, altrimenti il primo orario fra i loro, a parità il primo nell'ordine dato. Copre il
 * caso raro in cui l'elenco dei barbieri e i dati di disponibilità non coincidono.
 */
export function firstFreeAmong(
  day: {
    firstFree: { barberId: string; startsAt: string } | null;
    barbers: Array<{ barberId: string; slots: string[] }>;
  },
  barberIds: string[],
): { barberId: string; startsAt: string } | null {
  if (day.firstFree && barberIds.includes(day.firstFree.barberId)) return day.firstFree;
  let best: { barberId: string; startsAt: string; at: number } | null = null;
  for (const barberId of barberIds) {
    const first = day.barbers.find((b) => b.barberId === barberId)?.slots[0];
    if (!first) continue;
    const at = new Date(first).getTime();
    if (!best || at < best.at) best = { barberId, startsAt: first, at };
  }
  return best ? { barberId: best.barberId, startsAt: best.startsAt } : null;
}
