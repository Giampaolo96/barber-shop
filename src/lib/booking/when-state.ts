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
  /** Nuovo tentativo di un giorno in errore: la voce sparisce e la coda lo richiede (nextRequests). */
  | { type: "retry"; date: string };

export function dayCacheReducer(state: DayCache, action: DayCacheAction): DayCache {
  const entry = state[action.date];
  switch (action.type) {
    case "retry": {
      if (entry?.status !== "error") return state;
      const rest = { ...state };
      delete rest[action.date];
      return rest;
    }
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
