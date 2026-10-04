// Codici d'errore di create_online_booking / cancel_own_booking (e SQLSTATE) → testi per il cliente.
import { it } from "@/i18n/it";

const t = it.booking.errors;

const MESSAGES: Record<string, string> = {
  service_unavailable: t.serviceUnavailable,
  barber_unavailable: t.barberUnavailable,
  not_aligned: t.slotUnavailable,
  outside_hours: t.slotUnavailable,
  time_off: t.slotUnavailable,
  closed: t.slotUnavailable,
  too_soon: t.tooSoon,
  too_far: t.tooFar,
  taken: t.taken,
  // Violazione del vincolo di esclusione: lo slot è stato preso nel frattempo (SPEC §4).
  "23P01": t.taken,
  profile_incomplete: t.profileIncomplete,
  blocked: t.blocked,
  notes_too_long: t.notesTooLong,
  too_many_future: t.tooManyFuture,
  too_many_recent: t.tooManyRecent,
  customer_overlap: t.customerOverlap,
  not_found: t.notFound,
  not_cancellable: t.notCancellable,
  too_late: t.tooLate,
  invalid: t.invalid,
};

export function bookingErrorMessage(code: string): string {
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : t.generic;
}
