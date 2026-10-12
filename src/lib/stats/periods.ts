import type { Granularity } from "./aggregate";
import { addDays, addMonths, daysInclusive, endOfMonth, startOfMonth, startOfWeek } from "./dates";

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

/** Fino a questi giorni il raggruppamento predefinito è per giorno, poi per settimana, oltre per mese. */
export const DEFAULT_GRANULARITY_MAX_DAYS = { giorno: 62, settimana: 120 } as const;

/**
 * Raggruppamento quando l'admin non ne ha scelto uno, in base all'ampiezza del periodo: settimana
 * e mese per giorno, ultimi 3 mesi per settimana, anno per mese.
 */
export function defaultGranularity({ from, to }: StatsPeriod): Granularity {
  const days = daysInclusive(from, to);
  if (days <= DEFAULT_GRANULARITY_MAX_DAYS.giorno) return "giorno";
  if (days <= DEFAULT_GRANULARITY_MAX_DAYS.settimana) return "settimana";
  return "mese";
}
