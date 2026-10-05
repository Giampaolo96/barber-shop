// Parametri della vista del calendario (SPEC §6.1): logica pura.
import { z } from "zod";
import { isValidLocalDate } from "@/lib/domain/local-time";

export type CalendarView = "giorno" | "settimana";

export type CalendarQuery = {
  date: string;
  view: CalendarView;
  barberId: string | null;
  showCancelled: boolean;
};

const uuid = z.uuid();
const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** `?data=YYYY-MM-DD&vista=giorno|settimana&barbiere=<uuid>&cancellate=1`; valori non validi ignorati. */
export function parseCalendarQuery(
  params: Record<string, string | string[] | undefined>,
  today: string,
): CalendarQuery {
  const date = first(params.data);
  const barber = first(params.barbiere);
  return {
    date: date && isValidLocalDate(date) ? date : today,
    view: first(params.vista) === "settimana" ? "settimana" : "giorno",
    barberId: barber && uuid.safeParse(barber).success ? barber : null,
    showCancelled: first(params.cancellate) === "1",
  };
}

/** Link al calendario con i parametri dati (quelli predefiniti si omettono). */
export function calendarHref(query: Partial<CalendarQuery> & { date: string }): string {
  const params = new URLSearchParams({ data: query.date });
  if (query.view === "settimana") params.set("vista", "settimana");
  if (query.barberId) params.set("barbiere", query.barberId);
  if (query.showCancelled) params.set("cancellate", "1");
  return `/admin?${params.toString()}`;
}

/**
 * Barbiere della vista settimanale dell'admin senza `?barbiere=`: la propria scheda se è anche
 * barbiere (e la scheda è attiva), altrimenti il primo barbiere attivo per nome.
 */
export function defaultWeekBarber(input: {
  ownBarberId: string | null;
  barbers: Array<{ id: string; displayName: string; isActive: boolean }>;
}): string | null {
  const active = input.barbers.filter((barber) => barber.isActive);
  if (input.ownBarberId && active.some((barber) => barber.id === input.ownBarberId)) {
    return input.ownBarberId;
  }
  const [firstByName] = [...active].sort((a, b) => a.displayName.localeCompare(b.displayName, "it"));
  return firstByName?.id ?? null;
}

/**
 * Barbiere preselezionato nella nuova prenotazione. Se quello richiesto (`?barbiere=`) non è
 * prenotabile (disattivato o non visibile) lo si segnala, invece di cambiarlo in silenzio.
 */
export function newBookingBarber(input: {
  requestedId: string | null;
  barbers: Array<{ id: string; isActive: boolean }>;
}): { barberId: string | null; requestedUnavailable: boolean } {
  const active = input.barbers.filter((barber) => barber.isActive);
  const requested = active.find((barber) => barber.id === input.requestedId);
  return {
    barberId: requested?.id ?? active[0]?.id ?? null,
    requestedUnavailable: input.requestedId !== null && !requested,
  };
}
