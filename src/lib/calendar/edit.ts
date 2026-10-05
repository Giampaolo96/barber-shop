// Modifica di una prenotazione da parte dell'admin (SPEC §3.6, §6.3): logica pura.
import { utcToLocalParts } from "@/lib/domain/local-time";
import type { BookingStatus } from "./transitions";

/**
 * Colonne da scrivere. Cambiando servizio durata e prezzo li ricopia il database dal nuovo
 * servizio (CLAUDE.md regola 4): quelli del modulo valgono solo se il servizio resta lo stesso.
 */
export function bookingUpdateValues(
  existing: { serviceId: string },
  input: { barberId: string; serviceId: string; startsAt: Date; durationMin: number; priceCents: number },
): { barber_id: string; service_id: string; starts_at: string; duration_min?: number; price_cents?: number } {
  const values = {
    barber_id: input.barberId,
    service_id: input.serviceId,
    starts_at: input.startsAt.toISOString(),
  };
  return input.serviceId === existing.serviceId
    ? { ...values, duration_min: input.durationMin, price_cents: input.priceCents }
    : values;
}

/** Avvisi solo per una prenotazione confermata di cui cambiano orario, barbiere o fine. */
export function editNeedsWarnings(
  existing: { status: BookingStatus; barberId: string; startsAt: Date; endsAt: Date },
  next: { barberId: string; startsAt: Date; endsAt: Date },
): boolean {
  if (existing.status !== "confirmed") return false;
  return (
    existing.barberId !== next.barberId ||
    existing.startsAt.getTime() !== next.startsAt.getTime() ||
    existing.endsAt.getTime() !== next.endsAt.getTime()
  );
}

/**
 * Inizio della prenotazione modificata quando data e ora del modulo sono quelle salvate: si riusa
 * l'istante esistente. Così una modifica del solo prezzo non sposta un orario della seconda
 * occorrenza delle 02:xx (cambio d'ora) e non richiede il passo di 5 minuti. `null` se cambiano.
 */
export function unchangedStart(existingStartsAt: Date, date: string, time: string, tz: string): Date | null {
  const current = utcToLocalParts(existingStartsAt, tz);
  return current.date === date && current.time === time ? existingStartsAt : null;
}

/**
 * Scelta non prenotabile (SPEC §3.2): un servizio o un barbiere disattivato, se è una scelta nuova.
 * In creazione entrambi sono nuovi; in modifica restano ammessi quelli già sulla prenotazione.
 */
export function usesInactiveChoice(input: {
  service: { changed: boolean; active: boolean };
  barber: { changed: boolean; active: boolean };
}): boolean {
  return (
    (input.service.changed && !input.service.active) || (input.barber.changed && !input.barber.active)
  );
}
