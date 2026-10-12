// Corsie delle schede di una colonna del calendario quando si sovrappongono: logica pura.
// Il vincolo bookings_no_overlap vale solo per le confirmed, quindi con "mostra cancellate" una
// cancellata può stare nello stesso orario di una confermata (di solito creata dopo al suo posto).
import { type BookingStatus, isCancelledStatus } from "./transitions";

/** Scheda di una colonna; `start` e `end` in qualsiasi unità ordinata (ms, righe della griglia). */
export type LayoutItem = { id: string; start: number; end: number; status: BookingStatus };
/** `lane` = corsia della scheda (da 0, a sinistra); `lanes` = corsie del suo gruppo. */
export type LaneSlot = { lane: number; lanes: number };

/** Intervalli semiaperti: due schede che si toccano soltanto (10:30 e 10:30) non si sovrappongono. */
const overlaps = (a: LayoutItem, b: LayoutItem): boolean => a.start < b.end && b.start < a.end;

/**
 * Corsia di ogni scheda. Le schede che si sovrappongono, anche in modo transitivo (A con B, B con
 * C), formano un gruppo che si divide la larghezza della colonna. Nel gruppo le non cancellate
 * (confermate, ma anche completate o no-show) vengono prima e partono dalla corsia 0; le cancellate
 * occupano le corsie successive, ordinate per inizio. Ognuna prende la prima corsia libera della sua
 * parte. Una scheda senza sovrapposizioni resta a larghezza piena (`lanes` = 1).
 * Il calendario passa le righe occupate della griglia, non i minuti: anche due non cancellate che
 * condividono solo una riga arrotondata (10:00–10:20 e 10:20, con righe da 15 minuti) si affiancano
 * invece di coprirsi.
 */
export function overlapLayout(items: LayoutItem[]): Map<string, LaneSlot> {
  const result = new Map<string, LaneSlot>();
  const byStart = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  // Gruppi transitivi: in ordine di inizio, una scheda entra nel gruppo corrente se inizia prima
  // della fine più tarda vista finora.
  const groups: LayoutItem[][] = [];
  let groupEnd = -Infinity;
  for (const item of byStart) {
    const current = groups.at(-1);
    if (current && item.start < groupEnd) {
      current.push(item);
      groupEnd = Math.max(groupEnd, item.end);
    } else {
      groups.push([item]);
      groupEnd = item.end;
    }
  }

  for (const group of groups) {
    const active = group.filter((item) => !isCancelledStatus(item.status));
    const cancelled = group.filter((item) => isCancelledStatus(item.status));
    const lanes: LayoutItem[][] = [];
    const laneOf = new Map<string, number>();
    const place = (item: LayoutItem, firstLane: number) => {
      let lane = firstLane;
      while (lanes[lane]?.some((other) => overlaps(other, item))) lane += 1;
      (lanes[lane] ??= []).push(item);
      laneOf.set(item.id, lane);
    };
    for (const item of active) place(item, 0);
    const firstCancelledLane = lanes.length;
    for (const item of cancelled) place(item, firstCancelledLane);
    for (const [id, lane] of laneOf) result.set(id, { lane, lanes: lanes.length });
  }
  return result;
}
