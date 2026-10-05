// Regressioni della review della FETTA 6 (commit "fix: review fetta 6"), richieste dall'utente.
// Non sono test di accettazione scritti da spec-qa: coprono le migliorie 1–10 della review.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { it as texts } from "@/i18n/it";
import { bookingErrorText, rpcErrorCode } from "@/lib/booking/errors";
import { unchangedStart, usesInactiveChoice } from "@/lib/calendar/edit";
import { busyRows, dayGrid } from "@/lib/calendar/grid";
import { newBookingBarber } from "@/lib/calendar/view";
import { exactLocalDateTimeToUtc, localDateTimeToUtc } from "@/lib/domain/local-time";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (file: string): string => readFileSync(resolve(ROOT, file), "utf8");
const TZ = "Europe/Rome";
const jan = (time: string): Date => new Date(`2027-01-12T${time}:00+01:00`);

describe("1. servizio e barbiere disattivati (SPEC §3.2)", () => {
  const choice = (serviceChanged: boolean, serviceActive: boolean, barberChanged: boolean, barberActive: boolean) =>
    usesInactiveChoice({
      service: { changed: serviceChanged, active: serviceActive },
      barber: { changed: barberChanged, active: barberActive },
    });

  test("una scelta nuova disattivata è rifiutata", () => {
    expect(choice(true, false, true, true)).toBe(true);
    expect(choice(true, true, true, false)).toBe(true);
    expect(choice(true, true, true, true)).toBe(false);
  });

  test("in modifica restano ammessi servizio e barbiere già sulla prenotazione", () => {
    expect(choice(false, false, false, false)).toBe(false);
    expect(choice(false, false, true, true)).toBe(false);
  });

  test("le azioni applicano il controllo lato server", () => {
    const actions = source("src/lib/calendar/actions.ts");
    const create = actions.slice(actions.indexOf("export async function createManualBooking"));
    const update = actions.slice(actions.indexOf("export async function updateBooking"));
    for (const body of [create, update]) {
      expect(body.slice(0, body.indexOf("export async function", 10))).toMatch(
        /from\("barbers"\)\.select\("is_active"\)[\s\S]*usesInactiveChoice/,
      );
    }
  });
});

describe("2–3. data e ora invariate nella modifica", () => {
  test("cambio all'ora solare: un orario nell'ora ripetuta non cambia occorrenza", () => {
    // 02:30 compare due volte; la conversione dell'ora locale ne sceglie una sola, quindi una
    // delle due verrebbe spostata di un'ora. Riusando l'istante salvato nessuna si sposta.
    const occurrences = [new Date("2026-10-25T02:30:00+02:00"), new Date("2026-10-25T02:30:00+01:00")];
    for (const saved of occurrences) {
      expect(unchangedStart(saved, "2026-10-25", "02:30", TZ)?.getTime()).toBe(saved.getTime());
    }
    // La conversione dà una sola delle due occorrenze: l'altra, riconvertita, si sposterebbe.
    const converted = localDateTimeToUtc("2026-10-25", "02:30", TZ).getTime();
    expect(occurrences.filter((saved) => saved.getTime() === converted)).toHaveLength(1);
  });

  test("minuti non multipli di 5: l'orario salvato si riusa", () => {
    const saved = jan("10:07");
    expect(unchangedStart(saved, "2027-01-12", "10:07", TZ)).toBe(saved);
  });

  test("data o ora cambiate → null (si converte il nuovo orario)", () => {
    expect(unchangedStart(jan("10:07"), "2027-01-12", "10:10", TZ)).toBeNull();
    expect(unchangedStart(jan("10:07"), "2027-01-13", "10:07", TZ)).toBeNull();
  });

  test("passaggio all'ora legale: un orario inesistente non viene spostato in silenzio", () => {
    expect(exactLocalDateTimeToUtc("2027-03-28", "02:30", TZ)).toBeNull();
    expect(exactLocalDateTimeToUtc("2027-03-28", "03:30", TZ)?.toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(exactLocalDateTimeToUtc("2027-02-30", "10:00", TZ)).toBeNull();
  });
});

describe("4. online: gara con una manuale dello stesso cliente", () => {
  test("il 23P01 del vincolo sul cliente è customer_overlap", () => {
    const code = rpcErrorCode({
      code: "23P01",
      message: 'conflicting key value violates exclusion constraint "bookings_customer_no_overlap"',
    });
    expect(code).toBe("customer_overlap");
    expect(bookingErrorText(code)).toBe(texts.booking.errors.customerOverlap);
  });

  test("il vincolo del barbiere resta 'orario appena occupato'; i P0001 restano il loro codice", () => {
    const taken = rpcErrorCode({
      code: "23P01",
      message: 'conflicting key value violates exclusion constraint "bookings_no_overlap"',
    });
    expect(bookingErrorText(taken)).toBe(texts.booking.errors.taken);
    expect(rpcErrorCode({ code: "P0001", message: "too_soon" })).toBe("too_soon");
  });
});

describe("5. pagina d'errore per dettaglio e nuova prenotazione", () => {
  test("error.tsx client sotto /admin/calendario con il testo di it.ts", () => {
    const code = source("src/app/admin/(panel)/calendario/error.tsx");
    expect(code).toMatch(/^"use client"/);
    expect(code).toMatch(/it\.admin\.calendar\.pageError/);
  });
});

describe("6. cambio di stato concorrente e nota su prenotazione non visibile", () => {
  const actions = source("src/lib/calendar/actions.ts");

  test("cambio concorrente → stale con il messaggio 'ricarica'", () => {
    const body = actions.slice(actions.indexOf("export async function changeBookingStatus"));
    expect(body).toMatch(/existing\.status !== expected\.data\) return \{ status: "stale" \}/);
    expect(body).toMatch(/updated\.length !== 1\) return \{ status: "stale" \}/);
    expect(texts.admin.calendar.errors.stale).toMatch(/modificata/);
    expect(texts.admin.calendar.errors.stale).toMatch(/ricarica/);
    expect(source("src/app/admin/(panel)/calendario/[id]/page.tsx")).toMatch(/expectedStatus: booking\.status/);
  });

  test("la nota controlla prima che la prenotazione sia visibile (niente 'salvato' su 0 righe)", () => {
    const body = actions.slice(actions.indexOf("export async function saveStaffNote"));
    const check = body.indexOf('from("bookings")');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf('from("booking_staff_notes")'));
    expect(body).toMatch(/if \(!booking\) return \{ status: "forbidden" \}/);
  });
});

describe("7. barbiere disattivato nella nuova prenotazione", () => {
  const barbers = [
    { id: "a", isActive: true },
    { id: "b", isActive: false },
  ];

  test("richiesto e attivo → preselezionato senza avviso", () => {
    expect(newBookingBarber({ requestedId: "a", barbers })).toEqual({ barberId: "a", requestedUnavailable: false });
  });

  test("richiesto ma disattivato o sconosciuto → segnalato", () => {
    expect(newBookingBarber({ requestedId: "b", barbers })).toEqual({ barberId: "a", requestedUnavailable: true });
    expect(newBookingBarber({ requestedId: "x", barbers }).requestedUnavailable).toBe(true);
  });

  test("senza richiesta nessun avviso; senza barbieri attivi nessuna scelta", () => {
    expect(newBookingBarber({ requestedId: null, barbers })).toEqual({ barberId: "a", requestedUnavailable: false });
    expect(newBookingBarber({ requestedId: null, barbers: [barbers[1]] }).barberId).toBeNull();
  });
});

describe("8. buffer dopo una prenotazione", () => {
  test("le righe dentro il buffer sono occupate, quella dopo no", () => {
    const grid = dayGrid({ date: "2027-01-12", tz: TZ, granularityMin: 15, bands: [{ start: "10:00", end: "12:00" }], bookings: [] });
    // 10:00–10:30 con 15' di buffer → occupato fino alle 10:45
    const busy = busyRows(grid, [{ startsAt: jan("10:00"), endsAt: jan("10:45") }]);
    expect(busy.slice(0, 4)).toEqual([true, true, true, false]);
  });
});

describe("9. ricerca clienti", () => {
  test("stato di caricamento ed errore distinto dal risultato vuoto", () => {
    const picker = source("src/components/admin/calendar/customer-picker.tsx");
    expect(picker).toMatch(/t\.searching/);
    expect(picker).toMatch(/t\.searchError/);
    expect(source("src/lib/calendar/actions.ts")).toMatch(/return \{ ok: false \}/);
  });
});

describe("10. it.ts con fine riga LF", () => {
  test("nessun CR", () => {
    expect(source("src/i18n/it.ts")).not.toMatch(/\r/);
  });
});
