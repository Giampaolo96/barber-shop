import type { StatsParams } from "./schemas";

// Percorsi delle statistiche (solo admin). I parametri predefiniti restano fuori dall'URL.

export const STATS_PATH = "/admin/statistiche";
export const STATS_TO_UPDATE_PATH = `${STATS_PATH}/da-aggiornare`;

function query(params: StatsParams, withView: boolean): string {
  const search = new URLSearchParams({ dal: params.from, al: params.to });
  if (withView && params.granularity !== "giorno") search.set("raggruppa", params.granularity);
  if (params.barberId) search.set("barbiere", params.barberId);
  if (params.excludeDemo) search.set("escludi_demo", "1");
  if (withView && params.chart !== "prenotazioni") search.set("grafico", params.chart);
  return search.toString();
}

export const statsPath = (params: StatsParams): string => `${STATS_PATH}?${query(params, true)}`;

/** Elenco "Da aggiornare" con gli stessi filtri; raggruppamento e grafico non servono. */
export const statsToUpdatePath = (params: StatsParams): string => `${STATS_TO_UPDATE_PATH}?${query(params, false)}`;
