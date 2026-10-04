// Regole della prenotazione online lato cliente (SPEC §3.1, §5.3, §12): logica pura, senza I/O.
// Il database le applica comunque da solo (create_online_booking, cancel_own_booking): qui servono
// a mostrare all'utente cosa può fare.

const MINUTE = 60_000;

/** Cancellazione consentita fino a `cancelLimitMin` minuti prima dell'inizio, bordo incluso. */
export function canCancel(startsAt: Date, now: Date, cancelLimitMin: number): boolean {
  return now.getTime() <= startsAt.getTime() - cancelLimitMin * MINUTE;
}

const time = (value: Date | string): number => new Date(value).getTime();

/**
 * "Le mie prenotazioni": future = confirmed con inizio ≥ now, dalla più vicina; passate = tutto il
 * resto (anche le cancellate future), dalla più recente.
 */
export function splitBookings<T extends { startsAt: Date | string; status: string }>(
  bookings: T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const booking of bookings) {
    if (booking.status === "confirmed" && time(booking.startsAt) >= now.getTime()) {
      upcoming.push(booking);
    } else {
      past.push(booking);
    }
  }
  upcoming.sort((a, b) => time(a.startsAt) - time(b.startsAt));
  past.sort((a, b) => time(b.startsAt) - time(a.startsAt));
  return { upcoming, past };
}

/** Blocco della prenotazione online: manuale dell'admin o per no-show (soglia 0 = disattivato). */
export function isBlockedForBooking(
  profile: { isBlocked: boolean; noShowCount: number },
  threshold: number,
): boolean {
  return profile.isBlocked || (threshold > 0 && profile.noShowCount >= threshold);
}
