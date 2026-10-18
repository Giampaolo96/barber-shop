import { describe, expect, test } from "vitest";
import { formatNextFree, formatNextFreeDay, formatSlotTime } from "./when";

const TZ = "Europe/Rome";

describe("formatNextFreeDay", () => {
  test("giorno della settimana abbreviato e numero, nella timezone del negozio", () => {
    expect(formatNextFreeDay("2026-10-20T07:30:00.000Z", TZ)).toBe("mar 20");
    // 23:30 UTC del 1° marzo è già il 2 a Roma
    expect(formatNextFreeDay("2027-03-01T23:30:00.000Z", TZ)).toBe("mar 2");
  });

  test("formatNextFree è il giorno più l'ora del link della colonna", () => {
    const iso = "2026-10-25T08:00:00.000Z";
    expect(formatNextFree(iso, TZ)).toBe(`${formatNextFreeDay(iso, TZ)}, ${formatSlotTime(iso, TZ)}`);
  });
});
