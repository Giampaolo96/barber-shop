// Geometria della fila continua di "Quando?" (SPEC §5.2, fetta 8f, ADR 013): per ogni giorno non
// chiuso le colonne dei barbieri, poi quelle del giorno dopo. Funzioni pure: posizioni in px
// dall'inizio del contenuto della fila; scrollLeft 0 = prima colonna del primo giorno al bordo (dopo
// lo scroll-padding), così il margine sinistro non conta mai come zona visibile.
import type { DayStatus } from "@/lib/availability";

export type RowColumn = { date: string; barberIndex: number; start: number; end: number };

export type RowLayout = {
  columns: RowColumn[];
  /** Fine dell'ultima colonna. */
  width: number;
  /** Inizio della prima colonna di ogni giorno, nell'ordine della fila. */
  dayStarts: Array<{ date: string; start: number; end: number }>;
};

/** Giorni della fila: quelli non chiusi della striscia ("senza posti" compresi), nell'ordine. */
export const rowDays = (days: DayStatus[]): string[] => days.filter((d) => d.status !== "closed").map((d) => d.date);

export function rowLayout({
  days,
  barberCount,
  columnWidth,
  gap,
  dayGap,
}: {
  days: string[];
  barberCount: number;
  columnWidth: number;
  gap: number;
  dayGap: number;
}): RowLayout {
  const columns: RowColumn[] = [];
  const dayStarts: RowLayout["dayStarts"] = [];
  const dayWidth = barberCount * columnWidth + Math.max(0, barberCount - 1) * gap;
  days.forEach((date, dayIndex) => {
    const dayStart = dayIndex * (dayWidth + dayGap);
    dayStarts.push({ date, start: dayStart, end: dayStart + dayWidth });
    for (let barberIndex = 0; barberIndex < barberCount; barberIndex++) {
      const start = dayStart + barberIndex * (columnWidth + gap);
      columns.push({ date, barberIndex, start, end: start + columnWidth });
    }
  });
  return { columns, dayStarts, width: dayStarts.at(-1)?.end ?? 0 };
}

/** scrollLeft che porta la prima colonna del giorno al bordo; 0 per un giorno sconosciuto. */
export const firstColumnOffset = (layout: RowLayout, date: string): number =>
  layout.dayStarts.find((d) => d.date === date)?.start ?? 0;

/** Indice del primo giorno che finisce oltre `x` (ricerca binaria); l'ultimo se nessuno. */
const dayIndexAt = (layout: RowLayout, x: number): number => {
  let low = 0;
  let high = layout.dayStarts.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((layout.dayStarts[mid]?.end ?? 0) > x) high = mid;
    else low = mid + 1;
  }
  return Math.max(0, low);
};

/**
 * Giorno selezionato: quello della colonna più a sinistra visibile anche solo in parte, cioè della
 * prima colonna che finisce oltre scrollLeft. Cambia solo quando è uscita l'ultima colonna del giorno.
 */
export const dayAtScroll = (layout: RowLayout, scrollLeft: number): string =>
  layout.dayStarts[dayIndexAt(layout, scrollLeft)]?.date ?? "";

/** Giorni da disegnare: quelli che toccano la zona visibile allargata di un viewport per lato. */
export function renderWindow(layout: RowLayout, scrollLeft: number, viewportWidth: number): string[] {
  const from = scrollLeft - viewportWidth;
  const to = scrollLeft + 2 * viewportWidth;
  const window: string[] = [];
  for (let i = dayIndexAt(layout, from); i < layout.dayStarts.length; i++) {
    const day = layout.dayStarts[i];
    if (!day || day.start >= to) break;
    if (day.end > from) window.push(day.date);
  }
  return window;
}

/**
 * Giorno della fila ferma: quello di dayAtScroll; ma se la fila è in fondo (`scrollLeft` al massimo) e
 * `chosen` è visibile anche solo in parte, resta `chosen`. Serve agli ultimi giorni, la cui prima
 * colonna non può arrivare al bordo sinistro.
 */
export function settledDay(
  layout: RowLayout,
  view: { scrollLeft: number; maxScrollLeft: number; viewportWidth: number },
  chosen: string | null,
): string {
  const here = dayAtScroll(layout, view.scrollLeft);
  if (!chosen || view.scrollLeft < view.maxScrollLeft - 1) return here;
  const day = layout.dayStarts.find((d) => d.date === chosen);
  const visible = !!day && day.end > view.scrollLeft && day.start < view.scrollLeft + view.viewportWidth;
  return visible ? chosen : here;
}

/**
 * Finestra prima della misura (rendering sul server e idratazione): il giorno iniziale e, contando 4
 * colonne per schermo come a 390 px, uno schermo di giorni a sinistra e due a destra. Dopo la misura
 * vale renderWindow.
 */
export function initialWindow(days: string[], date: string, barberCount: number): string[] {
  const index = Math.max(0, days.indexOf(date));
  const perScreen = Math.ceil(4 / Math.max(1, barberCount));
  return days.slice(Math.max(0, index - perScreen), index + 2 * perScreen + 1);
}

/**
 * Nuovo scrollLeft dopo un cambio di larghezza delle colonne: resta la stessa colonna più a sinistra
 * visibile, alla stessa frazione della sua larghezza (o alla stessa distanza, se il bordo cade nello
 * spazio prima di lei), quindi anche lo stesso giorno selezionato.
 */
export function rescaleScroll(oldLayout: RowLayout, newLayout: RowLayout, scrollLeft: number): number {
  if (scrollLeft <= 0) return 0;
  const index = oldLayout.columns.findIndex((c) => c.end > scrollLeft);
  const before = index < 0 ? oldLayout.columns.at(-1) : oldLayout.columns[index];
  const after = index < 0 ? newLayout.columns.at(-1) : newLayout.columns[index];
  if (!before || !after) return 0;
  if (index < 0) return after.end + (scrollLeft - before.end);
  if (scrollLeft < before.start) return after.start - (before.start - scrollLeft);
  const fraction = (scrollLeft - before.start) / (before.end - before.start);
  return after.start + fraction * (after.end - after.start);
}
