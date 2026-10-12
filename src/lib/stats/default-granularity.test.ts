import { describe, expect, test } from "vitest";
import { statsPath } from "./paths";
import { defaultGranularity, periodShortcut, STATS_SHORTCUTS } from "./periods";
import { chosenGranularity, type StatsParams, statsSearchParamsSchema } from "./schemas";
import { addDays } from "./dates";

const TODAY = "2026-10-13";

describe("defaultGranularity", () => {
  test.each([
    ["thisWeek", "giorno"],
    ["thisMonth", "giorno"],
    ["last3Months", "settimana"],
    ["thisYear", "mese"],
  ] as const)("periodo rapido %s → %s", (key, expected) => {
    expect(defaultGranularity(periodShortcut(key, TODAY))).toBe(expected);
  });

  test("ogni periodo rapido ha un predefinito anche negli anni bisestili e nei mesi corti", () => {
    for (const today of ["2028-02-29", "2027-02-10", "2026-12-31", "2027-01-01"]) {
      for (const key of STATS_SHORTCUTS) {
        expect(defaultGranularity(periodShortcut(key, today))).toBe(
          { thisWeek: "giorno", thisMonth: "giorno", last3Months: "settimana", thisYear: "mese" }[key],
        );
      }
    }
  });

  test.each([
    [1, "giorno"],
    [62, "giorno"],
    [63, "settimana"],
    [120, "settimana"],
    [121, "mese"],
    [366, "mese"],
  ] as const)("periodo personalizzato di %i giorni → %s", (days, expected) => {
    expect(defaultGranularity({ from: "2026-01-01", to: addDays("2026-01-01", days - 1) })).toBe(expected);
  });
});

describe("raggruppamento nei parametri della pagina", () => {
  const parse = (input: Record<string, string | undefined>) => statsSearchParamsSchema(TODAY).parse(input);

  test("senza scelta vale il predefinito del periodo", () => {
    expect(parse({ dal: "2026-01-01", al: "2026-12-31" }).granularity).toBe("mese");
    expect(parse({ dal: "2026-08-01", al: "2026-10-31" }).granularity).toBe("settimana");
    expect(parse({ dal: "2026-10-01", al: "2026-10-31" }).granularity).toBe("giorno");
    expect(parse({}).granularity).toBe("giorno"); // mese corrente
  });

  test("un valore vuoto o sconosciuto non è una scelta", () => {
    expect(parse({ dal: "2026-01-01", al: "2026-12-31", raggruppa: "" }).granularity).toBe("mese");
    expect(parse({ dal: "2026-01-01", al: "2026-12-31", raggruppa: "anno" }).granularity).toBe("mese");
  });

  test("la scelta dell'admin vale su qualunque periodo", () => {
    expect(parse({ dal: "2026-01-01", al: "2026-12-31", raggruppa: "giorno" }).granularity).toBe("giorno");
    expect(parse({ dal: "2026-10-01", al: "2026-10-31", raggruppa: "mese" }).granularity).toBe("mese");
  });

  test("chosenGranularity riconosce solo i tre valori", () => {
    expect(chosenGranularity("settimana")).toBe("settimana");
    expect(chosenGranularity(undefined)).toBeNull();
    expect(chosenGranularity("")).toBeNull();
    expect(chosenGranularity("week")).toBeNull();
  });
});

describe("statsPath e raggruppamento", () => {
  const year: StatsParams = {
    from: "2026-01-01",
    to: "2026-12-31",
    granularity: "mese",
    barberId: null,
    excludeDemo: false,
    chart: "prenotazioni",
  };
  const raggruppa = (path: string) => new URL(path, "http://localhost").searchParams.get("raggruppa");

  test("il predefinito del periodo resta fuori dall'URL", () => {
    expect(raggruppa(statsPath(year))).toBeNull();
    expect(raggruppa(statsPath({ ...year, from: "2026-10-01", to: "2026-10-31", granularity: "giorno" }))).toBeNull();
  });

  test("un raggruppamento diverso dal predefinito va nell'URL", () => {
    expect(raggruppa(statsPath({ ...year, granularity: "giorno" }))).toBe("giorno");
  });

  test("con keepGranularity la scelta resta anche se coincide con il predefinito", () => {
    expect(raggruppa(statsPath(year, { keepGranularity: true }))).toBe("mese");
  });
});
