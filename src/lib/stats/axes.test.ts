import { describe, expect, test } from "vitest";
import { bucketPosition, formatAxisValue, niceScale, timeAxisTicks } from "./axes";

const labels = (start: string, end: string) => timeAxisTicks(start, end).ticks.map((tick) => tick.label);

describe("timeAxisTicks", () => {
  test("una settimana: un'etichetta per giorno, senza linee", () => {
    const axis = timeAxisTicks("2026-10-05", "2026-10-11");
    expect(axis.unit).toBe("day");
    expect(axis.ticks.map((tick) => tick.label)).toEqual(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]);
    expect(axis.ticks.every((tick) => !tick.line)).toBe(true);
  });

  test("la settimana del 25 ottobre (cambio d'ora): sette giorni, nessuno doppio o mancante", () => {
    const axis = timeAxisTicks("2026-10-19", "2026-10-25");
    expect(axis.ticks.map((tick) => tick.day)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(axis.ticks.at(-1)?.label).toBe("dom");
    // A cavallo del cambio d'ora, con il periodo che inizia di giovedì
    expect(labels("2026-10-22", "2026-10-28")).toEqual(["gio", "ven", "sab", "dom", "lun", "mar", "mer"]);
  });

  test("fino a 10 giorni ancora per giorno, da 11 per settimana", () => {
    expect(timeAxisTicks("2026-10-01", "2026-10-10").unit).toBe("day");
    expect(timeAxisTicks("2026-10-01", "2026-10-11").unit).toBe("week");
  });

  test("un mese: una linea a ogni lunedì con la data", () => {
    const axis = timeAxisTicks("2026-10-01", "2026-10-31");
    expect(axis.unit).toBe("week");
    expect(axis.ticks.map((tick) => tick.label)).toEqual(["5 ott", "12 ott", "19 ott", "26 ott"]);
    expect(axis.ticks.every((tick) => tick.line)).toBe(true);
  });

  test("un periodo che inizia di lunedì ha la prima linea sul primo giorno", () => {
    expect(timeAxisTicks("2026-06-01", "2026-06-30").ticks[0]).toEqual({ day: "2026-06-01", label: "1 giu", line: true });
  });

  test("un mese a cavallo dell'anno: i lunedì di dicembre e gennaio", () => {
    expect(labels("2026-12-15", "2027-01-14")).toEqual(["21 dic", "28 dic", "4 gen", "11 gen"]);
  });

  test("fino a 62 giorni per settimana, poi per mese", () => {
    expect(timeAxisTicks("2026-01-01", "2026-03-03").unit).toBe("week"); // 62 giorni
    expect(timeAxisTicks("2026-01-01", "2026-03-04").unit).toBe("month");
  });

  test("tre mesi a cavallo dell'anno: anno sul primo mese e su gennaio", () => {
    expect(labels("2026-11-01", "2027-01-31")).toEqual(["nov 2026", "dic", "gen 2027"]);
  });

  test("un anno intero: dodici mesi, l'anno solo sul primo", () => {
    const axis = timeAxisTicks("2026-01-01", "2026-12-31");
    expect(axis.unit).toBe("month");
    expect(axis.ticks.map((tick) => tick.label)).toEqual([
      "gen 2026",
      "feb",
      "mar",
      "apr",
      "mag",
      "giu",
      "lug",
      "ago",
      "set",
      "ott",
      "nov",
      "dic",
    ]);
  });

  test("un periodo che non inizia il primo del mese parte dal mese dopo", () => {
    expect(labels("2026-03-15", "2026-07-10")).toEqual(["apr 2026", "mag", "giu", "lug"]);
  });

  test("più anni: oltre i 731 giorni una linea a ogni inizio anno", () => {
    expect(timeAxisTicks("2025-01-01", "2026-12-31").unit).toBe("month"); // 730 giorni
    const axis = timeAxisTicks("2024-06-15", "2028-03-01");
    expect(axis.unit).toBe("year");
    expect(axis.ticks).toEqual([
      { day: "2025-01-01", label: "2025", line: true },
      { day: "2026-01-01", label: "2026", line: true },
      { day: "2027-01-01", label: "2027", line: true },
      { day: "2028-01-01", label: "2028", line: true },
    ]);
  });
});

describe("bucketPosition", () => {
  const days = [
    { start: "2026-10-05", end: "2026-10-05" },
    { start: "2026-10-06", end: "2026-10-06" },
  ];
  const weeks = [
    { start: "2026-10-01", end: "2026-10-04" }, // tagliata dal bordo: 4 giorni
    { start: "2026-10-05", end: "2026-10-11" },
  ];

  test("inizio e centro di un giorno", () => {
    expect(bucketPosition("2026-10-05", days)).toBe(0);
    expect(bucketPosition("2026-10-06", days, 0.5)).toBe(0.75);
  });

  test("un lunedì cade sul bordo del bucket settimanale, gli altri giorni in proporzione", () => {
    expect(bucketPosition("2026-10-05", weeks)).toBe(0.5);
    expect(bucketPosition("2026-10-03", weeks)).toBe(0.25);
  });

  test("fuori dai bucket: null", () => {
    expect(bucketPosition("2026-10-12", weeks)).toBeNull();
  });
});

describe("niceScale", () => {
  test("massimo 0: tacca 0 e una cima minima, senza divisioni per zero", () => {
    expect(niceScale(0, "count")).toEqual({ ticks: [0, 1, 2], top: 2 });
    expect(niceScale(0, "cents")).toEqual({ ticks: [0, 100, 200], top: 200 });
  });

  test("massimo 1 e 3: solo interi, almeno tre tacche", () => {
    expect(niceScale(1, "count")).toEqual({ ticks: [0, 1, 2], top: 2 });
    expect(niceScale(3, "count")).toEqual({ ticks: [0, 1, 2, 3], top: 3 });
  });

  test("valori piccoli e medi: la cima tonda più bassa ≥ massimo", () => {
    expect(niceScale(4, "count")).toEqual({ ticks: [0, 1, 2, 3, 4], top: 4 });
    expect(niceScale(7, "count")).toEqual({ ticks: [0, 2, 4, 6, 8], top: 8 });
    expect(niceScale(9, "count")).toEqual({ ticks: [0, 5, 10], top: 10 });
    expect(niceScale(100, "count")).toEqual({ ticks: [0, 25, 50, 75, 100], top: 100 });
    expect(niceScale(101, "count")).toEqual({ ticks: [0, 50, 100, 150], top: 150 });
  });

  test("valori grandi", () => {
    expect(niceScale(123_456, "count")).toEqual({ ticks: [0, 50_000, 100_000, 150_000], top: 150_000 });
    expect(niceScale(9_999_999, "count").top).toBe(10_000_000);
  });

  test("euro: passi in euro interi, cima ≥ massimo in centesimi", () => {
    expect(niceScale(4_550, "cents")).toEqual({ ticks: [0, 2_500, 5_000], top: 5_000 }); // 45,50 €
    expect(niceScale(1_234_567, "cents")).toEqual({ ticks: [0, 500_000, 1_000_000, 1_500_000], top: 1_500_000 });
    expect(niceScale(150, "cents")).toEqual({ ticks: [0, 100, 200], top: 200 }); // 1,50 € → niente 0,50 €
  });

  test("percentuali: sempre 0–100%", () => {
    expect(niceScale(0.33, "rate")).toEqual({ ticks: [0, 0.25, 0.5, 0.75, 1], top: 1 });
    expect(niceScale(0, "rate").top).toBe(1);
  });

  test("da 3 a 5 tacche, passi tondi, cima ≥ massimo, per molti massimi", () => {
    for (const kind of ["count", "cents"] as const) {
      for (let max = 0; max <= 5_000; max += 7) {
        const { ticks, top } = niceScale(max, kind);
        expect(ticks.length).toBeGreaterThanOrEqual(3);
        expect(ticks.length).toBeLessThanOrEqual(5);
        expect(top).toBeGreaterThanOrEqual(max);
        expect(ticks.at(-1)).toBe(top);
        const step = (ticks[1] ?? 0) / (kind === "cents" ? 100 : 1);
        expect(Number.isInteger(step)).toBe(true);
        const mantissa = step / 10 ** Math.floor(Math.log10(step));
        expect([1, 2, 2.5, 5]).toContain(mantissa);
      }
    }
  });
});

describe("formatAxisValue", () => {
  test("conteggi, euro interi it-IT e percentuali", () => {
    expect(formatAxisValue(12, "count")).toBe("12");
    expect(formatAxisValue(1_500, "count")).toBe("1.500");
    expect(formatAxisValue(150_000, "cents")).toBe("1.500 €");
    expect(formatAxisValue(2_500, "cents")).toBe("25 €");
    expect(formatAxisValue(0.25, "rate")).toBe("25%");
  });
});
