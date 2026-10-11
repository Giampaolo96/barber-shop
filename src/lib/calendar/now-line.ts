// Linea dell'ora attuale nella vista giorno del calendario staff (fetta 8b). Logica pura: `now`
// arriva dal chiamante, il giorno è quello locale del negozio (CLAUDE.md regola 2).
import { addDays, localDateOf, localDateTimeToUtc } from "@/lib/domain/local-time";

const MINUTES_PER_DAY = 24 * 60;

/** Istante locale di `day` a `minutes` dalla mezzanotte (24:00 = mezzanotte del giorno dopo). */
function localInstant(day: string, minutes: number, timezone: string): Date {
  if (minutes >= MINUTES_PER_DAY) return localDateTimeToUtc(addDays(day, 1), "00:00", timezone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return localDateTimeToUtc(day, `${hh}:${mm}`, timezone);
}

/**
 * Minuti reali trascorsi dall'inizio della griglia (arrotondati per difetto), o null se `day` non è
 * oggi nella timezone del negozio o se l'ora è fuori da [startMin, endMin], bordi inclusi.
 */
export function nowLineMinutes(
  now: Date,
  day: string,
  timezone: string,
  startMin: number,
  endMin: number,
): number | null {
  if (localDateOf(now, timezone) !== day) return null;
  const start = localInstant(day, startMin, timezone);
  const end = localInstant(day, endMin, timezone);
  if (now < start || now > end) return null;
  return Math.floor((now.getTime() - start.getTime()) / 60_000);
}
