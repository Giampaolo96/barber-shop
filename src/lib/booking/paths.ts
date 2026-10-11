// Rotte del flusso di prenotazione (SPEC §5.2, max 4 schermate) e di "Le mie prenotazioni".
// Lo stato del flusso passa nei parametri dell'URL.

export const BOOK_PATH = "/prenota";
export const BOOK_BARBER_PATH = "/prenota/barbiere";
export const BOOK_TIME_PATH = "/prenota/orario";
export const BOOK_SUMMARY_PATH = "/prenota/riepilogo";
export const MY_BOOKINGS_PATH = "/prenotazioni";

/** Valore di `barbiere` per "Nessuna preferenza". */
export const ANY_BARBER = "any";

const withParams = (path: string, params: Record<string, string>): string =>
  `${path}?${new URLSearchParams(params).toString()}`;

export const barberStepUrl = (serviceId: string): string =>
  withParams(BOOK_BARBER_PATH, { servizio: serviceId });

export const timeStepUrl = (serviceId: string, barberId: string): string =>
  withParams(BOOK_TIME_PATH, { servizio: serviceId, barbiere: barberId });

export const summaryStepUrl = (serviceId: string, barberId: string, startsAt: string): string =>
  withParams(BOOK_SUMMARY_PATH, { servizio: serviceId, barbiere: barberId, inizio: startsAt });

/** Schermata dedicata dopo la conferma (fetta 8b). */
export const confirmationPath = (bookingId: string): string => `${MY_BOOKINGS_PATH}/${bookingId}/confermata`;

/** File iCalendar della prenotazione, "Aggiungi al calendario" (fetta 8b). */
export const calendarFilePath = (bookingId: string): string => `${MY_BOOKINGS_PATH}/${bookingId}/calendario.ics`;
