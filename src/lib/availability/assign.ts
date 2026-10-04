// Assegnazione con "qualsiasi barbiere" (SPEC §4, ADR 004).
import { localDateOf } from "@/lib/domain/local-time";
import { computeSlotsByBarber, type AvailabilityInput } from "./slots";

/** FNV-1a a 32 bit: hash stabile, senza dipendenze. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Barbiere da assegnare allo slot `start`, scelto solo tra quelli liberi in quello slot: vince chi
 * ha meno prenotazioni non cancellate nel giorno (`bookingCounts`, mancante = 0). A parità decide
 * un hash di data locale + id, che ruota da un giorno all'altro. null se nessuno è libero.
 */
export function pickBarber(
  input: AvailabilityInput,
  start: Date,
  bookingCounts: Record<string, number>,
): string | null {
  const date = localDateOf(start, input.timezone);
  const slotsByBarber = computeSlotsByBarber(input, date);
  const free = Object.entries(slotsByBarber)
    .filter(([, slots]) => slots.some((s) => s.getTime() === start.getTime()))
    .map(([barberId]) => ({
      barberId,
      count: bookingCounts[barberId] ?? 0,
      tie: fnv1a(`${date}:${barberId}`),
    }));

  free.sort(
    (a, b) =>
      a.count - b.count ||
      a.tie - b.tie ||
      (a.barberId < b.barberId ? -1 : a.barberId > b.barberId ? 1 : 0),
  );
  return free[0]?.barberId ?? null;
}
