// Regressioni della review fetta 8a (scritte durante l'implementazione, non da spec-qa).
// Miglioria 6 (opzione B): fasce che finiscono alle 24:00. Miglioria 10: formattazione delle date
// nelle caselle dei giorni e nella prossima prenotazione.
import { describe, expect, test } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { dayParts, formatLongDate } from "@/lib/booking/format";
import { openingStatus } from "@/lib/shop/opening";

describe("dayParts (caselle dei giorni)", () => {
  test("giorno della settimana, numero e mese abbreviati in italiano", () => {
    expect(dayParts("2026-10-06")).toEqual({ weekday: "mar", day: "6", month: "ott" });
  });

  test("il primo del mese ha day \"1\" (la casella mostra il mese)", () => {
    expect(dayParts("2026-11-01")).toEqual({ weekday: "dom", day: "1", month: "nov" });
  });

  test("indipendente dal fuso del processo: il giorno del cambio d'ora resta quel giorno", () => {
    expect(dayParts("2026-10-25")).toEqual({ weekday: "dom", day: "25", month: "ott" });
    expect(dayParts("2027-03-28")).toEqual({ weekday: "dom", day: "28", month: "mar" });
  });
});

describe("formatLongDate (prossima prenotazione)", () => {
  test("giorno locale del negozio, senza ora", () => {
    expect(formatLongDate("2026-10-13T08:00:00Z", "Europe/Rome")).toBe("martedì 13 ottobre");
  });

  test("vicino alla mezzanotte vale il giorno locale, non quello UTC", () => {
    // 22:30Z del 12 ottobre = 00:30 del 13 a Roma (ora legale)
    expect(formatLongDate("2026-10-12T22:30:00Z", "Europe/Rome")).toBe("martedì 13 ottobre");
  });
});

describe("openingStatus con fasce fino alle 24:00", () => {
  const TZ = "Europe/Rome";
  const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, TZ);
  // Venerdì 9 ottobre 2026 = weekday 5
  const hours = [{ weekday: 5, start: "18:00", end: "24:00" }];

  test("alle 23:00 è aperto fino alla mezzanotte del giorno dopo", () => {
    expect(openingStatus({ now: at("2026-10-09", "23:00"), timezone: TZ, hours, closures: [] })).toEqual({
      state: "open",
      until: at("2026-10-10", "00:00"),
    });
  });

  test("prima dell'apertura apre alle 18:00; a mezzanotte è già il giorno dopo", () => {
    expect(openingStatus({ now: at("2026-10-09", "12:00"), timezone: TZ, hours, closures: [] })).toEqual({
      state: "opens_later",
      at: at("2026-10-09", "18:00"),
    });
    expect(openingStatus({ now: at("2026-10-10", "00:00"), timezone: TZ, hours, closures: [] })).toEqual({
      state: "closed_today",
    });
  });

  test("giorno intero 00:00–24:00 nel cambio all'ora solare: 25 ore reali", () => {
    const allDay = [{ weekday: 7, start: "00:00", end: "24:00" }];
    // Domenica 25 ottobre 2026: dalle 22:00Z del 24 alle 23:00Z del 25
    expect(openingStatus({ now: new Date("2026-10-25T12:00:00Z"), timezone: TZ, hours: allDay, closures: [] })).toEqual({
      state: "open",
      until: new Date("2026-10-25T23:00:00Z"),
    });
  });
});
