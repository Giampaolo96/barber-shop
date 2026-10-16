// Correzioni e rifiniture dalla review della fetta 8e (decisioni approvate in docs/PROGRESS.md,
// "Fetta 8e"): giorno iniziale senza giorni con posti, risposte arrivate in ritardo, "Primo libero"
// limitato ai barbieri della pagina.
import { describe, expect, test } from 'vitest';

import type { DayStatus } from '@/lib/availability';
import type { WhenDay } from '@/lib/booking/availability';
import { firstFreeAmong, initialDay } from '@/lib/booking/when';
import { isWhenLoading, whenReducer, type WhenView } from '@/lib/booking/when-state';

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
// Risposte in ritardo: la pagina mostra l'ultimo giorno scelto, mai uno scheletro "orfano"
// ---------------------------------------------------------------------------
const B1 = 'b8e00000-0000-4000-8000-000000000001';
const dayOf = (date: string, slot: string): WhenDay => ({
  date,
  firstFree: { barberId: B1, startsAt: slot },
  barbers: [{ barberId: B1, slots: [slot], next: null }],
});
const DAY0 = dayOf('2027-03-01', '2027-03-01T09:00:00.000Z');
const DAY_A = dayOf('2027-03-02', '2027-03-02T09:00:00.000Z');
const DAY_B = dayOf('2027-03-03', '2027-03-03T09:00:00.000Z');
const start: WhenView = { selected: DAY0.date, shown: DAY0, error: false };

describe('whenReducer – risposte arrivate in ritardo (review 8e)', () => {
  test('A non in memoria, poi B in memoria: si vede B; la risposta di A arrivata dopo si ignora', () => {
    let view = whenReducer(start, { type: 'select', date: DAY_A.date });
    expect(isWhenLoading(view), 'A in caricamento').toBe(true);
    expect(view.shown).toBe(DAY0);

    view = whenReducer(view, { type: 'select', date: DAY_B.date, cached: DAY_B });
    expect(view.shown).toBe(DAY_B);
    expect(isWhenLoading(view)).toBe(false);

    view = whenReducer(view, { type: 'loaded', date: DAY_A.date, day: DAY_A });
    expect(view.selected).toBe(DAY_B.date);
    expect(view.shown).toBe(DAY_B);
    expect(isWhenLoading(view), 'nessuno scheletro dopo la risposta in ritardo').toBe(false);
    expect(view.error).toBe(false);
  });

  test('A e B non in memoria, le risposte arrivano in ordine inverso: alla fine si vede B', () => {
    let view = whenReducer(start, { type: 'select', date: DAY_A.date });
    view = whenReducer(view, { type: 'select', date: DAY_B.date });
    view = whenReducer(view, { type: 'loaded', date: DAY_B.date, day: DAY_B });
    expect(view.shown).toBe(DAY_B);
    expect(isWhenLoading(view)).toBe(false);
    view = whenReducer(view, { type: 'loaded', date: DAY_A.date, day: DAY_A });
    expect(view.shown).toBe(DAY_B);
    expect(isWhenLoading(view)).toBe(false);
  });

  test('un errore arrivato in ritardo per A non tocca B', () => {
    let view = whenReducer(start, { type: 'select', date: DAY_A.date });
    view = whenReducer(view, { type: 'select', date: DAY_B.date, cached: DAY_B });
    view = whenReducer(view, { type: 'loaded', date: DAY_A.date, day: null });
    expect(view).toEqual({ selected: DAY_B.date, shown: DAY_B, error: false });
  });

  test('errore del giorno selezionato: niente scheletro, errore visibile; una nuova scelta lo azzera', () => {
    let view = whenReducer(start, { type: 'select', date: DAY_A.date });
    view = whenReducer(view, { type: 'loaded', date: DAY_A.date, day: null });
    expect(view.error).toBe(true);
    expect(isWhenLoading(view)).toBe(false);
    view = whenReducer(view, { type: 'select', date: DAY0.date, cached: DAY0 });
    expect(view).toEqual(start);
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
