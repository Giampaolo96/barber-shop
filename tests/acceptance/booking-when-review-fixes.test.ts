// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25)
// Correzioni e rifiniture dalla review della fetta 8e (decisioni approvate in docs/PROGRESS.md,
// "Fetta 8e"): giorno iniziale senza giorni con posti, risposte arrivate in ritardo, "Primo libero"
// limitato ai barbieri della pagina.
import { describe, expect, test } from 'vitest';

import type { DayStatus } from '@/lib/availability';
import type { WhenDay } from '@/lib/booking/availability';
import { firstFreeAmong, initialDay } from '@/lib/booking/when';
import { dayCacheReducer, type DayCache } from '@/lib/booking/when-state';

describe('initialDay – nessun giorno con posti nel periodo → stato vuoto', () => {
  const none: DayStatus[] = [
    { date: '2027-03-01', status: 'full' },
    { date: '2027-03-02', status: 'closed' },
    { date: '2027-03-03', status: 'full' },
  ];

  test('anche con un giorno richiesto "senza posti" il risultato è null', () => {
    expect(initialDay(none, '2027-03-01')).toBeNull();
    expect(initialDay(none, '2027-03-03')).toBeNull();
  });

  test('con almeno un giorno con posti il giorno richiesto "senza posti" resta valido', () => {
    expect(initialDay([...none, { date: '2027-03-04', status: 'open' }], '2027-03-03')).toBe('2027-03-03');
  });
});

// ---------------------------------------------------------------------------
// Risposte in ritardo (fetta 8f: cache per giorno con identificativo per richiesta). Ogni giorno della
// fila ha il suo stato (loading / loaded / error): la risposta di un giorno non tocca gli altri e una
// risposta vecchia dello stesso giorno non sovrascrive una più recente.
// Interfaccia attesa in src/lib/booking/when-state.ts:
//   dayCacheReducer(state: DayCache, action: DayCacheAction): DayCache, funzione pura (non muta `state`)
//   DayCache = Record<string, DayEntry>  (chiave: data YYYY-MM-DD)
//   DayEntry = { status: 'loading'; requestId } | { status: 'loaded'; day: WhenDay } | { status: 'error'; requestId }
//   DayCacheAction = { type: 'request'; date; requestId } | { type: 'loaded'; date; requestId; day }
//                  | { type: 'failed'; date; requestId }
// ---------------------------------------------------------------------------
const B1 = 'b8e00000-0000-4000-8000-000000000001';
const dayOf = (date: string, slot: string): WhenDay => ({
  date,
  firstFree: { barberId: B1, startsAt: slot },
  barbers: [{ barberId: B1, slots: [slot], next: null }],
});
const DAY0 = dayOf('2027-03-01', '2027-03-01T09:00:00.000Z');
const DAY_A = dayOf('2027-03-02', '2027-03-02T09:00:00.000Z');
const DAY_A_NEWER = dayOf('2027-03-02', '2027-03-02T10:00:00.000Z');
const DAY_B = dayOf('2027-03-03', '2027-03-03T09:00:00.000Z');
/** Giorno iniziale già disegnato dal server. */
const start: DayCache = { [DAY0.date]: { status: 'loaded', day: DAY0 } };

describe('dayCacheReducer – cache per giorno con id di richiesta (review 8e, adattato in fetta 8f)', () => {
  test('(a) la risposta di un giorno non tocca gli altri giorni', () => {
    let cache = dayCacheReducer(start, { type: 'request', date: DAY_A.date, requestId: 1 });
    cache = dayCacheReducer(cache, { type: 'request', date: DAY_B.date, requestId: 2 });
    expect(cache[DAY_A.date]?.status).toBe('loading');
    expect(cache[DAY_B.date]?.status).toBe('loading');

    const before = cache;
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_A.date, requestId: 1, day: DAY_A });
    expect(cache[DAY_A.date]).toMatchObject({ status: 'loaded', day: DAY_A });
    expect(cache[DAY_B.date]?.status, 'B resta in caricamento').toBe('loading');
    expect(cache[DAY0.date], "il giorno iniziale resta com'era").toEqual({ status: 'loaded', day: DAY0 });
    expect(before[DAY_A.date]?.status, 'stato precedente non modificato (funzione pura)').toBe('loading');
  });

  test('(b) una risposta vecchia dello stesso giorno non sovrascrive una più recente', () => {
    let cache = dayCacheReducer(start, { type: 'request', date: DAY_A.date, requestId: 1 });
    cache = dayCacheReducer(cache, { type: 'request', date: DAY_A.date, requestId: 2 });
    // La risposta della richiesta 1 arriva mentre la 2 è in corso: si ignora
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_A.date, requestId: 1, day: DAY_A });
    expect(cache[DAY_A.date]?.status).toBe('loading');
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_A.date, requestId: 2, day: DAY_A_NEWER });
    expect(cache[DAY_A.date]).toMatchObject({ status: 'loaded', day: DAY_A_NEWER });
    // Risposte (o errori) della richiesta 1 arrivati dopo la 2: si ignorano
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_A.date, requestId: 1, day: DAY_A });
    cache = dayCacheReducer(cache, { type: 'failed', date: DAY_A.date, requestId: 1 });
    expect(cache[DAY_A.date]).toMatchObject({ status: 'loaded', day: DAY_A_NEWER });
  });

  test('(c) un errore resta solo su quel giorno', () => {
    let cache = dayCacheReducer(start, { type: 'request', date: DAY_A.date, requestId: 1 });
    cache = dayCacheReducer(cache, { type: 'request', date: DAY_B.date, requestId: 2 });
    cache = dayCacheReducer(cache, { type: 'failed', date: DAY_A.date, requestId: 1 });
    expect(cache[DAY_A.date]?.status).toBe('error');
    expect(cache[DAY_B.date]?.status).toBe('loading');
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_B.date, requestId: 2, day: DAY_B });
    expect(cache[DAY_B.date]).toMatchObject({ status: 'loaded', day: DAY_B });
    expect(cache[DAY_A.date]?.status, 'A resta in errore').toBe('error');
    expect(cache[DAY0.date]).toEqual({ status: 'loaded', day: DAY0 });
  });

  test('(d) il nuovo tentativo dopo un errore funziona', () => {
    let cache = dayCacheReducer(start, { type: 'request', date: DAY_A.date, requestId: 1 });
    cache = dayCacheReducer(cache, { type: 'failed', date: DAY_A.date, requestId: 1 });
    expect(cache[DAY_A.date]?.status).toBe('error');
    cache = dayCacheReducer(cache, { type: 'request', date: DAY_A.date, requestId: 2 });
    expect(cache[DAY_A.date]?.status, 'nuovo tentativo in caricamento').toBe('loading');
    cache = dayCacheReducer(cache, { type: 'loaded', date: DAY_A.date, requestId: 2, day: DAY_A });
    expect(cache[DAY_A.date]).toMatchObject({ status: 'loaded', day: DAY_A });
  });
});

// ---------------------------------------------------------------------------
// "Primo libero" fra i barbieri della pagina
// ---------------------------------------------------------------------------
describe('firstFreeAmong – il "Primo libero" usa solo i barbieri mostrati', () => {
  const B2 = 'b8e00000-0000-4000-8000-000000000002';
  const B3 = 'b8e00000-0000-4000-8000-000000000003';
  const day = {
    firstFree: { barberId: B3, startsAt: '2027-03-02T08:00:00.000Z' },
    barbers: [
      { barberId: B1, slots: ['2027-03-02T09:00:00.000Z'] },
      { barberId: B2, slots: ['2027-03-02T08:30:00.000Z', '2027-03-02T09:00:00.000Z'] },
      { barberId: B3, slots: ['2027-03-02T08:00:00.000Z'] },
    ],
  };

  test('barbiere scelto dal server fra quelli della pagina → quello', () => {
    expect(firstFreeAmong(day, [B1, B2, B3])).toEqual(day.firstFree);
  });

  test('barbiere scelto dal server assente dalla pagina → primo orario fra quelli mostrati', () => {
    expect(firstFreeAmong(day, [B1, B2])).toEqual({ barberId: B2, startsAt: '2027-03-02T08:30:00.000Z' });
  });

  test('parità fra i barbieri mostrati → il primo nell\'ordine della pagina', () => {
    const same = '2027-03-02T09:00:00.000Z';
    const tie = { firstFree: null, barbers: [{ barberId: B1, slots: [same] }, { barberId: B2, slots: [same] }] };
    expect(firstFreeAmong(tie, [B2, B1])).toEqual({ barberId: B2, startsAt: same });
  });

  test('nessun orario fra i barbieri mostrati → null', () => {
    expect(firstFreeAmong({ firstFree: null, barbers: [] }, [B1])).toBeNull();
  });
});
