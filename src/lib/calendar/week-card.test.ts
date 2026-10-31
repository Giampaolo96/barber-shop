// Schede della vista settimana nei giorni del cambio d'ora e sfondo delle righe occupate (fetta 8j,
// migliorie M1 e M2 della review). CLAUDE.md regola 2: istanti reali, orologio del negozio.
import { describe, expect, test } from "vitest";
import { dayBlockPosition, slotBackgrounds, weekCardGeometry, type WeekGrid } from "./week-grid";

const TZ = "Europe/Rome";

const axis = (startMin: number, endMin: number, granularityMin = 15): WeekGrid => {
  const rows: number[] = [];
  for (let minute = startMin; minute < endMin; minute += granularityMin) rows.push(minute);
  return { granularityMin, startMin, endMin, rows };
};

const geometry = (grid: WeekGrid, date: string, startsAt: string, endsAt: string, blockedUntil = endsAt) => {
  const booking = { startsAt: new Date(startsAt), endsAt: new Date(endsAt), blockedUntil: new Date(blockedUntil) };
  const position = dayBlockPosition(grid, date, booking, TZ);
  expect(position, "la scheda si deve vedere").not.toBeNull();
  return weekCardGeometry(grid, date, position?.row ?? 0, booking, TZ);
};

describe.each([
  ["2026-10-25", "00:30", "01:00", "01:30", "02:00"],
  ["2027-10-31", "00:30", "01:00", "01:30", "02:00"],
] as const)("ora ripetuta del %s", (date, firstStart, firstEnd, secondStart, secondEnd) => {
  const grid = axis(60, 300);

  test("prima occorrenza: 02:30–02:00 dura 30 minuti, non zero", () => {
    expect(geometry(grid, date, `${date}T${firstStart}:00Z`, `${date}T${firstEnd}:00Z`)).toEqual({
      offsetMin: 0,
      serviceMin: 30,
      bufferMin: 0,
    });
  });

  test("seconda occorrenza: stessa riga, stessa altezza", () => {
    expect(geometry(grid, date, `${date}T${secondStart}:00Z`, `${date}T${secondEnd}:00Z`).serviceMin).toBe(30);
  });

  test("a cavallo delle due occorrenze: 02:30–02:30 dura un'ora", () => {
    expect(geometry(grid, date, `${date}T${firstStart}:00Z`, `${date}T${secondStart}:00Z`).serviceMin).toBe(60);
  });

  test("la pausa si conta in minuti reali", () => {
    expect(
      geometry(grid, date, `${date}T${firstStart}:00Z`, `${date}T${firstEnd}:00Z`, `${date}T${secondStart}:00Z`),
    ).toEqual({ offsetMin: 0, serviceMin: 30, bufferMin: 30 });
  });

  test("una prenotazione che attraversa l'ora ripetuta non è più bassa dei minuti reali", () => {
    // 01:30 → 03:30: 180 minuti reali, 120 sull'orologio
    const earlier = new Date(`${date}T01:30:00+02:00`).toISOString();
    expect(geometry(grid, date, earlier, new Date(`${date}T03:30:00+01:00`).toISOString()).serviceMin).toBe(180);
  });
});

describe("ora mancante del 2027-03-28", () => {
  const date = "2027-03-28";
  const grid = axis(60, 300);

  test("01:50–03:10: la scheda arriva all'orario che mostra", () => {
    const result = geometry(grid, date, "2027-03-28T00:50:00Z", "2027-03-28T01:10:00Z");
    expect(result.offsetMin).toBe(5);
    expect(result.serviceMin).toBe(80);
  });

  test("dopo il buco l'altezza è quella reale", () => {
    expect(geometry(grid, date, "2027-03-28T01:15:00Z", "2027-03-28T01:45:00Z").serviceMin).toBe(30);
  });

  test("la pausa oltre il buco non si perde", () => {
    const result = geometry(grid, date, "2027-03-28T00:30:00Z", "2027-03-28T00:50:00Z", "2027-03-28T01:10:00Z");
    expect(result.serviceMin).toBe(20);
    expect(result.bufferMin).toBeGreaterThanOrEqual(20);
  });
});

describe("giorni normali", () => {
  test("altezza reale, scarto dalla riga e pausa", () => {
    expect(
      geometry(axis(540, 1170), "2047-01-15", "2047-01-15T09:05:00Z", "2047-01-15T09:25:00Z", "2047-01-15T09:35:00Z"),
    ).toEqual({ offsetMin: 5, serviceMin: 20, bufferMin: 10 });
  });

  test("ritagliata alla fine dell'asse e al giorno", () => {
    const grid = axis(540, 1170);
    expect(geometry(grid, "2047-01-15", "2047-01-15T17:00:00Z", "2047-01-15T19:00:00Z").serviceMin).toBe(90);
    expect(geometry(axis(0, 1440), "2047-01-15", "2047-01-15T22:30:00Z", "2047-01-15T23:30:00Z").serviceMin).toBe(30);
  });
});

describe("slotBackgrounds (M2)", () => {
  const date = "2047-01-15";
  const interval = (from: string, to: string) => ({
    startsAt: new Date(`${date}T${from}:00+01:00`),
    endsAt: new Date(`${date}T${to}:00+01:00`),
  });
  const base = { date, tz: TZ, grid: axis(600, 720, 30), bands: [interval("10:00", "11:00")], timeOff: [], closures: [] };

  test("orario e fuori orario, senza guardare le prenotazioni", () => {
    expect(slotBackgrounds(base)).toEqual(["free", "free", "outside", "outside"]);
  });

  test("assenza e chiusura hanno la precedenza, come in daySlots", () => {
    expect(
      slotBackgrounds({ ...base, timeOff: [interval("10:30", "11:30")], closures: [interval("10:00", "10:30")] }),
    ).toEqual(["closure", "timeOff", "timeOff", "outside"]);
  });

  test("ora mancante: la riga non esiste", () => {
    const missing = { ...base, date: "2027-03-28", grid: axis(120, 180, 30), bands: [] };
    expect(slotBackgrounds(missing)).toEqual(["nonexistent", "nonexistent"]);
  });
});
