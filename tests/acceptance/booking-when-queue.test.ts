// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25): nuovo tentativo dopo un errore attraverso la coda.
// Test di accettazione – FETTA 8f (approvati dall'utente il 2026-10-25): coda delle richieste dei
// giorni di "Quando?" (SPEC §5.2: una richiesta per giorno; fetta 8f: cache per giorno, richieste
// senza doppioni, al massimo 3 contemporanee). Logica pura, senza I/O (CLAUDE.md regola 5).
//
// Interfaccia attesa in src/lib/booking/when-queue.ts:
//   nextRequests(input: {
//     wanted: string[];    // giorni da avere (finestra disegnata), in ordine di priorità: prima il
//                          // selezionato e i visibili, poi i vicini
//     inFlight: string[];  // giorni con una richiesta già partita e non ancora finita
//     cached: string[];    // giorni già in memoria
//     limit: number;       // richieste contemporanee ammesse (3 nella pagina)
//   }): string[]           // giorni da far partire ora, nell'ordine di `wanted`
// La coda è `wanted` stesso: un giorno uscito dalla finestra prima di partire non parte più.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

import { nextRequests } from '@/lib/booking/when-queue';
import { dayCacheReducer, type DayCache, type DayEntry } from '@/lib/booking/when-state';

const D = ['2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-09', '2027-03-10', '2027-03-11'];
const [d0 = '', d1 = '', d2 = '', d3 = '', d4 = '', d5 = '', d6 = '', d7 = ''] = D;
const LIMIT = 3;

describe('nextRequests – al massimo 3 richieste contemporanee (fetta 8f)', () => {
  test('5 giorni desiderati e nessuna in corso → ne partono 3', () => {
    expect(nextRequests({ wanted: [d0, d1, d2, d3, d4], inFlight: [], cached: [], limit: LIMIT })).toEqual([d0, d1, d2]);
  });

  test('2 in corso → ne parte 1', () => {
    expect(nextRequests({ wanted: [d0, d1, d2, d3, d4], inFlight: [d0, d1], cached: [], limit: LIMIT })).toEqual([d2]);
  });

  test('2 in corso per giorni non più nella finestra: contano lo stesso → ne parte 1', () => {
    expect(nextRequests({ wanted: [d5, d6, d7], inFlight: [d0, d1], cached: [], limit: LIMIT })).toEqual([d5]);
  });

  test('3 (o più) in corso → nessuna', () => {
    expect(nextRequests({ wanted: [d0, d1, d2, d3, d4], inFlight: [d0, d1, d2], cached: [], limit: LIMIT })).toEqual([]);
    expect(nextRequests({ wanted: [d5], inFlight: [d0, d1, d2, d3], cached: [], limit: LIMIT })).toEqual([]);
  });
});

describe('nextRequests – nessun doppione (fetta 8f)', () => {
  test('un giorno con una richiesta già in corso non parte due volte', () => {
    const started = nextRequests({ wanted: [d0, d1, d2], inFlight: [d1], cached: [], limit: LIMIT });
    expect(started).not.toContain(d1);
    expect(started).toEqual([d0, d2]);
  });

  test('un giorno già in memoria non parte', () => {
    expect(nextRequests({ wanted: [d0, d1, d2, d3], inFlight: [], cached: [d0, d2], limit: LIMIT })).toEqual([d1, d3]);
  });

  test('tutto in memoria → nessuna richiesta', () => {
    expect(nextRequests({ wanted: [d0, d1], inFlight: [], cached: [d0, d1], limit: LIMIT })).toEqual([]);
  });

  test('il risultato non contiene doppioni anche se `wanted` ne ha', () => {
    expect(nextRequests({ wanted: [d0, d0, d1], inFlight: [], cached: [], limit: LIMIT })).toEqual([d0, d1]);
  });
});

describe('nextRequests – un giorno uscito dalla finestra prima di partire viene scartato (fetta 8f)', () => {
  test('in coda con la finestra vecchia, la finestra cambia: non parte più', () => {
    // Finestra vecchia: partono d0, d1, d2; d3 e d4 restano in coda
    const first = nextRequests({ wanted: [d0, d1, d2, d3, d4], inFlight: [], cached: [], limit: LIMIT });
    expect(first).toEqual([d0, d1, d2]);
    // Scorrimento lontano: la finestra ora è d5–d7; d0 finisce (in memoria), d1 e d2 sono ancora in corso
    const second = nextRequests({ wanted: [d5, d6, d7], inFlight: [d1, d2], cached: [d0], limit: LIMIT });
    expect(second, 'parte solo un giorno della finestra nuova').toEqual([d5]);
    expect(second).not.toContain(d3);
    expect(second).not.toContain(d4);
    // Finite anche d1 e d2: partono gli altri della finestra nuova, mai d3 e d4
    const third = nextRequests({ wanted: [d5, d6, d7], inFlight: [d5], cached: [d0, d1, d2], limit: LIMIT });
    expect(third).toEqual([d6, d7]);
  });
});

describe('nextRequests – priorità nell\'ordine dato (fetta 8f)', () => {
  test('partono nell\'ordine di `wanted` (prima il selezionato e i visibili), non in ordine di data', () => {
    expect(nextRequests({ wanted: [d3, d4, d2, d5, d1], inFlight: [], cached: [], limit: LIMIT })).toEqual([d3, d4, d2]);
  });

  test('saltati quelli in corso o in memoria, l\'ordine resta quello dato', () => {
    expect(nextRequests({ wanted: [d3, d4, d2, d5, d1], inFlight: [d4], cached: [d2], limit: LIMIT })).toEqual([d3, d5]);
  });

  test('funzione pura: non modifica gli elenchi ricevuti', () => {
    const input = { wanted: [d0, d1, d2, d3], inFlight: [d1], cached: [d2], limit: LIMIT };
    const copy = structuredClone(input);
    nextRequests(input);
    expect(input).toEqual(copy);
  });
});

// Nuovo tentativo dopo un errore (review fetta 8f): l'azione "retry" della cache toglie la voce in
// errore e il giorno riparte dalla coda, con lo stesso limite di 3 richieste contemporanee.
describe('nuovo tentativo dopo un errore – passa dalla coda (fetta 8f)', () => {
  const inputOf = (cache: DayCache, wanted: string[]) => {
    const entries = Object.entries(cache) as Array<[string, DayEntry]>;
    return {
      wanted,
      inFlight: entries.filter(([, e]) => e.status === 'loading').map(([d]) => d),
      cached: entries.filter(([, e]) => e.status !== 'loading').map(([d]) => d),
      limit: LIMIT,
    };
  };

  test("un giorno in errore non riparte da solo; dopo \"retry\" riparte solo se c'è posto nella coda", () => {
    let cache = dayCacheReducer({}, { type: 'request', date: d0, requestId: 1 });
    cache = dayCacheReducer(cache, { type: 'failed', date: d0, requestId: 1 });
    expect(nextRequests(inputOf(cache, [d0])), 'in errore: niente richieste automatiche').toEqual([]);

    // Tre richieste in corso: il nuovo tentativo aspetta
    for (const [i, date] of [d1, d2, d3].entries()) cache = dayCacheReducer(cache, { type: 'request', date, requestId: 2 + i });
    cache = dayCacheReducer(cache, { type: 'retry', date: d0 });
    expect(cache[d0], 'la voce in errore sparisce').toBeUndefined();
    expect(nextRequests(inputOf(cache, [d0, d1, d2, d3])), 'tre in corso: il nuovo tentativo aspetta').toEqual([]);

    // Una richiesta finisce: il nuovo tentativo parte
    cache = dayCacheReducer(cache, { type: 'failed', date: d1, requestId: 2 });
    expect(nextRequests(inputOf(cache, [d0, d1, d2, d3]))).toEqual([d0]);
  });

  test('"retry" su un giorno non in errore non cambia nulla', () => {
    const cache = dayCacheReducer({}, { type: 'request', date: d0, requestId: 1 });
    expect(dayCacheReducer(cache, { type: 'retry', date: d0 })).toBe(cache);
    expect(dayCacheReducer(cache, { type: 'retry', date: d4 })).toBe(cache);
  });
});
