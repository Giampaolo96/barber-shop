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

/**
 * "Primo libero" di "Quando?" (SPEC §5.2, fetta 8e): il primo orario del giorno locale `date` fra
 * tutti i barbieri. Se a quell'ora sono liberi più barbieri vince il primo di `preferredBarberIds`
 * libero (barbiere dall'URL, poi quello dell'ultimo appuntamento); altrimenti pickBarber, con i
 * conteggi delle prenotazioni confirmed (intervalli busy) che iniziano quel giorno. null se il
 * giorno non ha orari.
 */
export function firstFree(
  input: AvailabilityInput,
  date: string,
  preferredBarberIds: string[],
): { barberId: string; startsAt: Date } | null {
  const slotsByBarber = computeSlotsByBarber(input, date);
  const starts = Object.values(slotsByBarber).flatMap((slots) => (slots[0] ? [slots[0].getTime()] : []));
  if (starts.length === 0) return null;
  const startsAt = new Date(Math.min(...starts));

  const freeAt = (barberId: string) => slotsByBarber[barberId]?.[0]?.getTime() === startsAt.getTime();
  const preferred = preferredBarberIds.find(freeAt);
  if (preferred) return { barberId: preferred, startsAt };

  const counts: Record<string, number> = {};
  for (const barber of input.barbers) {
    counts[barber.barberId] = barber.busy.filter((b) => localDateOf(b.start, input.timezone) === date).length;
  }
  const barberId = pickBarber(input, startsAt, counts);
  return barberId ? { barberId, startsAt } : null;
}
