// Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
// Utilità pure dell'area admin: importi in centesimi e conversione fra ora locale del negozio e UTC.
// Sezioni: SPEC §3.2 (prezzo in centesimi), §3.5 (assenze e chiusure), §9 (UTC nel DB, Europe/Rome
// a video), §12 (passaggio all'ora legale e a quella solare), CLAUDE.md – regole di dominio 2 e 3
// + decisioni approvate per la fetta 3 (punto A).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { afterEach, describe, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese (il codice ancora non esiste)
// ---------------------------------------------------------------------------
type MoneyModule = {
  /** Euro scritti dall'utente → centesimi interi; `null` se l'input non è un importo valido. */
  parseEuroToCents: (input: string) => number | null;
  /** Centesimi → "12,50 €" (formato it-IT, sempre due decimali, simbolo dopo l'importo). */
  formatCents: (cents: number) => string;
};

type LocalParts = { date: string; time: string };
type LocalTimeModule = {
  localDateTimeToUtc: (date: string, time: string, tz: string) => Date;
  allDayRangeToUtc: (fromDate: string, toDate: string, tz: string) => { startsAt: Date; endsAt: Date };
  utcToLocalParts: (d: Date, tz: string) => LocalParts;
};

// Specifier in una variabile: `tsc --noEmit` resta verde finché i moduli non esistono, mentre a
// runtime il test fallisce con "modulo mancante".
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const MONEY = '@/lib/admin/money';
const LOCAL_TIME = '@/lib/admin/local-time';
const ROME = 'Europe/Rome';
const HOUR_MS = 60 * 60 * 1000;

const money = async (): Promise<MoneyModule> => {
  const mod = await load<MoneyModule>(MONEY);
  expect(mod.parseEuroToCents, 'money.ts deve esportare parseEuroToCents').toBeTypeOf('function');
  expect(mod.formatCents, 'money.ts deve esportare formatCents').toBeTypeOf('function');
  return mod;
};

const localTime = async (): Promise<LocalTimeModule> => {
  const mod = await load<LocalTimeModule>(LOCAL_TIME);
  expect(mod.localDateTimeToUtc, 'local-time.ts deve esportare localDateTimeToUtc').toBeTypeOf('function');
  expect(mod.allDayRangeToUtc, 'local-time.ts deve esportare allDayRangeToUtc').toBeTypeOf('function');
  expect(mod.utcToLocalParts, 'local-time.ts deve esportare utcToLocalParts').toBeTypeOf('function');
  return mod;
};

/** Il separatore fra importo e simbolo può essere uno spazio normale o non separabile. */
const normalizeSpaces = (value: string): string => value.replace(/\s/g, ' ');

// ---------------------------------------------------------------------------
// parseEuroToCents
// Decisione fetta 3: virgola o punto come separatore decimale, al massimo 2 decimali, nessun
// separatore delle migliaia, niente segno né simbolo; spazi ai bordi ignorati.
// ---------------------------------------------------------------------------
describe('parseEuroToCents – prezzo in centesimi interi (SPEC §3.2, CLAUDE.md regola 3)', () => {
  test.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12.50', 1250],
    ['12.5', 1250],
    ['0', 0],
    ['0,10', 10],
    ['0,01', 1],
    ['0,05', 5],
    ['19,99', 1999],
    ['20,00', 2000],
    ['1234,56', 123456],
    ['  12,50  ', 1250],
  ])('%j → %i centesimi', async (input, expected) => {
    const { parseEuroToCents } = await money();
    expect(parseEuroToCents(input)).toBe(expected);
  });

  // CLAUDE.md regola 3: "Mai float per gli importi". Questi valori moltiplicati per 100 in
  // virgola mobile danno 114.99999999999999, 28.999999999999996, 434.99999999999994...
  test.each([
    ['1,15', 115],
    ['0,29', 29],
    ['4,35', 435],
    ['1,00', 100],
    ['8,20', 820],
    ['16,08', 1608],
    ['0,57', 57],
  ])('nessun errore di arrotondamento: %j → %i', async (input, expected) => {
    const { parseEuroToCents } = await money();
    const cents = parseEuroToCents(input);
    expect(cents).toBe(expected);
    expect(Number.isInteger(cents)).toBe(true);
  });

  test('tutti gli importi da 0,00 a 99,99 si convertono esattamente', async () => {
    const { parseEuroToCents } = await money();
    const wrong: string[] = [];
    for (let euros = 0; euros < 100; euros += 1) {
      for (let cents = 0; cents < 100; cents += 1) {
        const input = `${euros},${String(cents).padStart(2, '0')}`;
        if (parseEuroToCents(input) !== euros * 100 + cents) wrong.push(input);
      }
    }
    expect(wrong).toEqual([]);
  });

  test.each([
    ['vuoto', ''],
    ['solo spazi', '   '],
    ['negativo', '-1'],
    ['negativo con decimali', '-12,50'],
    ['con segno +', '+12'],
    ['testo', 'abc'],
    ['numero con testo', '12abc'],
    ['tre decimali', '1,005'],
    ['tre decimali con il punto', '12.505'],
    ['separatore delle migliaia e decimali', '1.234,50'],
    ['separatore delle migliaia all\'inglese', '1,234.50'],
    ['due separatori decimali', '12,5,0'],
    ['separatore senza decimali', '12,'],
    ['separatore senza parte intera', ',50'],
    ['notazione esponenziale', '1e3'],
    ['infinito', 'Infinity'],
    ['NaN', 'NaN'],
    ['con il simbolo dell\'euro', '12,50 €'],
    ['spazio interno', '12 50'],
    ['esadecimale', '0x10'],
  ])('rifiuta %s (%j) con null', async (_label, input) => {
    const { parseEuroToCents } = await money();
    expect(parseEuroToCents(input)).toBeNull();
  });

  // Limite di sanità: price_cents è un integer Postgres (max 2147483647)
  test('rifiuta un importo che non sta in un integer Postgres', async () => {
    const { parseEuroToCents } = await money();
    expect(parseEuroToCents('21474836,47')).toBe(2147483647);
    expect(parseEuroToCents('21474836,48')).toBeNull();
    expect(parseEuroToCents('99999999999')).toBeNull();
  });
});

describe('formatCents – visualizzazione in formato it-IT (SPEC §9)', () => {
  // Decisione fetta 3: virgola decimale, sempre due decimali, simbolo "€" dopo l'importo
  // separato da uno spazio (normale o non separabile).
  test.each([
    [1250, '12,50 €'],
    [0, '0,00 €'],
    [5, '0,05 €'],
    [10, '0,10 €'],
    [1999, '19,99 €'],
    [2000, '20,00 €'],
    [100, '1,00 €'],
  ])('%i → %j', async (cents, expected) => {
    const { formatCents } = await money();
    expect(normalizeSpaces(formatCents(cents))).toBe(expected);
  });

  // Le migliaia possono essere raggruppate col punto o no (Intl it-IT non raggruppa le 4 cifre)
  test.each([
    [123456, /^1\.?234,56 €$/],
    [100000, /^1\.?000,00 €$/],
    [12345678, /^123\.?456,78 €$/],
  ])('%i → importo con le migliaia', async (cents, pattern) => {
    const { formatCents } = await money();
    expect(normalizeSpaces(formatCents(cents))).toMatch(pattern);
  });

  test('formatCents e parseEuroToCents sono coerenti', async () => {
    const { formatCents, parseEuroToCents } = await money();
    for (const cents of [0, 1, 99, 1250, 1999, 99999]) {
      const shown = normalizeSpaces(formatCents(cents)).replace(/ €$/, '').replace(/\./g, '');
      expect(parseEuroToCents(shown)).toBe(cents);
    }
  });
});

// ---------------------------------------------------------------------------
// local-time – ora locale del negozio ↔ UTC (timezone passata come parametro)
// ---------------------------------------------------------------------------
describe('localDateTimeToUtc – ora locale del negozio → UTC (SPEC §9, CLAUDE.md regola 2)', () => {
  test.each([
    // Ora solare (CET, UTC+1)
    ['2026-01-15', '10:00', '2026-01-15T09:00:00.000Z'],
    ['2026-12-31', '23:30', '2026-12-31T22:30:00.000Z'],
    ['2027-01-01', '00:00', '2026-12-31T23:00:00.000Z'],
    // Ora legale (CEST, UTC+2)
    ['2026-07-15', '10:00', '2026-07-15T08:00:00.000Z'],
    ['2026-08-01', '00:00', '2026-07-31T22:00:00.000Z'],
    // Giorni dei cambi d'ora, ore lontane dal salto
    ['2027-03-28', '00:00', '2027-03-27T23:00:00.000Z'],
    ['2027-03-28', '10:00', '2027-03-28T08:00:00.000Z'],
    ['2026-10-25', '00:00', '2026-10-24T22:00:00.000Z'],
    ['2026-10-25', '10:00', '2026-10-25T09:00:00.000Z'],
  ])('%s %s a Roma → %s', async (date, time, expected) => {
    const { localDateTimeToUtc } = await localTime();
    expect(localDateTimeToUtc(date, time, ROME).toISOString()).toBe(expected);
  });

  // La timezone è un parametro (shop_settings.timezone), non è cablata su Europe/Rome
  test('usa la timezone passata come parametro', async () => {
    const { localDateTimeToUtc } = await localTime();
    expect(localDateTimeToUtc('2026-01-15', '10:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T15:00:00.000Z',
    );
    expect(localDateTimeToUtc('2026-01-15', '10:00', 'UTC').toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  test.each([
    ['data inesistente', '2026-02-30', '10:00'],
    ['mese 13', '2026-13-01', '10:00'],
    ['data in altro formato', '15/01/2026', '10:00'],
    ['ora 24:00', '2026-01-15', '24:00'],
    ['ora 25:00', '2026-01-15', '25:00'],
    ['minuti 60', '2026-01-15', '10:60'],
    ['ora vuota', '2026-01-15', ''],
    ['data vuota', '', '10:00'],
  ])('rifiuta un input non valido (%s) con un errore', async (_label, date, time) => {
    const { localDateTimeToUtc } = await localTime();
    expect(() => localDateTimeToUtc(date, time, ROME)).toThrow();
  });
});

describe('utcToLocalParts – UTC → data e ora del negozio (SPEC §9)', () => {
  test.each([
    ['2026-01-15T09:00:00Z', { date: '2026-01-15', time: '10:00' }],
    ['2026-07-15T08:00:00Z', { date: '2026-07-15', time: '10:00' }],
    // A cavallo della mezzanotte: il giorno è quello di Roma, non quello UTC
    ['2026-12-31T23:30:00Z', { date: '2027-01-01', time: '00:30' }],
    ['2026-07-31T22:15:00Z', { date: '2026-08-01', time: '00:15' }],
    // Giorni del cambio d'ora
    ['2027-03-28T01:30:00Z', { date: '2027-03-28', time: '03:30' }],
    ['2026-10-25T00:30:00Z', { date: '2026-10-25', time: '02:30' }],
    ['2026-10-25T01:30:00Z', { date: '2026-10-25', time: '02:30' }],
  ])('%s → %j', async (iso, expected) => {
    const { utcToLocalParts } = await localTime();
    expect(utcToLocalParts(new Date(iso), ROME)).toEqual(expected);
  });

  test('andata e ritorno: localDateTimeToUtc ∘ utcToLocalParts è l\'identità', async () => {
    const { localDateTimeToUtc, utcToLocalParts } = await localTime();
    for (const [date, time] of [
      ['2026-01-15', '10:00'],
      ['2026-07-15', '19:30'],
      ['2027-03-28', '12:00'],
      ['2026-10-25', '18:45'],
    ] as const) {
      expect(utcToLocalParts(localDateTimeToUtc(date, time, ROME), ROME)).toEqual({ date, time });
    }
  });

  test('usa la timezone passata come parametro', async () => {
    const { utcToLocalParts } = await localTime();
    expect(utcToLocalParts(new Date('2026-01-15T15:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-01-15',
      time: '10:00',
    });
  });
});

describe('allDayRangeToUtc – "dal X al Y" a giornata intera (SPEC §3.5, §12)', () => {
  const hours = (range: { startsAt: Date; endsAt: Date }): number =>
    (range.endsAt.getTime() - range.startsAt.getTime()) / HOUR_MS;

  // Decisione fetta 3: inizio alle 00:00 di X, fine alle 00:00 del giorno dopo Y (ora di Roma):
  // Y è incluso per intero.
  test('caso semplice in ora solare: dal 2026-01-10 al 2026-01-12', async () => {
    const { allDayRangeToUtc } = await localTime();
    const range = allDayRangeToUtc('2026-01-10', '2026-01-12', ROME);
    expect(range.startsAt.toISOString()).toBe('2026-01-09T23:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-01-12T23:00:00.000Z');
    expect(hours(range)).toBe(72);
  });

  test('caso semplice in ora legale: dal 2026-08-10 al 2026-08-16', async () => {
    const { allDayRangeToUtc } = await localTime();
    const range = allDayRangeToUtc('2026-08-10', '2026-08-16', ROME);
    expect(range.startsAt.toISOString()).toBe('2026-08-09T22:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-08-16T22:00:00.000Z');
    expect(hours(range)).toBe(7 * 24);
  });

  test('un solo giorno qualsiasi dura 24 ore e finisce alle 00:00 del giorno dopo', async () => {
    const { allDayRangeToUtc, utcToLocalParts } = await localTime();
    const range = allDayRangeToUtc('2026-12-25', '2026-12-25', ROME);
    expect(hours(range)).toBe(24);
    expect(utcToLocalParts(range.startsAt, ROME)).toEqual({ date: '2026-12-25', time: '00:00' });
    expect(utcToLocalParts(range.endsAt, ROME)).toEqual({ date: '2026-12-26', time: '00:00' });
  });

  // SPEC §12: "Giorno del passaggio all'ora legale" (domenica 28 marzo 2027, 02:00 → 03:00)
  test('passaggio all\'ora legale: dal 2027-03-27 al 2027-03-29 dura 71 ore', async () => {
    const { allDayRangeToUtc } = await localTime();
    const range = allDayRangeToUtc('2027-03-27', '2027-03-29', ROME);
    expect(range.startsAt.toISOString()).toBe('2027-03-26T23:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2027-03-29T22:00:00.000Z');
    expect(hours(range)).toBe(71);
  });

  test('il solo 2027-03-28 (ora legale) dura 23 ore', async () => {
    const { allDayRangeToUtc, utcToLocalParts } = await localTime();
    const range = allDayRangeToUtc('2027-03-28', '2027-03-28', ROME);
    expect(range.startsAt.toISOString()).toBe('2027-03-27T23:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2027-03-28T22:00:00.000Z');
    expect(hours(range)).toBe(23);
    expect(utcToLocalParts(range.endsAt, ROME)).toEqual({ date: '2027-03-29', time: '00:00' });
  });

  // SPEC §12: "Giorno del passaggio ... a quella solare" (domenica 25 ottobre 2026, 03:00 → 02:00)
  test('passaggio all\'ora solare: dal 2026-10-24 al 2026-10-26 dura 73 ore', async () => {
    const { allDayRangeToUtc } = await localTime();
    const range = allDayRangeToUtc('2026-10-24', '2026-10-26', ROME);
    expect(range.startsAt.toISOString()).toBe('2026-10-23T22:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-10-26T23:00:00.000Z');
    expect(hours(range)).toBe(73);
  });

  test('il solo 2026-10-25 (ora solare) dura 25 ore', async () => {
    const { allDayRangeToUtc, utcToLocalParts } = await localTime();
    const range = allDayRangeToUtc('2026-10-25', '2026-10-25', ROME);
    expect(range.startsAt.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(hours(range)).toBe(25);
    expect(utcToLocalParts(range.endsAt, ROME)).toEqual({ date: '2026-10-26', time: '00:00' });
  });

  // Decisione fetta 3: "dal Y al X" con Y prima di X è un errore (throw)
  test('rifiuta con un errore una fine precedente all\'inizio', async () => {
    const { allDayRangeToUtc } = await localTime();
    expect(() => allDayRangeToUtc('2026-01-12', '2026-01-10', ROME)).toThrow();
    expect(() => allDayRangeToUtc('2026-01-01', '2025-12-31', ROME)).toThrow();
  });

  test('rifiuta con un errore date non valide', async () => {
    const { allDayRangeToUtc } = await localTime();
    expect(() => allDayRangeToUtc('2026-02-30', '2026-03-01', ROME)).toThrow();
    expect(() => allDayRangeToUtc('2026-03-01', 'domani', ROME)).toThrow();
  });
});

// CLAUDE.md regola 2: "Mai usare l'ora locale del server"
describe('local-time non dipende dalla timezone del processo (CLAUDE.md regola 2)', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  test.each(['Asia/Tokyo', 'America/Los_Angeles', 'UTC'])('stessi risultati con TZ=%s', async (tz) => {
    process.env.TZ = tz;
    const { localDateTimeToUtc, allDayRangeToUtc, utcToLocalParts } = await localTime();
    expect(localDateTimeToUtc('2026-07-15', '10:00', ROME).toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(localDateTimeToUtc('2026-01-15', '00:30', ROME).toISOString()).toBe('2026-01-14T23:30:00.000Z');
    const range = allDayRangeToUtc('2026-10-25', '2026-10-25', ROME);
    expect(range.startsAt.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(utcToLocalParts(new Date('2026-12-31T23:30:00Z'), ROME)).toEqual({ date: '2027-01-01', time: '00:30' });
  });
});
