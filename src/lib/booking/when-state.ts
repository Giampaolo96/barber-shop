// Stato della pagina "Quando?" durante il cambio di giorno (SPEC §5.2, fetta 8e): funzione pura,
// così il caso delle risposte arrivate in ritardo è testabile senza browser.
import type { WhenDay } from "./availability";

export type WhenView = {
  /** Ultimo giorno toccato nella striscia. */
  selected: string;
  /** Giorno di cui si vedono gli orari: durante il caricamento resta il precedente. */
  shown: WhenDay;
  /** Il caricamento del giorno selezionato non è riuscito. */
  error: boolean;
};

export type WhenAction =
  /** Scelta di un giorno; `cached` se è già in memoria. */
  | { type: "select"; date: string; cached?: WhenDay }
  /** Risposta del server per `date` (null = errore). */
  | { type: "loaded"; date: string; day: WhenDay | null };

export function whenReducer(state: WhenView, action: WhenAction): WhenView {
  switch (action.type) {
    case "select":
      return { selected: action.date, shown: action.cached ?? state.shown, error: false };
    case "loaded":
      // Una risposta per un giorno che non è più quello selezionato si ignora.
      if (action.date !== state.selected) return state;
      return action.day ? { ...state, shown: action.day, error: false } : { ...state, error: true };
  }
}

/** Scheletri visibili: il giorno selezionato non è ancora arrivato (e non è fallito). */
export const isWhenLoading = (state: WhenView): boolean => !state.error && state.selected !== state.shown.date;
