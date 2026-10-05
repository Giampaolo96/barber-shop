// Test di accettazione – FETTA 6 (SPEC §11: "Calendario admin + prenotazioni manuali + cambi stato"),
// logica pura del calendario dello staff.
// Sezioni: SPEC §2 (ruoli), §3.6 (stati e transizioni), §3.7.1, §3.7.5 (le manuali derogano alla
// regola 2, mai alla 1), §3.7.6, §6.1–6.3, §12 (cambio d'ora, assenza parziale, pausa pranzo),
// CLAUDE.md regola 2 (timezone del negozio) + decisioni approvate per la fetta 6 (punti 3, 4, 5).
//
// Interfacce attese (moduli puri, senza I/O):
//   src/lib/calendar/grid.ts
//     type LocalBand = { start: string; end: string }            // 'HH:MM' ora locale del negozio
//     type DayGrid = { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] }
//     dayGrid(input: { date: string; tz: string; granularityMin: number; bands: LocalBand[];
//                      bookings: Interval[] }): DayGrid
//       righe = istanti reali ogni granularityMin minuti, dal minimo fra inizio delle fasce e delle
//       prenotazioni del giorno (arrotondato per difetto alla griglia dell'orologio locale) al massimo
//       fra le fini (per eccesso), esclusa la fine; senza fasce né prenotazioni 09:00–19:00 locale,
//       con sole prenotazioni copre almeno quelle. Nei giorni del cambio d'ora le righe seguono il tempo
//       reale (25 o 23 ore).
//     blockPosition(grid: DayGrid, block: { startsAt: Date; endsAt: Date }): { row: number; span: number } | null
//       row = indice (da 0) della riga in cui cade l'inizio, ritagliato alla griglia; span = numero di
//       righe toccate; null se il blocco non interseca [grid.startsAt, grid.endsAt).
//     weekDates(date: string): string[]                         // 7 date YYYY-MM-DD, da lunedì a domenica
//   src/lib/calendar/transitions.ts
//     allowedTransitions(input: { role: 'barber' | 'admin'; status: BookingStatus; startsAt: Date; now: Date }): BookingStatus[]
//   src/lib/calendar/warnings.ts
//     WARNING_CODES = ['outside_hours', 'time_off', 'closure', 'past'] as const   (ordine fisso)
//     manualBookingWarnings(input: { startsAt: Date; endsAt: Date; now: Date; bands: Interval[];
//                                    timeOff: Interval[]; closures: Interval[] }): WarningCode[]
//       Interval = { startsAt: Date; endsAt: Date }, semiaperti [inizio, fine)
//     decideWarnings(current: WarningCode[], confirmed: WarningCode[]):
//       { save: true } | { save: false; warnings: WarningCode[] }
//       save: true se current ⊆ confirmed (anche vuoto); altrimenti { save: false, warnings: current }
//   src/lib/calendar/errors.ts
//     calendarErrorCode(error: { code?: string; message?: string; details?: string | null; hint?: string | null }):
//       'barber_busy' | 'customer_busy' | 'not_enabled' | 'forbidden' | 'error'
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { formatInTimeZone } from 'date-fns-tz';
import { describe, expect, test } from 'vitest';

type BookingStatus = 'confirmed' | 'completed' | 'cancelled_by_customer' | 'cancelled_by_shop' | 'no_show';
type WarningCode = 'outside_hours' | 'time_off' | 'closure' | 'past';
type Interval = { startsAt: Date; endsAt: Date };
type LocalBand = { start: string; end: string };
type DayGrid = { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] };

type GridModule = {
  dayGrid: (input: {
    date: string;
    tz: string;
    granularityMin: number;
    bands: LocalBand[];
    bookings: Interval[];
  }) => DayGrid;
  blockPosition: (grid: DayGrid, block: Interval) => { row: number; span: number } | null;
  weekDates: (date: string) => string[];
};
type TransitionsModule = {
  allowedTransitions: (input: {
    role: 'barber' | 'admin';
    status: BookingStatus;
    startsAt: Date;
    now: Date;
  }) => BookingStatus[];
};
type WarningsModule = {
  WARNING_CODES: readonly WarningCode[];
  manualBookingWarnings: (input: {
    startsAt: Date;
    endsAt: Date;
    now: Date;
    bands: Interval[];
    timeOff: Interval[];
    closures: Interval[];
  }) => WarningCode[];
  decideWarnings: (
    current: WarningCode[],
    confirmed: WarningCode[],
  ) => { save: true } | { save: false; warnings: WarningCode[] };
};
type ErrorsModule = {
  calendarErrorCode: (error: { code?: string; message?: string; details?: string | null; hint?: string | null }) => string;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const grid = () => load<GridModule>('@/lib/calendar/grid');
const transitions = () => load<TransitionsModule>('@/lib/calendar/transitions');
const warnings = () => load<WarningsModule>('@/lib/calendar/warnings');
const errors = () => load<ErrorsModule>('@/lib/calendar/errors');

const TZ = 'Europe/Rome';
const MIN = 60_000;
const localTimes = (dates: Date[]): string[] => dates.map((d) => formatInTimeZone(d, TZ, 'HH:mm'));
/** 2027-01-12 (martedì, ora solare UTC+1) alle HH:MM di Roma. */
const jan = (time: string): Date => new Date(`2027-01-12T${time}:00+01:00`);
const iv = (from: string, to: string): Interval => ({ startsAt: jan(from), endsAt: jan(to) });
const sorted = <T extends string>(values: T[]): T[] => [...values].sort();

// ---------------------------------------------------------------------------
// Griglia del giorno – SPEC §6.1, §12 (cambio d'ora), CLAUDE.md regola 2
// ---------------------------------------------------------------------------
describe('dayGrid (SPEC §6.1)', () => {
  test('dalla prima fascia all\'ultima, una riga per granularità', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({
      date: '2027-01-12',
      tz: TZ,
      granularityMin: 15,
      bands: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:30' }],
      bookings: [],
    });
    expect(g.startsAt.toISOString()).toBe('2027-01-12T08:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2027-01-12T18:30:00.000Z');
    expect(g.granularityMin).toBe(15);
    expect(g.rows).toHaveLength(42);
    expect(g.rows[0]?.toISOString()).toBe('2027-01-12T08:00:00.000Z');
    expect(g.rows[1]?.toISOString()).toBe('2027-01-12T08:15:00.000Z');
    expect(g.rows.at(-1)?.toISOString()).toBe('2027-01-12T18:15:00.000Z');
  });

  test('fasce di più barbieri, non ordinate: dall\'inizio più presto alla fine più tarda', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({
      date: '2027-01-12',
      tz: TZ,
      granularityMin: 30,
      bands: [{ start: '15:00', end: '19:30' }, { start: '08:30', end: '12:00' }, { start: '10:00', end: '18:00' }],
      bookings: [],
    });
    expect(localTimes([g.startsAt, g.endsAt])).toEqual(['08:30', '19:30']);
    expect(g.rows).toHaveLength(22);
  });

  test('fasce non allineate: inizio per difetto e fine per eccesso sulla griglia dell\'orologio locale', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 30, bands: [{ start: '09:10', end: '12:50' }], bookings: [] });
    expect(localTimes([g.startsAt, g.endsAt])).toEqual(['09:00', '13:00']);
    expect(localTimes(g.rows)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  });

  test('decisione fetta 6: senza fasce né prenotazioni (giorno di riposo) ripiego 09:00–19:00 locale', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 60, bands: [], bookings: [] });
    expect(g.startsAt.toISOString()).toBe('2027-01-12T08:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2027-01-12T18:00:00.000Z');
    expect(g.rows).toHaveLength(10);
  });

  test('SPEC §12: passaggio all\'ora solare (2026-10-25), fasce normali in ora solare', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2026-10-25', tz: TZ, granularityMin: 15, bands: [{ start: '09:00', end: '19:00' }], bookings: [] });
    expect(g.startsAt.toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2026-10-25T18:00:00.000Z');
    expect(g.rows).toHaveLength(40);
  });

  test('SPEC §12: passaggio all\'ora legale (2027-03-28), fasce normali in ora legale', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2027-03-28', tz: TZ, granularityMin: 15, bands: [{ start: '09:00', end: '19:00' }], bookings: [] });
    expect(g.startsAt.toISOString()).toBe('2027-03-28T07:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2027-03-28T17:00:00.000Z');
    expect(g.rows).toHaveLength(40);
  });

  test('SPEC §12: fascia a cavallo del cambio all\'ora solare – le 02:00–03:00 compaiono due volte', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2026-10-25', tz: TZ, granularityMin: 30, bands: [{ start: '01:00', end: '04:00' }], bookings: [] });
    expect(g.startsAt.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(localTimes(g.rows)).toEqual(['01:00', '01:30', '02:00', '02:30', '02:00', '02:30', '03:00', '03:30']);
  });

  test('SPEC §12: fascia a cavallo del cambio all\'ora legale – le 02:00–03:00 non esistono', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({ date: '2027-03-28', tz: TZ, granularityMin: 30, bands: [{ start: '01:00', end: '04:00' }], bookings: [] });
    expect(g.startsAt.toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(g.endsAt.toISOString()).toBe('2027-03-28T02:00:00.000Z');
    expect(localTimes(g.rows)).toEqual(['01:00', '01:30', '03:00', '03:30']);
  });

  // Decisione fetta 6 (utente, dopo la prima consegna): la griglia si estende alle prenotazioni del giorno
  test('una manuale fuori orario (20:00–20:30) estende la fine della griglia ed è posizionabile', async () => {
    const { dayGrid, blockPosition } = await grid();
    const booking = iv('20:00', '20:30');
    const g = dayGrid({
      date: '2027-01-12',
      tz: TZ,
      granularityMin: 15,
      bands: [{ start: '09:00', end: '19:00' }],
      bookings: [booking],
    });
    expect(localTimes([g.startsAt, g.endsAt])).toEqual(['09:00', '20:30']);
    expect(g.rows).toHaveLength(46);
    expect(blockPosition(g, booking)).toEqual({ row: 44, span: 2 });
  });

  test('una prenotazione che inizia prima della prima fascia estende l\'inizio (per difetto sulla griglia)', async () => {
    const { dayGrid, blockPosition } = await grid();
    const booking = iv('08:10', '08:40');
    const g = dayGrid({
      date: '2027-01-12',
      tz: TZ,
      granularityMin: 15,
      bands: [{ start: '09:00', end: '19:00' }],
      bookings: [booking],
    });
    expect(localTimes([g.startsAt, g.endsAt])).toEqual(['08:00', '19:00']);
    expect(blockPosition(g, booking)).toEqual({ row: 0, span: 3 });
  });

  test('prenotazioni dentro le fasce non cambiano la griglia', async () => {
    const { dayGrid } = await grid();
    const g = dayGrid({
      date: '2027-01-12',
      tz: TZ,
      granularityMin: 15,
      bands: [{ start: '09:00', end: '19:00' }],
      bookings: [iv('10:00', '10:30')],
    });
    expect(localTimes([g.startsAt, g.endsAt])).toEqual(['09:00', '19:00']);
  });

  test('senza fasce, con sole prenotazioni: la griglia le copre', async () => {
    const { dayGrid, blockPosition } = await grid();
    const late = iv('20:00', '20:30');
    const early = iv('07:30', '08:00');
    const g = dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 30, bands: [], bookings: [late, early] });
    expect(g.startsAt.getTime()).toBeLessThanOrEqual(early.startsAt.getTime());
    expect(g.endsAt.getTime()).toBeGreaterThanOrEqual(late.endsAt.getTime());
    expect(blockPosition(g, late)).not.toBeNull();
    expect(blockPosition(g, early)).not.toBeNull();
  });
});

describe('blockPosition (SPEC §6.1)', () => {
  const dayGridJan = async (): Promise<DayGrid> =>
    (await grid()).dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 15, bands: [{ start: '09:00', end: '19:30' }], bookings: [] });

  test('blocco allineato: riga di inizio e numero di righe', async () => {
    const { blockPosition } = await grid();
    expect(blockPosition(await dayGridJan(), iv('10:00', '10:30'))).toEqual({ row: 4, span: 2 });
  });

  test('blocco non allineato: copre tutte le righe che tocca', async () => {
    const { blockPosition } = await grid();
    expect(blockPosition(await dayGridJan(), iv('10:05', '10:35'))).toEqual({ row: 4, span: 3 });
  });

  test('ritagliato all\'inizio e alla fine della griglia', async () => {
    const { blockPosition } = await grid();
    const g = await dayGridJan();
    expect(blockPosition(g, iv('08:30', '09:30'))).toEqual({ row: 0, span: 2 });
    expect(blockPosition(g, iv('19:00', '20:00'))).toEqual({ row: 40, span: 2 });
  });

  test('fuori dalla griglia → null (bordi [) )', async () => {
    const { blockPosition } = await grid();
    const g = await dayGridJan();
    expect(blockPosition(g, iv('08:30', '09:00'))).toBeNull();
    expect(blockPosition(g, iv('19:30', '20:00'))).toBeNull();
    expect(blockPosition(g, iv('20:00', '20:30'))).toBeNull();
  });

  test('SPEC §12: nel giorno del cambio all\'ora solare il blocco segue il tempo reale', async () => {
    const { dayGrid, blockPosition } = await grid();
    const g = dayGrid({ date: '2026-10-25', tz: TZ, granularityMin: 30, bands: [{ start: '01:00', end: '04:00' }], bookings: [] });
    // 02:00–02:30 in ora solare (+01:00) è la seconda occorrenza delle 02:00
    const block = { startsAt: new Date('2026-10-25T02:00:00+01:00'), endsAt: new Date('2026-10-25T02:30:00+01:00') };
    expect(blockPosition(g, block)).toEqual({ row: 4, span: 1 });
  });
});

describe('weekDates (SPEC §6.1: vista settimanale)', () => {
  test('da lunedì a domenica, a partire da un giorno qualsiasi', async () => {
    const { weekDates } = await grid();
    const week = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15', '2027-01-16', '2027-01-17'];
    expect(weekDates('2027-01-13')).toEqual(week);
    expect(weekDates('2027-01-11')).toEqual(week);
    expect(weekDates('2027-01-17')).toEqual(week);
  });

  test('SPEC §12: settimane dei cambi d\'ora (domenica 2026-10-25 e 2027-03-28)', async () => {
    const { weekDates } = await grid();
    expect(weekDates('2026-10-25')).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(weekDates('2027-03-28')).toEqual([
      '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28',
    ]);
  });

  test('a cavallo dell\'anno', async () => {
    const { weekDates } = await grid();
    expect(weekDates('2027-01-01')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Transizioni di stato – SPEC §2, §3.6 + decisioni fetta 6 (3 e 5)
// ---------------------------------------------------------------------------
describe('allowedTransitions (SPEC §3.6)', () => {
  const NOW = jan('12:00');
  const PAST = jan('11:00');
  const FUTURE = jan('15:00');
  const FINAL: BookingStatus[] = ['completed', 'no_show', 'cancelled_by_customer', 'cancelled_by_shop'];

  test.each(['barber', 'admin'] as const)(
    '%s – confirmed già iniziata: completata, no-show e le due cancellazioni',
    async (role) => {
      const { allowedTransitions } = await transitions();
      expect(sorted(allowedTransitions({ role, status: 'confirmed', startsAt: PAST, now: NOW }))).toEqual(
        sorted(['completed', 'no_show', 'cancelled_by_customer', 'cancelled_by_shop']),
      );
    },
  );

  test.each(['barber', 'admin'] as const)(
    '%s – confirmed futura: solo le cancellazioni (completed e no_show solo se starts_at <= now)',
    async (role) => {
      const { allowedTransitions } = await transitions();
      expect(sorted(allowedTransitions({ role, status: 'confirmed', startsAt: FUTURE, now: NOW }))).toEqual(
        sorted(['cancelled_by_customer', 'cancelled_by_shop']),
      );
    },
  );

  test('bordo: starts_at = now → completata e no-show già ammessi', async () => {
    const { allowedTransitions } = await transitions();
    const result = allowedTransitions({ role: 'barber', status: 'confirmed', startsAt: NOW, now: NOW });
    expect(result).toContain('completed');
    expect(result).toContain('no_show');
  });

  test.each(FINAL)('barbiere – da %s nessuna transizione (stato finale)', async (status) => {
    const { allowedTransitions } = await transitions();
    expect(allowedTransitions({ role: 'barber', status, startsAt: PAST, now: NOW })).toEqual([]);
  });

  test.each(FINAL)('admin – da %s solo "Ripristina confermata"', async (status) => {
    const { allowedTransitions } = await transitions();
    expect(allowedTransitions({ role: 'admin', status, startsAt: PAST, now: NOW })).toEqual(['confirmed']);
    expect(allowedTransitions({ role: 'admin', status, startsAt: FUTURE, now: NOW })).toEqual(['confirmed']);
  });
});

// ---------------------------------------------------------------------------
// Avvisi delle manuali e degli spostamenti – SPEC §3.7.2, §3.7.5, §12 + decisione fetta 6 (4)
// ---------------------------------------------------------------------------
describe('manualBookingWarnings (SPEC §3.7.5)', () => {
  const NOW = new Date('2027-01-01T00:00:00Z');
  const BANDS = [iv('09:00', '13:00'), iv('15:00', '19:30')];
  const base = { now: NOW, bands: BANDS, timeOff: [] as Interval[], closures: [] as Interval[] };
  const check = async (from: string, to: string, extra: Partial<typeof base> = {}): Promise<WarningCode[]> =>
    (await warnings()).manualBookingWarnings({ ...base, ...extra, ...iv(from, to) });

  test('ordine fisso dei codici', async () => {
    const { WARNING_CODES } = await warnings();
    expect([...WARNING_CODES]).toEqual(['outside_hours', 'time_off', 'closure', 'past']);
  });

  test('dentro una fascia, anche ai bordi → nessun avviso', async () => {
    expect(await check('10:00', '10:30')).toEqual([]);
    expect(await check('09:00', '09:30')).toEqual([]);
    expect(await check('12:30', '13:00')).toEqual([]);
    expect(await check('19:00', '19:30')).toEqual([]);
  });

  test('SPEC §12: finirebbe nella pausa pranzo o oltre la chiusura → outside_hours', async () => {
    expect(await check('12:45', '13:15')).toEqual(['outside_hours']);
    expect(await check('19:15', '19:45')).toEqual(['outside_hours']);
    expect(await check('08:45', '09:15')).toEqual(['outside_hours']);
    expect(await check('20:00', '20:30')).toEqual(['outside_hours']);
  });

  test('fasce contigue (anche non ordinate) unite: nessun avviso a cavallo', async () => {
    const bands = [iv('13:00', '15:00'), iv('09:00', '13:00')];
    expect(await check('12:45', '13:15', { bands })).toEqual([]);
  });

  test('nessuna fascia nel giorno → outside_hours', async () => {
    expect(await check('10:00', '10:30', { bands: [] })).toEqual(['outside_hours']);
  });

  test('SPEC §12: assenza parziale a metà mattina, bordi [)', async () => {
    const timeOff = [iv('10:00', '11:00')];
    expect(await check('09:30', '10:00', { timeOff })).toEqual([]);
    expect(await check('11:00', '11:30', { timeOff })).toEqual([]);
    expect(await check('10:45', '11:15', { timeOff })).toEqual(['time_off']);
    expect(await check('09:45', '10:15', { timeOff })).toEqual(['time_off']);
  });

  test('chiusura del negozio, bordi [)', async () => {
    const closures = [iv('16:00', '17:00')];
    expect(await check('15:30', '16:00', { closures })).toEqual([]);
    expect(await check('17:00', '17:30', { closures })).toEqual([]);
    expect(await check('16:30', '17:00', { closures })).toEqual(['closure']);
  });

  test('passato: starts_at < now; starts_at = now non è passato', async () => {
    expect(await check('10:00', '10:30', { now: jan('10:01') })).toEqual(['past']);
    expect(await check('10:00', '10:30', { now: jan('10:00') })).toEqual([]);
  });

  test('tutti gli avvisi insieme, nell\'ordine fisso', async () => {
    const result = await check('12:45', '13:15', {
      now: jan('18:00'),
      timeOff: [iv('13:00', '14:00')],
      closures: [iv('12:00', '13:00')],
    });
    expect(result).toEqual(['outside_hours', 'time_off', 'closure', 'past']);
  });
});

describe('decideWarnings (decisione fetta 6, punto 4)', () => {
  test('nessun avviso → si salva subito', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings([], [])).toEqual({ save: true });
  });

  test('nessun avviso ricalcolato, anche se il modulo ne aveva confermati → si salva', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings([], ['past'])).toEqual({ save: true });
  });

  test('primo invio con avvisi → non si salva e si restituiscono gli avvisi', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings(['outside_hours', 'past'], [])).toEqual({ save: false, warnings: ['outside_hours', 'past'] });
  });

  test('avvisi confermati uguali come insieme (ordine e doppioni irrilevanti) → si salva', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings(['outside_hours', 'time_off'], ['time_off', 'outside_hours'])).toEqual({ save: true });
    expect(decideWarnings(['outside_hours'], ['outside_hours', 'outside_hours'])).toEqual({ save: true });
  });

  test('ricalcolati con un avviso nuovo → si mostrano i nuovi e non si salva', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings(['outside_hours', 'time_off'], ['outside_hours'])).toEqual({
      save: false,
      warnings: ['outside_hours', 'time_off'],
    });
  });

  // Decisione dell'utente (variante): si salva se gli avvisi attuali sono un sottoinsieme, anche
  // vuoto, di quelli confermati, cioè se non compare nessun avviso nuovo.
  test('un avviso confermato è sparito (sottoinsieme non vuoto) → si salva', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings(['outside_hours'], ['outside_hours', 'past'])).toEqual({ save: true });
    expect(decideWarnings(['time_off'], ['outside_hours', 'time_off', 'closure'])).toEqual({ save: true });
  });

  test('uno sparito e uno nuovo → non si salva e si restituiscono gli avvisi attuali', async () => {
    const { decideWarnings } = await warnings();
    expect(decideWarnings(['outside_hours', 'closure'], ['outside_hours', 'time_off'])).toEqual({
      save: false,
      warnings: ['outside_hours', 'closure'],
    });
  });
});

// ---------------------------------------------------------------------------
// Errori del database → codici dell'interfaccia – SPEC §3.7.1, §3.7.3, §3.7.6, §6.3
// ---------------------------------------------------------------------------
describe('calendarErrorCode (SPEC §3.7)', () => {
  test('SPEC §3.7.1: esclusione sul barbiere → barber_busy', async () => {
    const { calendarErrorCode } = await errors();
    expect(
      calendarErrorCode({
        code: '23P01',
        message: 'conflicting key value violates exclusion constraint "bookings_no_overlap"',
        details: 'Key (barber_id, tstzrange(starts_at, blocked_until, \'[)\'::text))=(...) conflicts with existing key (...).',
      }),
    ).toBe('barber_busy');
  });

  test('SPEC §3.7.6: esclusione sul cliente → customer_busy', async () => {
    const { calendarErrorCode } = await errors();
    expect(
      calendarErrorCode({
        code: '23P01',
        message: 'conflicting key value violates exclusion constraint "bookings_customer_no_overlap"',
        details: 'Key (customer_id, tstzrange(starts_at, ends_at, \'[)\'::text))=(...) conflicts with existing key (...).',
      }),
    ).toBe('customer_busy');
  });

  test('SPEC §3.7.3: barbiere non abilitato al servizio → not_enabled; altri 23514 → error', async () => {
    const { calendarErrorCode } = await errors();
    expect(calendarErrorCode({ code: '23514', message: 'barber is not enabled for this service' })).toBe('not_enabled');
    expect(calendarErrorCode({ code: '23514', message: 'a booking can be completed only after it has started' })).toBe(
      'error',
    );
  });

  test('42501 (RLS o trigger dei ruoli) → forbidden', async () => {
    const { calendarErrorCode } = await errors();
    expect(
      calendarErrorCode({ code: '42501', message: 'new row violates row-level security policy for table "bookings"' }),
    ).toBe('forbidden');
    expect(calendarErrorCode({ code: '42501', message: 'status transition confirmed -> confirmed not allowed' })).toBe(
      'forbidden',
    );
  });

  test('altri errori, o 23P01 su un vincolo sconosciuto → error', async () => {
    const { calendarErrorCode } = await errors();
    expect(calendarErrorCode({ code: '23P01', message: 'conflicting key value violates exclusion constraint "x"' })).toBe(
      'error',
    );
    expect(calendarErrorCode({ code: 'P0001', message: 'boom' })).toBe('error');
    expect(calendarErrorCode({})).toBe('error');
  });
});

// Sanity del helper di prova (non del codice applicativo)
test('helper: jan() è in ora solare di Roma', () => {
  expect(jan('10:00').getTime() - new Date('2027-01-12T09:00:00Z').getTime()).toBe(0);
  expect(iv('10:00', '10:30').endsAt.getTime() - iv('10:00', '10:30').startsAt.getTime()).toBe(30 * MIN);
});
