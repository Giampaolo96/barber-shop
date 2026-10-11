import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek } from "./dates";

// Scorciatoie del periodo delle statistiche; `today` è il giorno locale del negozio.

export const STATS_SHORTCUTS = ["thisWeek", "thisMonth", "last3Months", "thisYear"] as const;
export type StatsShortcut = (typeof STATS_SHORTCUTS)[number];

export type StatsPeriod = { from: string; to: string };

export function periodShortcut(key: StatsShortcut, today: string): StatsPeriod {
  switch (key) {
    case "thisWeek": {
      const from = startOfWeek(today);
      return { from, to: addDays(from, 6) };
    }
    case "thisMonth":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last3Months":
      // Tre mesi di calendario, compreso quello in corso.
      return { from: addMonths(today, -2), to: endOfMonth(today) };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}
