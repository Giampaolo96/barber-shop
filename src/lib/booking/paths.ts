// Rotte del flusso di prenotazione (SPEC §5.2: servizio → "Quando?" → riepilogo, fetta 8e) e di
// "Le mie prenotazioni". Lo stato del flusso passa nei parametri dell'URL.
import { z } from "zod";
import { isValidLocalDate } from "@/lib/domain/local-time";

export const BOOK_PATH = "/prenota";
export const BOOK_WHEN_PATH = "/prenota/quando";
export const BOOK_SUMMARY_PATH = "/prenota/riepilogo";
export const MY_BOOKINGS_PATH = "/prenotazioni";

/** Valore di `barbiere` per "qualsiasi barbiere": accettato ancora dal riepilogo (vecchi link). */
export const ANY_BARBER = "any";

const withParams = (path: string, params: Record<string, string>): string =>
  `${path}?${new URLSearchParams(params).toString()}`;

/** "Quando?" per il servizio; `day` = giorno locale selezionato, `barberId` = barbiere preferito. */
export const whenStepUrl = (serviceId: string, opts: { day?: string; barberId?: string } = {}): string =>
  withParams(BOOK_WHEN_PATH, {
    servizio: serviceId,
    ...(opts.day ? { giorno: opts.day } : {}),
    ...(opts.barberId ? { barbiere: opts.barberId } : {}),
  });

/**
 * Destinazione dei vecchi /prenota/barbiere e /prenota/orario: "Quando?" con servizio, barbiere
 * (solo un id, non "qualsiasi") e giorno validi; senza servizio valido il listino.
 */
export function legacyWhenUrl(params: Record<string, string | undefined>): string {
  const service = z.uuid().safeParse(params.servizio);
  if (!service.success) return BOOK_PATH;
  const barber = z.uuid().safeParse(params.barbiere);
  const day = params.giorno && isValidLocalDate(params.giorno) ? params.giorno : undefined;
  return whenStepUrl(service.data, { day, barberId: barber.success ? barber.data : undefined });
}

/**
 * Riepilogo dell'orario scelto. `preferredId`: barbiere preferito arrivato su "Quando?" dall'URL,
 * conservato (`preferito`) perché "Indietro" e "Cambia orario" lo ritrovino.
 */
export const summaryStepUrl = (
  serviceId: string,
  barberId: string,
  startsAt: string,
  preferredId?: string,
): string =>
  withParams(BOOK_SUMMARY_PATH, {
    servizio: serviceId,
    barbiere: barberId,
    inizio: startsAt,
    ...(preferredId ? { preferito: preferredId } : {}),
  });

/** Schermata dedicata dopo la conferma (fetta 8b). */
export const confirmationPath = (bookingId: string): string => `${MY_BOOKINGS_PATH}/${bookingId}/confermata`;

/** File iCalendar della prenotazione, "Aggiungi al calendario" (fetta 8b). */
export const calendarFilePath = (bookingId: string): string => `${MY_BOOKINGS_PATH}/${bookingId}/calendario.ics`;
