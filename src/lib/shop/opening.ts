// Stato di apertura del negozio per la home (fetta 8a): logica pura, `now` in input.
// Le fasce di oggi (giorno locale nella timezone del negozio, weekday ISO come working_hours)
// diventano istanti reali, meno le chiusure; intervalli [inizio, fine).
import { isoWeekday } from "@/lib/calendar/grid";
import { addDays, localDateOf, localDateTimeToUtc } from "@/lib/domain/local-time";

export type OpeningHours = { weekday: number; start: string; end: string };
export type ShopClosure = { startsAt: Date; endsAt: Date };
export type OpeningStatus =
  | { state: "open"; until: Date }
  | { state: "opens_later"; at: Date }
  | { state: "closed_today" };

type Interval = { start: number; end: number };

/** Ora locale del giorno `date` come istante; "24:00" è la mezzanotte del giorno dopo. */
function localInstant(date: string, time: string, timezone: string): number {
  if (time === "24:00") return localDateTimeToUtc(addDays(date, 1), "00:00", timezone).getTime();
  return localDateTimeToUtc(date, time, timezone).getTime();
}

/** Unisce gli intervalli sovrapposti o contigui (es. 09–13 e 13–15). */
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Toglie da un intervallo le parti coperte dalle chiusure. */
function subtract(interval: Interval, closures: Interval[]): Interval[] {
  let pieces = [interval];
  for (const closure of closures) {
    pieces = pieces.flatMap((piece) => {
      if (closure.end <= piece.start || closure.start >= piece.end) return [piece];
      const left = { start: piece.start, end: closure.start };
      const right = { start: closure.end, end: piece.end };
      return [left, right].filter((part) => part.start < part.end);
    });
  }
  return pieces;
}

export function openingStatus(input: {
  now: Date;
  timezone: string;
  hours: OpeningHours[];
  closures: ShopClosure[];
}): OpeningStatus {
  const { now, timezone } = input;
  const today = localDateOf(now, timezone);
  const weekday = isoWeekday(today);
  const closures = input.closures.map((c) => ({ start: c.startsAt.getTime(), end: c.endsAt.getTime() }));

  const open = merge(
    input.hours
      .filter((band) => band.weekday === weekday)
      .map((band) => ({
        start: localInstant(today, band.start, timezone),
        end: localInstant(today, band.end, timezone),
      }))
      .filter((band) => band.start < band.end),
  ).flatMap((band) => subtract(band, closures));

  const t = now.getTime();
  const current = open.find((band) => band.start <= t && t < band.end);
  if (current) return { state: "open", until: new Date(current.end) };
  const next = open.find((band) => band.start > t);
  if (next) return { state: "opens_later", at: new Date(next.start) };
  return { state: "closed_today" };
}
