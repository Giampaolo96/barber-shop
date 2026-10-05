// Stato di blocco di un cliente nella sezione Clienti (SPEC §6.7): logica pura.
import { isBlockedForBooking } from "@/lib/booking/rules";

export type CustomerBlockStatus = {
  /** Blocco manuale dell'admin (`profiles.is_blocked`). */
  manual: boolean;
  /** Blocco automatico: no-show dall'ultimo azzeramento ≥ soglia (soglia 0 = disattivato). */
  noShow: boolean;
  /** Bloccato per la prenotazione online, con la stessa regola di create_online_booking. */
  blocked: boolean;
};

export function customerBlockStatus(
  profile: { isBlocked: boolean; noShowCount: number },
  threshold: number,
): CustomerBlockStatus {
  return {
    manual: profile.isBlocked,
    noShow: threshold > 0 && profile.noShowCount >= threshold,
    blocked: isBlockedForBooking(profile, threshold),
  };
}
