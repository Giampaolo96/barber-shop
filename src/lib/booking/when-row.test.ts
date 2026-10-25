import { describe, expect, test } from "vitest";
import { firstColumnOffset, rowLayout, settledDay } from "./when-row";

// Regola della fine fila (review fetta 8f): il giorno scelto resta solo se è ancora visibile.
describe("settledDay", () => {
  const days = ["2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"];
  // 2 barbieri da 82 px, gap 6, spazio fra i giorni 20: giorni larghi 170, passo 190.
  const layout = rowLayout({ days, barberCount: 2, columnWidth: 82, gap: 6, dayGap: 20 });
  const viewportWidth = 358;
  const maxScrollLeft = layout.width - viewportWidth;

  test("a metà fila vale la colonna più a sinistra, qualunque sia il giorno scelto", () => {
    const view = { scrollLeft: firstColumnOffset(layout, days[1] ?? ""), maxScrollLeft, viewportWidth };
    expect(settledDay(layout, view, days[3] ?? "")).toBe(days[1]);
  });

  test("in fondo alla fila resta l'ultimo giorno scelto se è visibile", () => {
    const view = { scrollLeft: maxScrollLeft, maxScrollLeft, viewportWidth };
    expect(settledDay(layout, view, days[3] ?? "")).toBe(days[3]);
  });

  test("in fondo alla fila un giorno scelto già uscito a sinistra non torna selezionato", () => {
    const view = { scrollLeft: maxScrollLeft, maxScrollLeft, viewportWidth };
    expect(settledDay(layout, view, days[0] ?? "")).toBe(days[2]);
    expect(settledDay(layout, view, null)).toBe(days[2]);
  });
});
