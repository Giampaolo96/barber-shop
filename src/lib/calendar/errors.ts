// Errori del database sulle scritture dello staff → codici mostrati nel calendario. Logica pura.
export type CalendarErrorCode = "barber_busy" | "customer_busy" | "not_enabled" | "forbidden" | "error";

type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null };

/** Vincoli di esclusione di bookings (SPEC §3.7.1 e §3.7.6), riconosciuti dal nome. */
const EXCLUSIONS: Record<string, CalendarErrorCode> = {
  bookings_no_overlap: "barber_busy",
  bookings_customer_no_overlap: "customer_busy",
};

export function calendarErrorCode(error: DbError): CalendarErrorCode {
  const message = error.message ?? "";
  if (error.code === "23P01") {
    const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
    return (constraint && EXCLUSIONS[constraint]) || "error";
  }
  if (error.code === "23514" && message.includes("barber is not enabled for this service")) {
    return "not_enabled";
  }
  if (error.code === "42501") return "forbidden";
  return "error";
}
