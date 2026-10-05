// Modifica di una prenotazione da parte dell'admin (SPEC §3.6, §6.3): logica pura.
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
