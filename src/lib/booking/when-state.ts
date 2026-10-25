// Giorni caricati della fila di "Quando?" (SPEC §5.2, fetta 8f): una voce per giorno, funzione pura,
// così le risposte arrivate in ritardo sono testabili senza browser. Ogni richiesta ha un id: una
// risposta vecchia dello stesso giorno (per esempio dopo un nuovo tentativo) non sovrascrive la più recente.
import type { WhenDay } from "./availability";

export type DayEntry =
  | { status: "loading"; requestId: number }
  | { status: "loaded"; day: WhenDay }
  | { status: "error"; requestId: number };

/** Chiave: giorno `YYYY-MM-DD`. Un giorno assente non è mai stato chiesto. */
export type DayCache = Record<string, DayEntry>;

export type DayCacheAction =
  /** Parte una richiesta per `date`. */
  | { type: "request"; date: string; requestId: number }
  /** Risposta della richiesta `requestId`. */
  | { type: "loaded"; date: string; requestId: number; day: WhenDay }
  /** Errore della richiesta `requestId`. */
  | { type: "failed"; date: string; requestId: number }
  /**
   * Più giorni insieme (ricarica in background, fetta 8g): ognuno diventa caricato, tranne se ha una
   * richiesta singola più recente in corso. I giorni assenti dalla risposta restano come sono.
   */
  | { type: "loadedMany"; requestId: number; days: WhenDay[] };

export function dayCacheReducer(state: DayCache, action: DayCacheAction): DayCache {
  if (action.type === "loadedMany") {
    if (action.days.length === 0) return state;
    const next = { ...state };
    for (const day of action.days) {
      const entry = state[day.date];
      if (entry?.status === "loading" && entry.requestId > action.requestId) continue;
      next[day.date] = { status: "loaded", day };
    }
    return next;
  }
  const entry = state[action.date];
  switch (action.type) {
    case "request":
      return { ...state, [action.date]: { status: "loading", requestId: action.requestId } };
    case "loaded":
    case "failed":
      // Vale solo la risposta della richiesta in corso per quel giorno.
      if (entry?.status !== "loading" || entry.requestId !== action.requestId) return state;
      return {
        ...state,
        [action.date]:
          action.type === "loaded"
            ? { status: "loaded", day: action.day }
            : { status: "error", requestId: action.requestId },
      };
  }
}
