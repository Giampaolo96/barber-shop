// Cambi di stato proposti allo staff (SPEC §3.6, ADR 001, decisioni fetta 6): logica pura.
// Il database applica comunque le stesse regole (trigger bookings_before_write).

/** Valori dell'enum Postgres booking_status. */
export const BOOKING_STATUSES = [
  "confirmed",
  "completed",
  "no_show",
  "cancelled_by_customer",
  "cancelled_by_shop",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type StaffRole = "barber" | "admin";

/**
 * Da `confirmed`: completata e no-show solo se l'appuntamento è iniziato (bordo incluso), più le
 * due cancellazioni. Dagli stati finali il barbiere non fa nulla; l'admin può solo ripristinare.
 */
export function allowedTransitions(input: {
  role: StaffRole;
  status: BookingStatus;
  startsAt: Date;
  now: Date;
}): BookingStatus[] {
  if (input.status !== "confirmed") return input.role === "admin" ? ["confirmed"] : [];

  const started = input.startsAt.getTime() <= input.now.getTime();
  return [
    ...(started ? (["completed", "no_show"] as const) : []),
    "cancelled_by_customer",
    "cancelled_by_shop",
  ];
}
