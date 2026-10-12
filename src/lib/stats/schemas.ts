// Parametri della pagina /admin/statistiche (SPEC §6.9, decisioni fetta 9a). Lo schema non
// fallisce mai: un valore non valido torna al predefinito.
import { z } from "zod";
import type { Granularity } from "./aggregate";
import { daysInclusive, isValidLocalDate } from "./dates";
import { defaultGranularity, periodShortcut } from "./periods";

export const STATS_MAX_DAYS = 366;

export const STATS_GRANULARITIES = ["giorno", "settimana", "mese"] as const satisfies readonly Granularity[];
export const STATS_CHARTS = ["prenotazioni", "incasso"] as const;
export type StatsChart = (typeof STATS_CHARTS)[number];

export type StatsParams = {
  from: string;
  to: string;
  granularity: Granularity;
  barberId: string | null;
  excludeDemo: boolean;
  chart: StatsChart;
};

const optionalText = z.string().optional().catch(undefined);

/** Raggruppamento scelto dall'admin (nell'URL), o null se manca o non è valido. */
export function chosenGranularity(value: string | undefined): Granularity | null {
  return STATS_GRANULARITIES.find((candidate) => candidate === value) ?? null;
}
const pick = <T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T =>
  allowed.find((candidate) => candidate === value) ?? fallback;

/**
 * `today` è il giorno locale del negozio: il periodo predefinito è il suo mese di calendario. Senza
 * un raggruppamento scelto vale quello predefinito del periodo (defaultGranularity).
 */
export function statsSearchParamsSchema(today: string) {
  return z
    .object({
      dal: optionalText,
      al: optionalText,
      raggruppa: optionalText,
      barbiere: optionalText,
      escludi_demo: optionalText,
      grafico: optionalText,
    })
    .catch({})
    .transform(({ dal, al, raggruppa, barbiere, escludi_demo, grafico }): StatsParams => {
      const validPeriod =
        dal !== undefined &&
        al !== undefined &&
        isValidLocalDate(dal) &&
        isValidLocalDate(al) &&
        dal <= al &&
        daysInclusive(dal, al) <= STATS_MAX_DAYS;
      const period = validPeriod ? { from: dal, to: al } : periodShortcut("thisMonth", today);
      return {
        ...period,
        granularity: chosenGranularity(raggruppa) ?? defaultGranularity(period),
        barberId: barbiere !== undefined && z.uuid().safeParse(barbiere).success ? barbiere : null,
        excludeDemo: escludi_demo === "1" || escludi_demo === "on",
        chart: pick(STATS_CHARTS, grafico, "prenotazioni"),
      };
    });
}
