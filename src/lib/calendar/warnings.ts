// Avvisi per prenotazioni manuali e spostamenti dello staff (SPEC §3.7.5): le manuali possono
// derogare a fasce, assenze e chiusure, ma solo dopo una conferma esplicita. Logica pura.
// La conferma non riguarda mai le sovrapposizioni: quelle le rifiuta il database (§3.7.1, §3.7.6).
import type { Interval } from "./grid";

export const WARNING_CODES = ["outside_hours", "time_off", "closure", "past"] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

const overlaps = (a: Interval, b: Interval): boolean =>
  a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();

/** Fasce ordinate, con quelle contigue o sovrapposte unite. */
const mergeBands = (bands: Interval[]): Interval[] => {
  const merged: Interval[] = [];
  for (const band of [...bands].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const last = merged.at(-1);
    if (last && band.startsAt.getTime() <= last.endsAt.getTime()) {
      if (band.endsAt.getTime() > last.endsAt.getTime()) last.endsAt = band.endsAt;
    } else {
      merged.push({ ...band });
    }
  }
  return merged;
};

/** Avvisi per l'intervallo `[startsAt, endsAt)` del barbiere, nell'ordine di WARNING_CODES. */
export function manualBookingWarnings(input: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  bands: Interval[];
  timeOff: Interval[];
  closures: Interval[];
}): WarningCode[] {
  const slot = { startsAt: input.startsAt, endsAt: input.endsAt };
  const insideBand = mergeBands(input.bands).some(
    (band) =>
      band.startsAt.getTime() <= slot.startsAt.getTime() &&
      slot.endsAt.getTime() <= band.endsAt.getTime(),
  );

  const found = new Set<WarningCode>();
  if (!insideBand) found.add("outside_hours");
  if (input.timeOff.some((period) => overlaps(period, slot))) found.add("time_off");
  if (input.closures.some((period) => overlaps(period, slot))) found.add("closure");
  if (slot.startsAt.getTime() < input.now.getTime()) found.add("past");
  return WARNING_CODES.filter((code) => found.has(code));
}

/**
 * Esito di un invio (decisione dell'utente, fetta 6): gli avvisi si ricalcolano sempre; si salva
 * se non ne compare nessuno che non sia già stato confermato. Altrimenti si mostrano gli attuali.
 */
export function decideWarnings(
  current: WarningCode[],
  confirmed: WarningCode[],
): { save: true } | { save: false; warnings: WarningCode[] } {
  const accepted = new Set(confirmed);
  return current.every((code) => accepted.has(code)) ? { save: true } : { save: false, warnings: current };
}
