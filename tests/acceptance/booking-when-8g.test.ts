// Test di accettazione – FETTA 8g ("Quando?": rifiniture della fila continua; decisioni approvate
// dall'utente il 2026-10-25). SPEC §5.2 (fila continua, ridimensionamento, annuncio per lo screen
// reader, orari dal motore di §4 senza regole nuove), §4, §12 (cambio d'ora, assenza parziale, buffer),
// CLAUDE.md regola 5 (logica pura, senza I/O) e Sicurezza (matcher del proxy).
// Parte pura; la parte server (getWhenOverview, route handler) è in booking-when-8g-server.test.ts.
//
// Interfacce attese:
//   src/lib/availability (export da index.ts, funzione pura):
//     slotsByDay(input: AvailabilityInput, from: string, to: string):
//       Record<string, Array<{ barberId: string; slots: Date[]; next: Date | null }>>
//     - una chiave per OGNI giorno locale in [from, to] (inclusi, nell'ordine), anche i giorni chiusi
//       (presenti con slots vuoti); from > to → {};
//     - per ogni giorno un elemento per ogni barbiere dell'input, nell'ordine dell'input;
//     - slots = computeSlotsByBarber(input, giorno)[barberId];
//     - next = primo orario del barbiere nei giorni dopo quel giorno fino a `to` incluso, SOLO se quel
//       giorno il barbiere non ha orari (come nextSlotByBarber); altrimenti null.
//   src/lib/booking/when-row.ts (funzioni pure, posizioni come rowLayout: scrollLeft 0 = prima
//   colonna al bordo dopo i 16 px di scroll-padding, quindi il margine non conta mai come visibile):
//     type RowAnchor = { day: string; barberIndex: number; fraction: number }
//     captureAnchor(layout: RowLayout, scrollLeft: number): RowAnchor
//       colonna più a sinistra visibile (la prima con end > scrollLeft, come dayAtScroll) e frazione
//       della sua larghezza già uscita a sinistra: (scrollLeft - start) / (end - start), 0 se è al
//       bordo. Se il bordo cade nello spazio prima della colonna (gap o spazio-giorno) fraction ≤ 0.
//       La posizione verticale NON fa parte dell'ancora.
//     restoreAnchor(layout: RowLayout, anchor: RowAnchor, maxScrollLeft: number): number
//       scrollLeft che rimette la stessa colonna più a sinistra alla stessa frazione nel nuovo layout
//       (al bordo se fraction = 0; nello spazio prima di lei se fraction < 0), limitato a
//       [0, maxScrollLeft].
//   src/lib/booking/when-state.ts:
//     DayCacheAction in più: { type: 'loadedMany'; requestId: number; days: WhenDay[] }
//     (WhenDay = { date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> })
//     Regola: ogni giorno di `days` diventa { status: 'loaded', day }, tranne quando la sua voce è
//     { status: 'loading' } con requestId MAGGIORE di action.requestId (richiesta singola più recente in
//     corso: vince la sua risposta). Voci 'loaded', 'error' e 'loading' più vecchie si sovrascrivono.
//     I giorni non presenti in `days` restano come sono (una ricarica non fa sparire nulla). Pura.
//     requestId della stessa sequenza delle richieste singole (fetchWhenDay).
//   src/i18n/it.ts: it.booking.when.dayAnnounceEmpty = "{day}, nessun orario libero"; spariscono
//     it.booking.when.firstFree e it.booking.when.noSlots ("Primo libero" tolto).
//   Tolti: firstFree (motore), firstFreeAmong (when.ts), src/lib/booking/when-queue.ts.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromZonedTime } from 'date-fns-tz';
import { describe, expect, test } from 'vitest';

import {
  computeSlotsByBarber,
  nextSlotByBarber,
  slotsByDay,
  type AvailabilityInput,
  type BarberAvailabilityInput,
} from '@/lib/availability';
import type { WhenDay } from '@/lib/booking/availability';
import {
  captureAnchor,
  dayAtScroll,
  firstColumnOffset,
  restoreAnchor,
  rowLayout,
  type RowLayout,
} from '@/lib/booking/when-row';
import { dayCacheReducer, type DayCache } from '@/lib/booking/when-state';

// ---------------------------------------------------------------------------
// slotsByDay – SPEC §5.2 ("orari dal motore di §4 senza regole nuove"), §4, §12
// ---------------------------------------------------------------------------
const TZ = 'Europe/Rome';
const B1 = 'b8a00000-0000-4000-8000-000000000001';
const B2 = 'b8a00000-0000-4000-8000-000000000002';
const B3 = 'b8a00000-0000-4000-8000-000000000003';

const at = (date: string, time: string): Date => fromZonedTime(`${date}T${time}:00`, TZ);
const iv = (date: string, from: string, to: string) => ({ start: at(date, from), end: at(date, to) });
const barber = (barberId: string, b: Partial<Omit<BarberAvailabilityInput, 'barberId'>> = {}): BarberAvailabilityInput => ({
  barberId,
  work: [],
  timeOff: [],
  busy: [],
  ...b,
});
const iso = (dates: Date[] | undefined): string[] => (dates ?? []).map((d) => d.toISOString());
const isoOrNull = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** Settimana del passaggio all'ora legale (domenica 28/03/2027), con buffer 10'. */
const FROM = '2027-03-25';
const TO = '2027-03-31';
const PERIOD = ['2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29', '2027-03-30', '2027-03-31'];
const springInput = (): AvailabilityInput => ({
  timezone: TZ,
  now: at('2027-03-24', '08:00'),
  settings: { slotGranularityMin: 15, minAdvanceMin: 60, maxHorizonDays: 30, bufferMin: 10 },
  serviceDurationMin: 30,
  // 30/03: negozio chiuso tutto il giorno
  closures: [{ start: at('2027-03-30', '00:00'), end: at('2027-03-31', '00:00') }],
  barbers: [
    barber(B1, {
      work: [
        iv('2027-03-25', '09:00', '10:00'),
        iv('2027-03-26', '09:00', '11:00'),
        iv('2027-03-28', '09:00', '10:00'), // giorno del cambio d'ora
        iv('2027-03-29', '09:00', '10:30'),
        iv('2027-03-30', '09:00', '10:00'), // cade nella chiusura
      ],
      // assenza parziale a metà mattina (SPEC §12)
      timeOff: [iv('2027-03-26', '09:30', '10:30')],
      // prenotazione con il buffer copiato: [inizio, blocked_until)
      busy: [iv('2027-03-29', '09:00', '09:40')],
    }),
    barber(B2, {
      work: [iv('2027-03-25', '09:00', '09:30'), iv('2027-03-27', '15:00', '16:00'), iv('2027-03-31', '09:00', '09:30')],
      busy: [iv('2027-03-25', '09:00', '09:30')], // pieno il 25
    }),
    barber(B3, {
      work: [iv('2027-03-25', '09:00', '09:30')],
      busy: [iv('2027-03-25', '09:00', '09:40')], // pieno il 25 e poi più niente
    }),
  ],
});

/** Confronto giorno per giorno con computeSlotsByBarber e nextSlotByBarber. */
const expectSameAsEngine = (input: AvailabilityInput, from: string, to: string, period: string[]): void => {
  const result = slotsByDay(input, from, to);
  expect(Object.keys(result), 'un giorno per ogni data del periodo, chiusi compresi, in ordine').toEqual(period);
  for (const date of period) {
    const entries = result[date] ?? [];
    expect(entries.map((e) => e.barberId), `${date}: un elemento per barbiere, nell'ordine dell'input`).toEqual(
      input.barbers.map((b) => b.barberId),
    );
    const bySlots = computeSlotsByBarber(input, date);
    const next = nextSlotByBarber(input, date, to);
    for (const entry of entries) {
      expect(Object.keys(entry).sort(), `${date}: chiavi`).toEqual(['barberId', 'next', 'slots']);
      const expected = iso(bySlots[entry.barberId]);
      expect(iso(entry.slots), `${date} ${entry.barberId}: orari come computeSlotsByBarber`).toEqual(expected);
      expect(isoOrNull(entry.next), `${date} ${entry.barberId}: next solo se il giorno è vuoto per lui`).toBe(
        expected.length === 0 ? isoOrNull(next[entry.barberId]) : null,
      );
    }
  }
};

describe('slotsByDay – orari dell\'intervallo divisi per giorno e barbiere (SPEC §5.2, §4; fetta 8g)', () => {
  test('coincide giorno per giorno con computeSlotsByBarber / nextSlotByBarber (chiusura, assenza parziale, buffer, ora legale)', () => {
    expectSameAsEngine(springInput(), FROM, TO, PERIOD);
  });

  test('cambio d\'ora legale (28/03): orari sull\'orologio locale; assenza parziale e buffer rispettati', () => {
    const result = slotsByDay(springInput(), FROM, TO);
    const of = (date: string, id: string) => result[date]?.find((e) => e.barberId === id);
    expect(iso(of('2027-03-28', B1)?.slots)).toEqual(iso([at('2027-03-28', '09:00'), at('2027-03-28', '09:15'), at('2027-03-28', '09:30')]));
    expect(of('2027-03-28', B1)?.slots[0]?.toISOString(), '09:00 locali = 07:00Z dopo il cambio').toBe('2027-03-28T07:00:00.000Z');
    // assenza 09:30–10:30: restano 09:00 e 10:30
    expect(iso(of('2027-03-26', B1)?.slots)).toEqual(iso([at('2027-03-26', '09:00'), at('2027-03-26', '10:30')]));
    // occupato fino alle 09:40 (buffer copiato): primo orario 09:45
    expect(iso(of('2027-03-29', B1)?.slots)).toEqual(iso([at('2027-03-29', '09:45'), at('2027-03-29', '10:00')]));
    // giorno di chiusura: presente, senza orari
    expect(result['2027-03-30']?.every((e) => e.slots.length === 0)).toBe(true);
  });

  test('next solo per i barbieri senza orari quel giorno; `to` incluso; null se nulla fino a `to`', () => {
    const result = slotsByDay(springInput(), FROM, TO);
    const of = (date: string, id: string) => result[date]?.find((e) => e.barberId === id);
    // B1 ha orari il 25: niente next anche se ne ha nei giorni dopo
    expect(of('2027-03-25', B1)?.next).toBeNull();
    // B2 pieno il 25: next = 27 alle 15:00
    expect(isoOrNull(of('2027-03-25', B2)?.next)).toBe(at('2027-03-27', '15:00').toISOString());
    // B2 il 28: next = 31 (ultimo giorno, `to` incluso)
    expect(isoOrNull(of('2027-03-28', B2)?.next)).toBe(at('2027-03-31', '09:00').toISOString());
    expect(iso(of('2027-03-31', B2)?.slots)).toEqual([at('2027-03-31', '09:00').toISOString()]);
    // B3 pieno il 25 e senza altre fasce
    expect(of('2027-03-25', B3)?.next).toBeNull();

    // con `to` = 30/03 il 31 non conta
    const shorter = slotsByDay(springInput(), FROM, '2027-03-30');
    expect(Object.keys(shorter)).toEqual(PERIOD.slice(0, 6));
    expect(shorter['2027-03-28']?.find((e) => e.barberId === B2)?.next).toBeNull();
  });

  test('ora solare (31/10/2027): coincide con il motore; un giorno solo; from > to → {}', () => {
    const input: AvailabilityInput = {
      ...springInput(),
      now: at('2027-10-29', '08:00'),
      closures: [],
      barbers: [
        barber(B1, { work: ['2027-10-30', '2027-10-31', '2027-11-01'].map((d) => iv(d, '08:00', '10:00')) }),
        barber(B2, { work: [iv('2027-11-01', '15:00', '16:00')] }),
      ],
    };
    expectSameAsEngine(input, '2027-10-30', '2027-11-01', ['2027-10-30', '2027-10-31', '2027-11-01']);
    expect(slotsByDay(input, '2027-10-31', '2027-10-31')['2027-10-31']?.[0]?.slots[0]?.toISOString()).toBe('2027-10-31T07:00:00.000Z');
    expect(slotsByDay(input, '2027-11-01', '2027-10-31')).toEqual({});
  });

  test('funzione pura: l\'input non cambia', () => {
    const input = springInput();
    const copy = structuredClone(input);
    slotsByDay(input, FROM, TO);
    expect(input).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// captureAnchor / restoreAnchor – SPEC §5.2: "Ridimensionando (rotazione, finestra, testo ingrandito)
// resta la stessa colonna a sinistra e lo stesso giorno"
// ---------------------------------------------------------------------------
const plusDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const DAYS = Array.from({ length: 30 }, (_, i) => plusDays('2027-03-02', i));
/** Telefono in verticale (390 px): larghezza utile 358, 4 colonne da 82 con gap 6. */
const PORTRAIT = { viewport: 358, layout: rowLayout({ days: DAYS, barberCount: 4, columnWidth: 82, gap: 6, dayGap: 20 }) };
/** In orizzontale (sotto i 600 px di altezza): colonne, gap e spazio-giorno diversi, misure non intere. */
const LANDSCAPE = { viewport: 736, layout: rowLayout({ days: DAYS, barberCount: 4, columnWidth: 140.5, gap: 8, dayGap: 28 }) };
const maxOf = (view: { viewport: number; layout: RowLayout }): number => view.layout.width - view.viewport;

const column = (layout: RowLayout, date: string, barberIndex: number) => {
  const found = layout.columns.find((c) => c.date === date && c.barberIndex === barberIndex);
  if (!found) throw new Error(`colonna ${date}/${barberIndex} assente`);
  return found;
};
/** Colonna più a sinistra visibile, calcolata dal test (prima con end > scrollLeft). */
const leftmost = (layout: RowLayout, scrollLeft: number) => {
  const found = layout.columns.find((c) => c.end > scrollLeft) ?? layout.columns.at(-1);
  return found ? { date: found.date, barberIndex: found.barberIndex } : null;
};
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};
const DAY = DAYS[10] ?? '';

describe('captureAnchor / restoreAnchor – stessa colonna a sinistra e stesso giorno dopo il ridimensionamento (fetta 8g)', () => {
  test('colonna al bordo (prima di un giorno e colonna interna): fraction 0, resta al bordo nell\'altra disposizione e al ritorno', () => {
    for (const barberIndex of [0, 2]) {
      const start = column(PORTRAIT.layout, DAY, barberIndex).start;
      const anchor = captureAnchor(PORTRAIT.layout, start);
      expect(anchor).toEqual({ day: DAY, barberIndex, fraction: 0 });
      const wide = restoreAnchor(LANDSCAPE.layout, anchor, maxOf(LANDSCAPE));
      expect(wide).toBeCloseTo(column(LANDSCAPE.layout, DAY, barberIndex).start, 1);
      expect(restoreAnchor(PORTRAIT.layout, captureAnchor(LANDSCAPE.layout, wide), maxOf(PORTRAIT))).toBeCloseTo(start, 1);
    }
    expect(restoreAnchor(LANDSCAPE.layout, captureAnchor(PORTRAIT.layout, firstColumnOffset(PORTRAIT.layout, DAY)), maxOf(LANDSCAPE))).toBeCloseTo(
      firstColumnOffset(LANDSCAPE.layout, DAY),
      1,
    );
  });

  test('a metà dell\'ultima colonna di un giorno: stessa colonna alla stessa frazione, stesso giorno (82 ↔ 140,5)', () => {
    const last = column(PORTRAIT.layout, DAY, 3);
    const anchor = captureAnchor(PORTRAIT.layout, last.start + 41);
    expect(anchor.day).toBe(DAY);
    expect(anchor.barberIndex).toBe(3);
    expect(anchor.fraction).toBeCloseTo(0.5, 6);
    const wide = restoreAnchor(LANDSCAPE.layout, anchor, maxOf(LANDSCAPE));
    const target = column(LANDSCAPE.layout, DAY, 3);
    expect(wide).toBeCloseTo(target.start + 0.5 * (target.end - target.start), 1);
    expect(leftmost(LANDSCAPE.layout, wide)).toEqual({ date: DAY, barberIndex: 3 });
    expect(dayAtScroll(LANDSCAPE.layout, wide)).toBe(DAY);
  });

  test('andata e ritorno idempotenti per posizioni dentro le colonne; nello stesso layout restoreAnchor(captureAnchor(x)) = x', () => {
    const positions = PORTRAIT.layout.columns
      .filter((c) => c.date >= (DAYS[3] ?? '') && c.date <= (DAYS[20] ?? ''))
      .flatMap((c) => [c.start, c.start + 0.3 * (c.end - c.start), c.start + 0.97 * (c.end - c.start)]);
    for (const x of positions) {
      const anchor = captureAnchor(PORTRAIT.layout, x);
      expect(restoreAnchor(PORTRAIT.layout, anchor, maxOf(PORTRAIT)), `stesso layout, x = ${x}`).toBeCloseTo(x, 1);
      const wide = restoreAnchor(LANDSCAPE.layout, anchor, maxOf(LANDSCAPE));
      const again = captureAnchor(LANDSCAPE.layout, wide);
      expect(again.day).toBe(anchor.day);
      expect(again.barberIndex).toBe(anchor.barberIndex);
      expect(again.fraction).toBeCloseTo(anchor.fraction, 4);
      expect(restoreAnchor(PORTRAIT.layout, again, maxOf(PORTRAIT)), `andata e ritorno, x = ${x}`).toBeCloseTo(x, 1);
    }
  });

  test('il giorno dell\'ancora è quello di dayAtScroll per ogni posizione (margine di 16 px escluso)', () => {
    for (let x = 0; x < maxOf(PORTRAIT); x += 7.3) {
      expect(captureAnchor(PORTRAIT.layout, x).day, `x = ${x}`).toBe(dayAtScroll(PORTRAIT.layout, x));
    }
  });

  test('bordo nello spazio-giorno: ancora sulla prima colonna del giorno dopo (fraction ≤ 0); nel nuovo layout resta nello spazio, giorno dopo', () => {
    const lastOfDay = column(PORTRAIT.layout, DAY, 3);
    const nextDay = DAYS[11] ?? '';
    const anchor = captureAnchor(PORTRAIT.layout, lastOfDay.end + 10);
    expect(anchor.day).toBe(nextDay);
    expect(anchor.barberIndex).toBe(0);
    expect(anchor.fraction).toBeLessThanOrEqual(0);
    for (const view of [LANDSCAPE, PORTRAIT]) {
      const restored = restoreAnchor(view.layout, anchor, maxOf(view));
      expect(restored, "l'ultima colonna del giorno prima non rientra").toBeGreaterThan(column(view.layout, DAY, 3).end);
      expect(restored, 'la prima colonna del giorno dopo non è uscita').toBeLessThanOrEqual(column(view.layout, nextDay, 0).start + 1e-6);
      expect(dayAtScroll(view.layout, restored)).toBe(nextDay);
    }
  });

  test('bordo nel gap fra due colonne dello stesso giorno: resta la colonna dopo, fraction ≤ 0', () => {
    const first = column(PORTRAIT.layout, DAY, 1);
    const anchor = captureAnchor(PORTRAIT.layout, first.end + 3);
    expect({ day: anchor.day, barberIndex: anchor.barberIndex }).toEqual({ day: DAY, barberIndex: 2 });
    expect(anchor.fraction).toBeLessThanOrEqual(0);
    const restored = restoreAnchor(LANDSCAPE.layout, anchor, maxOf(LANDSCAPE));
    expect(restored).toBeGreaterThan(column(LANDSCAPE.layout, DAY, 1).end);
    expect(restored).toBeLessThanOrEqual(column(LANDSCAPE.layout, DAY, 2).start + 1e-6);
  });

  test('inizio fila: scrollLeft 0 (o negativo, rimbalzo di iOS) → prima colonna al bordo → 0', () => {
    expect(captureAnchor(PORTRAIT.layout, 0)).toEqual({ day: DAYS[0], barberIndex: 0, fraction: 0 });
    expect(restoreAnchor(LANDSCAPE.layout, captureAnchor(PORTRAIT.layout, 0), maxOf(LANDSCAPE))).toBeCloseTo(0, 6);
    expect(restoreAnchor(LANDSCAPE.layout, captureAnchor(PORTRAIT.layout, -12), maxOf(LANDSCAPE))).toBeCloseTo(0, 6);
  });

  test('fine fila: ultima colonna della fila → limitato a maxScrollLeft del nuovo layout, mai oltre', () => {
    const lastDay = DAYS.at(-1) ?? '';
    const last = column(PORTRAIT.layout, lastDay, 3);
    const anchor = captureAnchor(PORTRAIT.layout, last.start + 41);
    expect({ day: anchor.day, barberIndex: anchor.barberIndex }).toEqual({ day: lastDay, barberIndex: 3 });
    expect(restoreAnchor(LANDSCAPE.layout, anchor, maxOf(LANDSCAPE))).toBeCloseTo(maxOf(LANDSCAPE), 6);
    // in fondo alla fila (scrollLeft = massimo) e ritorno: mai oltre il massimo
    const atEnd = captureAnchor(PORTRAIT.layout, maxOf(PORTRAIT));
    expect(restoreAnchor(LANDSCAPE.layout, atEnd, maxOf(LANDSCAPE))).toBeLessThanOrEqual(maxOf(LANDSCAPE) + 1e-6);
    expect(restoreAnchor(PORTRAIT.layout, atEnd, maxOf(PORTRAIT))).toBeCloseTo(maxOf(PORTRAIT), 1);
  });

  test('funzioni pure: layout congelati, stesso risultato a ogni chiamata', () => {
    const narrow = deepFreeze(rowLayout({ days: DAYS, barberCount: 4, columnWidth: 82, gap: 6, dayGap: 20 }));
    const wide = deepFreeze(rowLayout({ days: DAYS, barberCount: 4, columnWidth: 140.5, gap: 8, dayGap: 28 }));
    const x = column(narrow, DAY, 2).start + 20;
    const anchor = captureAnchor(narrow, x);
    expect(captureAnchor(narrow, x)).toEqual(anchor);
    const frozen = deepFreeze({ ...anchor });
    expect(restoreAnchor(wide, frozen, wide.width - 736)).toBe(restoreAnchor(wide, frozen, wide.width - 736));
  });
});

// ---------------------------------------------------------------------------
// dayCacheReducer – azione 'loadedMany' (fetta 8g: orari di tutti i giorni insieme, ricarica in background)
// ---------------------------------------------------------------------------
const C1 = 'b8a00000-0000-4000-8000-0000000000c1';
const dayOf = (date: string, slot: string): WhenDay => ({ date, barbers: [{ barberId: C1, slots: [slot], next: null }] });
const [DA, DB, DC, DD, DE] = ['2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06'] as const;

describe('dayCacheReducer – loadedMany: più giorni insieme senza perdere né sovrascrivere a sproposito (fetta 8g)', () => {
  test('cache vuota: tutti i giorni della risposta diventano caricati', () => {
    const a = dayOf(DA, `${DA}T08:00:00.000Z`);
    const b = dayOf(DB, `${DB}T08:00:00.000Z`);
    const cache = dayCacheReducer({}, { type: 'loadedMany', requestId: 1, days: [a, b] });
    expect(cache).toEqual({ [DA]: { status: 'loaded', day: a }, [DB]: { status: 'loaded', day: b } });
  });

  test('ricarica: caricati ed errori si aggiornano, una richiesta singola più recente in corso vince, una più vecchia no; gli altri giorni restano', () => {
    const oldA = dayOf(DA, `${DA}T08:00:00.000Z`);
    const keptE = dayOf(DE, `${DE}T08:00:00.000Z`);
    const start: DayCache = {
      [DA]: { status: 'loaded', day: oldA },
      [DB]: { status: 'loading', requestId: 7 }, // singola partita dopo la ricarica (id 5)
      [DC]: { status: 'error', requestId: 3 },
      [DD]: { status: 'loading', requestId: 2 }, // singola partita prima della ricarica
      [DE]: { status: 'loaded', day: keptE }, // non nella risposta
    };
    const copy = structuredClone(start);
    const fresh = {
      a: dayOf(DA, `${DA}T09:00:00.000Z`),
      b: dayOf(DB, `${DB}T09:00:00.000Z`),
      c: dayOf(DC, `${DC}T09:00:00.000Z`),
      d: dayOf(DD, `${DD}T09:00:00.000Z`),
    };
    let cache = dayCacheReducer(start, { type: 'loadedMany', requestId: 5, days: [fresh.a, fresh.b, fresh.c, fresh.d] });

    expect(cache[DA], 'caricato: aggiornato').toEqual({ status: 'loaded', day: fresh.a });
    expect(cache[DB], 'singola più recente in corso: resta in caricamento').toEqual({ status: 'loading', requestId: 7 });
    expect(cache[DC], 'errore: sostituito dai dati').toEqual({ status: 'loaded', day: fresh.c });
    expect(cache[DD], 'singola più vecchia in corso: vince la ricarica').toEqual({ status: 'loaded', day: fresh.d });
    expect(cache[DE], 'giorno non nella risposta: resta').toEqual({ status: 'loaded', day: keptE });
    expect(start, 'stato precedente non modificato (funzione pura)').toEqual(copy);

    // Arriva la risposta vecchia di DD (id 2): si ignora; arriva quella di DB (id 7): vale
    const late = dayOf(DD, `${DD}T10:00:00.000Z`);
    cache = dayCacheReducer(cache, { type: 'loaded', date: DD, requestId: 2, day: late });
    expect(cache[DD]).toEqual({ status: 'loaded', day: fresh.d });
    const single = dayOf(DB, `${DB}T10:00:00.000Z`);
    cache = dayCacheReducer(cache, { type: 'loaded', date: DB, requestId: 7, day: single });
    expect(cache[DB]).toEqual({ status: 'loaded', day: single });
  });

  test('risposta vuota: nessun giorno sparisce', () => {
    const start: DayCache = { [DA]: { status: 'loaded', day: dayOf(DA, `${DA}T08:00:00.000Z`) } };
    expect(dayCacheReducer(start, { type: 'loadedMany', requestId: 9, days: [] })).toEqual(start);
  });
});

// ---------------------------------------------------------------------------
// Testi e rimozioni – SPEC §9, decisione 1 della fetta 8g (via "Primo libero")
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const textAt = async (path: string): Promise<unknown> => {
  const { it: texts } = (await import('@/i18n/it')) as unknown as { it: Record<string, unknown> };
  let node: unknown = texts;
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  return node;
};

describe('annuncio del giorno e "Primo libero" tolto (fetta 8g)', () => {
  test('it.booking.when.dayAnnounceEmpty = "{day}, nessun orario libero"; dayAnnounce resta "Orari di {day}"', async () => {
    expect(await textAt('booking.when.dayAnnounceEmpty')).toBe('{day}, nessun orario libero');
    expect(await textAt('booking.when.dayAnnounce')).toBe('Orari di {day}');
  });

  test('tolti i testi it.booking.when.firstFree e it.booking.when.noSlots', async () => {
    expect(await textAt('booking.when.firstFree')).toBeUndefined();
    expect(await textAt('booking.when.noSlots')).toBeUndefined();
  });

  test('tolti firstFree dal motore, firstFreeAmong da when.ts e la coda when-queue.ts', async () => {
    const engine = (await import('@/lib/availability')) as Record<string, unknown>;
    expect(engine.firstFree, 'firstFree non più esportato da @/lib/availability').toBeUndefined();
    const when = (await import('@/lib/booking/when')) as Record<string, unknown>;
    expect(when.firstFreeAmong, 'firstFreeAmong non più esportato da when.ts').toBeUndefined();
    expect(existsSync(resolve(ROOT, 'src/lib/booking/when-queue.ts')), 'src/lib/booking/when-queue.ts rimosso').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Proxy – CLAUDE.md Sicurezza: il route handler degli orari passa dal proxy (rinnovo della sessione,
// regole di accesso), cioè il matcher non lo esclude (es. per estensione).
// ---------------------------------------------------------------------------
describe('matcher del proxy – /prenota/quando/orari non è escluso (fetta 8g)', () => {
  test('il pattern reale di config.matcher copre /prenota/quando/orari (e non gli asset statici)', async () => {
    const { config } = (await import('@/proxy')) as { config: { matcher: string | string[] } };
    const patterns = (Array.isArray(config.matcher) ? config.matcher : [config.matcher]).map((m) => new RegExp(`^${m}$`));
    const matches = (path: string): boolean => patterns.some((p) => p.test(path));
    // controlli del confronto stesso
    expect(matches('/prenota/quando'), 'controllo: la pagina passa dal proxy').toBe(true);
    expect(matches('/_next/static/chunks/app.js'), 'controllo: gli asset di Next sono esclusi').toBe(false);
    expect(matches('/manifest.json'), 'controllo: i .json statici sono esclusi').toBe(false);
    expect(matches('/prenota/quando/orari'), '/prenota/quando/orari passa dal proxy').toBe(true);
  });
});
