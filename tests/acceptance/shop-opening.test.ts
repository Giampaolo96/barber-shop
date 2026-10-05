// Test di accettazione – FETTA 8a (identità visiva, tema "Mosca"): stato di apertura del negozio
// mostrato in home. SPEC §3.4 (fasce in ora locale, giorno ISO 1 = lunedì … 7 = domenica come in
// working_hours.weekday), §3.5 (chiusure del negozio), §4.1 (fasce convertite in istanti reali,
// attenzione ai cambi d'ora), §5.1 (home: info negozio), §9 (orari mostrati in Europe/Rome),
// §12 (giorno del passaggio all'ora legale e a quella solare) + decisione approvata 5 della fetta 8a.
//
// Interfaccia attesa: src/lib/shop/opening.ts, funzione pura (nessun I/O, `now` in input)
//   openingStatus(input: {
//     now: Date; timezone: string;
//     hours: Array<{ weekday: number; start: string /* HH:MM */; end: string /* HH:MM */ }>;
//     closures: Array<{ startsAt: Date; endsAt: Date }>;
//   }): { state: 'open'; until: Date } | { state: 'opens_later'; at: Date } | { state: 'closed_today' }
// Regole: fasce di OGGI (giorno locale nella timezone) convertite in istanti, meno le chiusure;
// `now` dentro un intervallo → open fino alla fine dell'intervallo; altrimenti il primo intervallo
// successivo di oggi → opens_later; altrimenti closed_today. Intervalli [inizio, fine): all'istante
// di apertura è open, all'istante di chiusura non più.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { fromZonedTime } from 'date-fns-tz';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

type Hours = { weekday: number; start: string; end: string };
type Closure = { startsAt: Date; endsAt: Date };
type OpeningStatus = { state: 'open'; until: Date } | { state: 'opens_later'; at: Date } | { state: 'closed_today' };
type OpeningModule = {
  openingStatus: (input: { now: Date; timezone: string; hours: Hours[]; closures: Closure[] }) => OpeningStatus;
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

let mod: OpeningModule;
let loadError: unknown = null;
beforeAll(async () => {
  try {
    mod = await load<OpeningModule>('@/lib/shop/opening');
  } catch (error) {
    loadError = error;
  }
});
// Modulo mancante: ogni test fallisce (non viene saltato)
beforeEach(() => {
  if (loadError) throw loadError;
});

const TZ = 'Europe/Rome';
/** Istante di un'ora locale del negozio (solo orari non ambigui). */
const at = (date: string, time: string): Date => fromZonedTime(`${date}T${time}:00`, TZ);
const utc = (iso: string): Date => new Date(iso);

const WED = '2027-03-03'; // mercoledì (weekday 3), ora solare
const THU = '2027-03-04'; // giovedì (weekday 4)

// Mercoledì con pausa pranzo; il giovedì fasce diverse, che non devono influire sul mercoledì.
const WEEK: Hours[] = [
  { weekday: 3, start: '09:00', end: '13:00' },
  { weekday: 3, start: '15:00', end: '19:30' },
  { weekday: 4, start: '08:00', end: '20:00' },
];

const status = (now: Date, hours: Hours[] = WEEK, closures: Closure[] = []): OpeningStatus =>
  mod.openingStatus({ now, timezone: TZ, hours, closures });

describe('openingStatus – giornata con pausa pranzo (SPEC §3.4, decisione 5)', () => {
  test('prima dell\'apertura: opens_later all\'inizio della prima fascia', () => {
    expect(status(at(WED, '08:00'))).toEqual({ state: 'opens_later', at: at(WED, '09:00') });
  });

  test('dentro la mattina: open fino alla fine della fascia', () => {
    expect(status(at(WED, '10:00'))).toEqual({ state: 'open', until: at(WED, '13:00') });
  });

  test('nella pausa pranzo: opens_later alla riapertura', () => {
    expect(status(at(WED, '14:00'))).toEqual({ state: 'opens_later', at: at(WED, '15:00') });
  });

  test('dopo la chiusura serale: closed_today (le fasce di domani non contano)', () => {
    expect(status(at(WED, '20:00'))).toEqual({ state: 'closed_today' });
  });

  test('giorno senza fasce: closed_today', () => {
    const hours: Hours[] = [{ weekday: 3, start: '09:00', end: '13:00' }];
    expect(status(at(THU, '10:00'), hours)).toEqual({ state: 'closed_today' });
  });
});

describe('openingStatus – bordi [inizio, fine) (decisione 5)', () => {
  test('all\'istante di apertura è open', () => {
    expect(status(at(WED, '09:00'))).toEqual({ state: 'open', until: at(WED, '13:00') });
  });

  test('un millisecondo prima della chiusura è ancora open', () => {
    expect(status(new Date(at(WED, '13:00').getTime() - 1))).toEqual({ state: 'open', until: at(WED, '13:00') });
  });

  test('all\'istante di chiusura della mattina non è più open: opens_later al pomeriggio', () => {
    expect(status(at(WED, '13:00'))).toEqual({ state: 'opens_later', at: at(WED, '15:00') });
  });

  test('all\'istante di chiusura serale: closed_today', () => {
    expect(status(at(WED, '19:30'))).toEqual({ state: 'closed_today' });
  });
});

describe('openingStatus – chiusure del negozio (SPEC §3.5, decisione 5)', () => {
  test('chiusura che copre tutto il giorno: closed_today anche prima dell\'apertura', () => {
    const closures = [{ startsAt: at(WED, '00:00'), endsAt: at(THU, '00:00') }];
    expect(status(at(WED, '08:00'), WEEK, closures)).toEqual({ state: 'closed_today' });
    expect(status(at(WED, '10:00'), WEEK, closures)).toEqual({ state: 'closed_today' });
  });

  test('chiusura di più giorni iniziata ieri e finita domani: closed_today', () => {
    const closures = [{ startsAt: at('2027-03-02', '12:00'), endsAt: at(THU, '12:00') }];
    expect(status(at(WED, '10:00'), WEEK, closures)).toEqual({ state: 'closed_today' });
  });

  test('chiusura parziale 10–12 dentro 9–13: alle 11 opens_later alle 12', () => {
    const closures = [{ startsAt: at(WED, '10:00'), endsAt: at(WED, '12:00') }];
    expect(status(at(WED, '11:00'), WEEK, closures)).toEqual({ state: 'opens_later', at: at(WED, '12:00') });
  });

  test('chiusura parziale 10–12: alle 9:30 open fino alle 10, alle 12 open fino alle 13', () => {
    const closures = [{ startsAt: at(WED, '10:00'), endsAt: at(WED, '12:00') }];
    expect(status(at(WED, '09:30'), WEEK, closures)).toEqual({ state: 'open', until: at(WED, '10:00') });
    expect(status(at(WED, '12:00'), WEEK, closures)).toEqual({ state: 'open', until: at(WED, '13:00') });
  });

  test('chiusura del pomeriggio: nella pausa pranzo closed_today', () => {
    const closures = [{ startsAt: at(WED, '15:00'), endsAt: at(WED, '19:30') }];
    expect(status(at(WED, '14:00'), WEEK, closures)).toEqual({ state: 'closed_today' });
  });

  test('una chiusura di un altro giorno non cambia nulla', () => {
    const closures = [{ startsAt: at(THU, '00:00'), endsAt: at('2027-03-05', '00:00') }];
    expect(status(at(WED, '10:00'), WEEK, closures)).toEqual({ state: 'open', until: at(WED, '13:00') });
  });
});

describe('openingStatus – giorno locale e codifica del weekday (SPEC §3.4, §9)', () => {
  test('weekday ISO: 7 = domenica, 1 = lunedì (come working_hours.weekday)', () => {
    const hours: Hours[] = [
      { weekday: 7, start: '10:00', end: '12:00' },
      { weekday: 1, start: '14:00', end: '16:00' },
    ];
    expect(status(at('2027-03-07', '11:00'), hours)).toEqual({ state: 'open', until: at('2027-03-07', '12:00') });
    expect(status(at('2027-03-01', '11:00'), hours)).toEqual({ state: 'opens_later', at: at('2027-03-01', '14:00') });
  });

  test('weekday 0 non è la domenica: domenica senza fasce con codifica ISO', () => {
    const hours: Hours[] = [{ weekday: 0, start: '10:00', end: '12:00' }];
    expect(status(at('2027-03-07', '11:00'), hours)).toEqual({ state: 'closed_today' });
  });

  test('il giorno è quello locale del negozio, non quello UTC', () => {
    // 2027-03-03T23:30Z = giovedì 00:30 a Roma (+01:00): vale la fascia del giovedì.
    const hours: Hours[] = [
      { weekday: 3, start: '22:00', end: '23:59' },
      { weekday: 4, start: '00:00', end: '02:00' },
    ];
    expect(status(utc('2027-03-03T23:30:00Z'), hours)).toEqual({ state: 'open', until: at(THU, '02:00') });
  });

  test('ora legale (+02:00): 09:30 locale è 07:30Z e la fascia finisce alle 11:00Z', () => {
    const hours: Hours[] = [{ weekday: 3, start: '09:00', end: '13:00' }];
    // 2027-06-02 è mercoledì
    expect(status(utc('2027-06-02T07:30:00Z'), hours)).toEqual({ state: 'open', until: utc('2027-06-02T11:00:00Z') });
  });
});

describe('openingStatus – cambi d\'ora (SPEC §4.1, §12)', () => {
  // Domenica 28 marzo 2027: alle 02:00 (+01:00) gli orologi passano alle 03:00 (+02:00).
  const SPRING: Hours[] = [{ weekday: 7, start: '01:00', end: '04:00' }];
  // Domenica 31 ottobre 2027: alle 03:00 (+02:00) gli orologi tornano alle 02:00 (+01:00).
  const AUTUMN: Hours[] = [{ weekday: 7, start: '01:00', end: '04:00' }];

  test('ora legale: fascia 01:00–04:00 dura 2 ore reali (fine alle 02:00Z)', () => {
    expect(status(utc('2027-03-28T00:30:00Z'), SPRING)).toEqual({ state: 'open', until: utc('2027-03-28T02:00:00Z') });
  });

  test('ora legale: alle 03:30 locali (01:30Z) è ancora open fino alle 02:00Z', () => {
    expect(status(utc('2027-03-28T01:30:00Z'), SPRING)).toEqual({ state: 'open', until: utc('2027-03-28T02:00:00Z') });
  });

  test('ora legale: prima dell\'apertura delle 09:00 (+02:00) → opens_later alle 07:00Z', () => {
    const hours: Hours[] = [{ weekday: 7, start: '09:00', end: '13:00' }];
    expect(status(utc('2027-03-28T05:00:00Z'), hours)).toEqual({ state: 'opens_later', at: utc('2027-03-28T07:00:00Z') });
  });

  test('ora solare: fascia 01:00–04:00 dura 4 ore reali (da 23:00Z a 03:00Z)', () => {
    expect(status(utc('2027-10-30T23:30:00Z'), AUTUMN)).toEqual({ state: 'open', until: utc('2027-10-31T03:00:00Z') });
  });

  test('ora solare: alle 02:30Z (03:30 locali, +01:00) è ancora open', () => {
    expect(status(utc('2027-10-31T02:30:00Z'), AUTUMN)).toEqual({ state: 'open', until: utc('2027-10-31T03:00:00Z') });
  });

  test('ora solare: alle 03:00Z la fascia è finita → closed_today', () => {
    expect(status(utc('2027-10-31T03:00:00Z'), AUTUMN)).toEqual({ state: 'closed_today' });
  });
});
