// Corsie delle schede sovrapposte nella vista giorno del calendario (fix "mostra cancellate"):
// una cancellata nello stesso orario di una confermata non deve restare coperta.
//
// Interfaccia (modulo puro, senza I/O):
//   src/lib/calendar/overlap-layout.ts
//     overlapLayout(items: { id; start: number; end: number; status: BookingStatus }[]): Map<id, { lane; lanes }>
import { describe, expect, it } from "vitest";
import { type LayoutItem, overlapLayout } from "@/lib/calendar/overlap-layout";

/** Ora "HH:MM" in minuti dalla mezzanotte: l'unità non conta, solo l'ordine. */
const at = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const item = (id: string, from: string, to: string, status: LayoutItem["status"] = "confirmed"): LayoutItem => ({
  id,
  start: at(from),
  end: at(to),
  status,
});
const layout = (items: LayoutItem[]) => Object.fromEntries(overlapLayout(items));

describe("overlapLayout", () => {
  it("senza sovrapposizioni ogni scheda resta a larghezza piena", () => {
    expect(
      layout([item("a", "09:00", "09:30"), item("b", "10:00", "10:30", "cancelled_by_shop"), item("c", "11:00", "11:20")]),
    ).toEqual({
      a: { lane: 0, lanes: 1 },
      b: { lane: 0, lanes: 1 },
      c: { lane: 0, lanes: 1 },
    });
  });

  it("confermata e cancellata identiche: la confermata a sinistra anche se arriva dopo", () => {
    expect(layout([item("x", "10:00", "10:30", "cancelled_by_customer"), item("c", "10:00", "10:30")])).toEqual({
      c: { lane: 0, lanes: 2 },
      x: { lane: 1, lanes: 2 },
    });
  });

  it("cancellata parzialmente sovrapposta", () => {
    expect(layout([item("c", "10:00", "10:30"), item("x", "10:15", "10:45", "cancelled_by_shop")])).toEqual({
      c: { lane: 0, lanes: 2 },
      x: { lane: 1, lanes: 2 },
    });
  });

  it("cancellata che inizia prima della confermata: la confermata resta comunque nella corsia 0", () => {
    expect(layout([item("x", "09:45", "10:15", "cancelled_by_shop"), item("c", "10:00", "10:30")])).toEqual({
      c: { lane: 0, lanes: 2 },
      x: { lane: 1, lanes: 2 },
    });
  });

  it("due cancellate e una confermata: le cancellate nelle corsie successive, per orario di inizio", () => {
    expect(
      layout([
        item("x2", "10:10", "10:40", "cancelled_by_shop"),
        item("c", "10:00", "10:30"),
        item("x1", "10:00", "10:30", "cancelled_by_customer"),
      ]),
    ).toEqual({
      c: { lane: 0, lanes: 3 },
      x1: { lane: 1, lanes: 3 },
      x2: { lane: 2, lanes: 3 },
    });
  });

  it("catena transitiva A-B-C: un solo gruppo, anche se A e C non si toccano", () => {
    expect(
      layout([
        item("a", "10:00", "10:30"),
        item("b", "10:20", "11:00", "cancelled_by_shop"),
        item("c", "10:45", "11:15"),
      ]),
    ).toEqual({
      a: { lane: 0, lanes: 2 },
      c: { lane: 0, lanes: 2 },
      b: { lane: 1, lanes: 2 },
    });
  });

  it("le cancellate che non si sovrappongono fra loro condividono la stessa corsia", () => {
    expect(
      layout([
        item("c", "10:00", "11:00"),
        item("x1", "10:00", "10:30", "cancelled_by_shop"),
        item("x2", "10:30", "11:00", "cancelled_by_customer"),
      ]),
    ).toEqual({
      c: { lane: 0, lanes: 2 },
      x1: { lane: 1, lanes: 2 },
      x2: { lane: 1, lanes: 2 },
    });
  });

  it("schede che si toccano soltanto non si sovrappongono", () => {
    expect(layout([item("c", "10:00", "10:30"), item("x", "10:30", "11:00", "cancelled_by_shop")])).toEqual({
      c: { lane: 0, lanes: 1 },
      x: { lane: 0, lanes: 1 },
    });
  });

  it("gruppi separati hanno ciascuno il proprio numero di corsie", () => {
    expect(
      layout([
        item("c1", "09:00", "09:30"),
        item("x1", "09:00", "09:30", "cancelled_by_shop"),
        item("c2", "11:00", "11:30"),
      ]),
    ).toEqual({
      c1: { lane: 0, lanes: 2 },
      x1: { lane: 1, lanes: 2 },
      c2: { lane: 0, lanes: 1 },
    });
  });

  it("solo cancellate sovrapposte: partono dalla corsia 0", () => {
    expect(
      layout([item("x1", "10:00", "10:30", "cancelled_by_shop"), item("x2", "10:00", "10:30", "cancelled_by_customer")]),
    ).toEqual({
      x1: { lane: 0, lanes: 2 },
      x2: { lane: 1, lanes: 2 },
    });
  });

  it("completata e no-show contano come non cancellate: stanno prima della cancellata", () => {
    expect(
      layout([item("x", "10:00", "10:30", "cancelled_by_shop"), item("done", "10:00", "10:30", "completed")]),
    ).toEqual({
      done: { lane: 0, lanes: 2 },
      x: { lane: 1, lanes: 2 },
    });
    expect(
      layout([item("x", "09:50", "10:20", "cancelled_by_customer"), item("ns", "10:00", "10:30", "no_show")]),
    ).toEqual({
      ns: { lane: 0, lanes: 2 },
      x: { lane: 1, lanes: 2 },
    });
  });

  it("due non cancellate sovrapposte (righe arrotondate): affiancate per inizio, la cancellata dopo entrambe", () => {
    // Righe della griglia da 15 minuti: 10:00–10:20 occupa le righe 0–1, 10:20–10:40 le righe 1–2.
    const rows = (id: string, start: number, end: number, status: LayoutItem["status"] = "confirmed"): LayoutItem => ({
      id,
      start,
      end,
      status,
    });
    expect(
      layout([rows("x", 0, 2, "cancelled_by_shop"), rows("second", 1, 3), rows("first", 0, 2, "completed")]),
    ).toEqual({
      first: { lane: 0, lanes: 3 },
      second: { lane: 1, lanes: 3 },
      x: { lane: 2, lanes: 3 },
    });
  });

  it("nessuna scheda: risultato vuoto", () => {
    expect(overlapLayout([]).size).toBe(0);
  });
});
