// Percorsi del calendario dello staff. Sotto /admin/calendario: rotte aperte anche al barbiere
// (decideAccess).

export const CALENDAR_PATH = "/admin/calendario";
/** Parametro del dettaglio dopo la creazione di una manuale ("Prenotazione creata"). */
export const CREATED_PARAM = "creata";

export const bookingDetailPath = (id: string): string => `${CALENDAR_PATH}/${id}`;

/** Nuova manuale precompilata (click su uno slot vuoto). */
export function newBookingPath(values: { barberId: string; date: string; time?: string }): string {
  const params = new URLSearchParams({ barbiere: values.barberId, data: values.date });
  if (values.time) params.set("ora", values.time);
  return `${CALENDAR_PATH}/nuova?${params.toString()}`;
}
