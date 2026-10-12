import { describe, expect, test } from "vitest";
import { alternateLabels, bucketPosition, chartAxis, formatAxisValue, niceScale, timeAxisTicks } from "./axes";
import { buildStats, type Granularity } from "./aggregate";

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

/** Bucket dell'andamento come li costruisce la pagina (bordi tagliati al periodo). */
const buckets = (from: string, to: string, granularity: Granularity) =>
  buildStats([], { from, to, granularity }).series.map(({ start, end }) => ({ start, end }));

describe("chartAxis: le linee cadono sui confini fra due barre", () => {
  test("barre per giorno: la linea del lunedì è il confine fra domenica e lunedì", () => {
    const series = buckets("2026-10-01", "2026-10-31", "giorno");
    const axis = chartAxis(series, "giorno");
    expect(axis.unit).toBe("week");
    const monday = axis.marks[0];
    expect(monday).toMatchObject({ day: "2026-10-05", label: "5 ott", line: 4, at: 4.5 / 31 });
    // Ogni linea coincide con l'inizio di una barra
    for (const mark of axis.marks) expect(series[mark.line ?? -1]?.start).toBe(mark.day);
  });

  test("barre per settimana in un mese: una linea a ogni lunedì, sul confine fra due settimane", () => {
    const series = buckets("2026-10-01", "2026-10-31", "settimana"); // 1–4, 5–11, 12–18, 19–25, 26–31
    expect(chartAxis(series, "settimana").marks.map((mark) => mark.line)).toEqual([1, 2, 3, 4]);
  });

  test("barre per settimana su tre mesi: l'inizio del mese va sul lunedì più vicino", () => {
    const series = buckets("2026-08-01", "2026-10-31", "settimana");
    const axis = chartAxis(series, "settimana");
    expect(axis.marks.map((mark) => mark.label)).toEqual(["ago 2026", "set", "ott"]);
    // 1 ago (sab) è l'inizio del periodo: nessuna linea; 1 set (mar) → lunedì 31 ago; 1 ott (gio) → lunedì 28 set
    expect(axis.marks.map((mark) => (mark.line === null ? null : series[mark.line]?.start))).toEqual([
      null,
      "2026-08-31",
      "2026-09-28",
    ]);
  });

  test("barre per settimana su un anno: dodici mesi, ognuno su un confine diverso", () => {
    const series = buckets("2026-01-01", "2026-12-31", "settimana");
    const axis = chartAxis(series, "settimana");
    expect(axis.marks).toHaveLength(12);
    const lines = axis.marks.flatMap((mark) => (mark.line === null ? [] : [mark.line]));
    expect(lines).toHaveLength(11);
    expect(new Set(lines).size).toBe(lines.length);
  });

  test("un inizio mese più vicino alla fine del periodo che a un lunedì non ha tacca", () => {
    // 1 nov 2026 è domenica: il confine più vicino è la fine del periodo
    const series = buckets("2026-08-03", "2026-11-01", "settimana");
    expect(chartAxis(series, "settimana").marks.map((mark) => mark.label)).toEqual(["set 2026", "ott"]);
  });

  test("barre per mese: un'etichetta sotto ogni barra, una linea solo fra due anni", () => {
    const series = buckets("2026-11-01", "2027-02-28", "mese");
    const axis = chartAxis(series, "mese");
    expect(axis.perBar).toBe(true);
    expect(axis.marks).toEqual([
      { day: "2026-11-01", label: "nov 2026", at: 0.5 / 4, line: null },
      { day: "2026-12-01", label: "dic", at: 1.5 / 4, line: null },
      { day: "2027-01-01", label: "gen 2027", at: 2.5 / 4, line: 2 },
      { day: "2027-02-01", label: "feb", at: 3.5 / 4, line: null },
    ]);
  });

  test("barre per mese in un mese solo: nessuna linea dentro la barra", () => {
    const axis = chartAxis(buckets("2026-10-01", "2026-10-31", "mese"), "mese");
    expect(axis.marks).toEqual([{ day: "2026-10-01", label: "ott 2026", at: 0.5, line: null }]);
  });

  test("una settimana: i nomi dei giorni al centro, anche su una sola barra settimanale", () => {
    expect(chartAxis(buckets("2026-10-19", "2026-10-25", "giorno"), "giorno").marks[0]).toEqual({
      day: "2026-10-19",
      label: "lun",
      at: 0.5 / 7,
      line: null,
    });
    const week = chartAxis(buckets("2026-10-19", "2026-10-25", "settimana"), "settimana");
    expect(week.marks.map((mark) => mark.label)).toEqual(["lun", "mar", "mer", "gio", "ven", "sab", "dom"]);
    expect(week.marks.every((mark) => mark.line === null)).toBe(true);
  });

  test("nessun bucket: nessuna tacca", () => {
    expect(chartAxis([], "giorno").marks).toEqual([]);
  });
});

describe("alternateLabels", () => {
  const visibleOf = (labels: string[]) => labels.filter((_, index) => alternateLabels(labels)[index]);

  test("una sì e una no, partendo dalla prima", () => {
    expect(visibleOf(["5 ott", "12 ott", "19 ott", "26 ott", "2 nov", "9 nov"])).toEqual(["5 ott", "19 ott", "2 nov"]);
  });

  test("un anno da gennaio: l'anno sul primo resta, poi un mese sì e uno no", () => {
    const months = ["gen 2026", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
    expect(visibleOf(months)).toEqual(["gen 2026", "mar", "mag", "lug", "set", "nov"]);
  });

  test("da dicembre: gennaio con l'anno resta visibile e il primo mese lascia il posto", () => {
    const months = ["dic 2025", "gen 2026", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov"];
    expect(visibleOf(months)).toEqual(["gen 2026", "mar", "mag", "lug", "set", "nov"]);
  });

  test("gennaio a metà: le etichette accanto si nascondono", () => {
    const months = ["giu 2026", "lug", "ago", "set", "ott", "nov", "dic", "gen 2027", "feb", "mar"];
    expect(visibleOf(months)).toEqual(["giu 2026", "ago", "ott", "gen 2027", "mar"]);
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
