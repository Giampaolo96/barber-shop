// Test di accettazione – FETTA 8c ("Vista settimana a griglia per singolo barbiere"), logica pura.
// Sezioni: SPEC §6.1 (vista settimanale a griglia: 7 colonne lunedì–domenica, stesse righe della vista
// giorno, fuori orario / assenze / chiusure come sfondo, giorni di chiusura totale attenuati), §6.3
// (trascinamento nella vista settimana verso un altro giorno o orario, sempre per lo stesso barbiere,
// solo verso un orario futuro), §3.7.1 (righe occupate fino a blocked_until), §3.7.5 (le righe fuori
// orario, in assenza o in chiusura restano cliccabili: gli avvisi li mostra poi il server), §12 (cambio
// d'ora legale e solare), CLAUDE.md regola 2 (timezone del negozio) + decisioni approvate per la fetta
// 8c (punti 3, 4, 6, 10).
//
// Interfaccia attesa (modulo puro, senza I/O):
//   src/lib/calendar/week-grid.ts
//     type WeekGrid = { granularityMin: number; startMin: number; endMin: number; rows: number[] }
//       Asse comune ai 7 giorni sull'orologio locale: righe = minuti dalla mezzanotte locale, da startMin
//       (incluso) a endMin (escluso) ogni granularityMin minuti.
//     weekGrid(input: { dates: string[]; tz: string; granularityMin: number;
//                       bands: Record<string /* YYYY-MM-DD */, LocalBand[]>; bookings: Interval[] }): WeekGrid
//       startMin = inizio più presto fra le fasce dei 7 giorni e le prenotazioni (minuto locale
//       dell'inizio), per difetto alla griglia; endMin = fine più tarda, per eccesso; senza fasce né
//       prenotazioni 09:00–19:00 (come dayGrid). Una data assente da `bands` o con [] non ha fasce.
//     slotInstant(date: string, minutes: number, tz: string): Date | null
//       istante della riga `minutes` del giorno locale `date`; null se l'ora locale non esiste (buco del
//       passaggio all'ora legale); nell'ora ripetuta del ritorno all'ora solare la prima occorrenza.
//     type SlotState = { kind: 'free' | 'busy' | 'outside' | 'timeOff' | 'closure' | 'nonexistent';
//                        past: boolean; clickable: boolean }
//     daySlots(input: { date: string; grid: WeekGrid; tz: string; bands: Interval[]; timeOff: Interval[];
//                       closures: Interval[];
//                       bookings: Array<{ status: BookingStatus; startsAt: Date; blockedUntil: Date }>;
//                       now: Date; barberActive: boolean }): SlotState[]
//       uno stato per riga di grid.rows (stesso ordine), valutato sull'istante della riga (slotInstant),
//       intervalli semiaperti [inizio, fine). Precedenza: nonexistent > busy > closure > timeOff >
//       outside > free. busy solo per le confirmed, da startsAt a blockedUntil (buffer incluso).
//       past = istante della riga <= now (solo informativo). clickable = barberActive && kind non in
//       {busy, nonexistent}.
//     isClosedDay(date: string, closures: Interval[], tz: string): boolean
//       true se l'unione delle chiusure copre l'intero giorno locale [00:00, 24:00) (23 o 25 ore nei
//       giorni del cambio d'ora).
//     weekDropTarget(input: { grid: WeekGrid; tz: string; role: 'admin' | 'barber';
//                             booking: { barberId: string; startsAt: Date }; isOwn: boolean;
//                             overDate: string | null; deltaRows: number; now: Date }):
//       { kind: 'none' } | { kind: 'past'; date: string; startsAt: Date } | { kind: 'move'; date: string; startsAt: Date }
//       Riga di partenza = quella in cui la scheda è disegnata (minuto locale dell'inizio, per difetto
//       alla griglia); arrivo = riga + deltaRows nel giorno overDate. none se overDate è null, se la
//       riga di arrivo è fuori dalla griglia o l'ora non esiste, se giorno e riga non cambiano, se il
//       barbiere (non admin) non è il proprietario. past se l'istante di arrivo è <= now. Il barbiere
//       della prenotazione non cambia mai (per questo il risultato non lo riporta).
//   src/i18n/it.ts
//     it.admin.calendar.week.newAt          es. "Nuova prenotazione {day} alle {time}"
//     it.admin.calendar.move.dropPreviewDay es. "{day}, {time}"
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

type BookingStatus = 'confirmed' | 'completed' | 'cancelled_by_customer' | 'cancelled_by_shop' | 'no_show';
type Interval = { startsAt: Date; endsAt: Date };
type LocalBand = { start: string; end: string };
type WeekGrid = { granularityMin: number; startMin: number; endMin: number; rows: number[] };
type SlotKind = 'free' | 'busy' | 'outside' | 'timeOff' | 'closure' | 'nonexistent';
type SlotState = { kind: SlotKind; past: boolean; clickable: boolean };
type SlotBooking = { status: BookingStatus; startsAt: Date; blockedUntil: Date };
type DropResult =
  | { kind: 'none' }
  | { kind: 'past'; date: string; startsAt: Date }
  | { kind: 'move'; date: string; startsAt: Date };

type WeekGridModule = {
  weekGrid: (input: {
    dates: string[];
    tz: string;
    granularityMin: number;
    bands: Record<string, LocalBand[]>;
    bookings: Interval[];
  }) => WeekGrid;
  slotInstant: (date: string, minutes: number, tz: string) => Date | null;
  daySlots: (input: {
    date: string;
    grid: WeekGrid;
    tz: string;
    bands: Interval[];
    timeOff: Interval[];
    closures: Interval[];
    bookings: SlotBooking[];
    now: Date;
    barberActive: boolean;
  }) => SlotState[];
  isClosedDay: (date: string, closures: Interval[], tz: string) => boolean;
  weekDropTarget: (input: {
    grid: WeekGrid;
    tz: string;
    role: 'admin' | 'barber';
    booking: { barberId: string; startsAt: Date };
    isOwn: boolean;
    overDate: string | null;
    deltaRows: number;
    now: Date;
  }) => DropResult;
};
type GridModule = {
  dayGrid: (input: {
    date: string;
    tz: string;
    granularityMin: number;
    bands: LocalBand[];
    bookings: Interval[];
  }) => { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] };
  weekDates: (date: string) => string[];
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;
const weekGridModule = () => load<WeekGridModule>('@/lib/calendar/week-grid');
const gridModule = () => load<GridModule>('@/lib/calendar/grid');
const i18n = () => load<{ it: Record<string, unknown> }>('@/i18n/it');

const TZ = 'Europe/Rome';
const LUCA = 'b0000000-0000-4000-8000-000000000002';

/** Minuti dalla mezzanotte di "HH:MM". */
const m = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};
/** Istante di Roma in inverno (UTC+1). */
const winter = (date: string, time: string): Date => new Date(`${date}T${time}:00+01:00`);
const ivw = (date: string, from: string, to: string): Interval => ({ startsAt: winter(date, from), endsAt: winter(date, to) });
const utc = (iso: string): Date => new Date(iso);

// Settimana d'inverno: lunedì 2047-01-14 … domenica 2047-01-20 (ora solare tutta la settimana)
const WEEK = ['2047-01-14', '2047-01-15', '2047-01-16', '2047-01-17', '2047-01-18', '2047-01-19', '2047-01-20'];
// Settimana del passaggio all'ora legale: domenica 2027-03-28, 02:00 → 03:00
const SPRING_WEEK = ['2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28'];
// Settimana del ritorno all'ora solare: domenica 2026-10-25, 03:00 → 02:00
const FALL_WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];

const SHOP_BANDS: LocalBand[] = [
  { start: '09:00', end: '13:00' },
  { start: '15:00', end: '19:30' },
];
const NIGHT: LocalBand[] = [{ start: '01:00', end: '04:00' }];

const range = (from: number, to: number, step: number): number[] => {
  const values: number[] = [];
  for (let value = from; value < to; value += step) values.push(value);
  return values;
};

// ---------------------------------------------------------------------------
// Testi (SPEC §9: tutto da it.ts)
// ---------------------------------------------------------------------------
describe('testi della vista settimana (SPEC §9, fetta 8c)', () => {
  test('it.admin.calendar.week.newAt e move.dropPreviewDay hanno i segnaposto {day} e {time}', async () => {
    const { it } = await i18n();
    const calendar = (it.admin as Record<string, Record<string, unknown>>).calendar as Record<string, Record<string, unknown>>;
    for (const text of [calendar.week?.newAt, calendar.move?.dropPreviewDay]) {
      expect(typeof text).toBe('string');
      expect(text).toContain('{day}');
      expect(text).toContain('{time}');
    }
  });
});

// ---------------------------------------------------------------------------
// weekGrid – SPEC §6.1 (stesse righe della vista giorno), decisione 6
// ---------------------------------------------------------------------------
describe('weekGrid (SPEC §6.1, decisione 6)', () => {
  test('le 7 date sono quelle di weekDates (lunedì–domenica)', async () => {
    const { weekDates } = await gridModule();
    expect(weekDates('2047-01-17')).toEqual(WEEK);
    expect(weekDates('2027-03-28')).toEqual(SPRING_WEEK);
    expect(weekDates('2026-10-21')).toEqual(FALL_WEEK);
  });

  test('unione delle fasce dei 7 giorni: dall\'inizio più presto alla fine più tarda', async () => {
    const { weekGrid } = await weekGridModule();
    const grid = weekGrid({
      dates: WEEK,
      tz: TZ,
      granularityMin: 15,
      bands: { '2047-01-15': SHOP_BANDS, '2047-01-19': [{ start: '08:30', end: '12:00' }], '2047-01-14': [] },
      bookings: [],
    });
    expect(grid.granularityMin).toBe(15);
    expect(grid.startMin).toBe(m('08:30'));
    expect(grid.endMin).toBe(m('19:30'));
    expect(grid.rows).toEqual(range(m('08:30'), m('19:30'), 15));
    expect(grid.rows).toHaveLength(44);
  });

  test('prenotazioni fuori fascia in giorni diversi allargano l\'asse, allineato al passo (15 e 30)', async () => {
    const { weekGrid } = await weekGridModule();
    const input = {
      dates: WEEK,
      tz: TZ,
      bands: { '2047-01-15': SHOP_BANDS },
      bookings: [ivw('2047-01-16', '07:10', '07:40'), ivw('2047-01-20', '20:05', '20:35')],
    };
    const by15 = weekGrid({ ...input, granularityMin: 15 });
    expect([by15.startMin, by15.endMin]).toEqual([m('07:00'), m('20:45')]);
    expect(by15.rows).toEqual(range(m('07:00'), m('20:45'), 15));

    const by30 = weekGrid({ ...input, granularityMin: 30 });
    expect([by30.startMin, by30.endMin]).toEqual([m('07:00'), m('21:00')]);
    expect(by30.rows).toEqual(range(m('07:00'), m('21:00'), 30));
  });

  test('senza fasce né prenotazioni: 09:00–19:00, come la vista giorno', async () => {
    const { weekGrid } = await weekGridModule();
    for (const bands of [{}, Object.fromEntries(WEEK.map((date) => [date, [] as LocalBand[]]))]) {
      const grid = weekGrid({ dates: WEEK, tz: TZ, granularityMin: 15, bands, bookings: [] });
      expect([grid.startMin, grid.endMin]).toEqual([m('09:00'), m('19:00')]);
      expect(grid.rows).toHaveLength(40);
    }
  });

  test('solo prenotazioni, nessuna fascia: l\'asse copre le prenotazioni (come dayGrid)', async () => {
    const { weekGrid } = await weekGridModule();
    const grid = weekGrid({ dates: WEEK, tz: TZ, granularityMin: 15, bands: {}, bookings: [ivw('2047-01-17', '10:00', '10:30')] });
    expect([grid.startMin, grid.endMin]).toEqual([m('10:00'), m('10:30')]);
    expect(grid.rows).toEqual([m('10:00'), m('10:15')]);
  });

  test('stesse righe di dayGrid per lo stesso giorno (fasce non allineate, passi 15, 20 e 30)', async () => {
    const { weekGrid } = await weekGridModule();
    const { dayGrid } = await gridModule();
    const bands: LocalBand[] = [{ start: '09:10', end: '12:50' }, { start: '14:05', end: '18:55' }];
    const booking = ivw('2047-01-16', '18:50', '19:20');
    for (const step of [15, 20, 30]) {
      const day = dayGrid({ date: '2047-01-16', tz: TZ, granularityMin: step, bands, bookings: [booking] });
      const week = weekGrid({ dates: WEEK, tz: TZ, granularityMin: step, bands: { '2047-01-16': bands }, bookings: [booking] });
      const dayMinutes = day.rows.map((row) => (row.getTime() - winter('2047-01-16', '00:00').getTime()) / 60_000);
      expect(week.rows, `passo ${step}`).toEqual(dayMinutes);
      expect(week.granularityMin).toBe(step);
    }
  });

  test('ritorno all\'ora solare (25/10/2026): l\'ora ripetuta compare una volta sola', async () => {
    const { weekGrid } = await weekGridModule();
    const grid = weekGrid({ dates: FALL_WEEK, tz: TZ, granularityMin: 15, bands: { '2026-10-25': NIGHT }, bookings: [] });
    expect([grid.startMin, grid.endMin]).toEqual([m('01:00'), m('04:00')]);
    expect(grid.rows).toEqual(range(m('01:00'), m('04:00'), 15));
    expect(grid.rows.filter((row) => row === m('02:00'))).toHaveLength(1);
  });

  test('passaggio all\'ora legale (28/03/2027): l\'asse è quello dell\'orologio, righe 02:xx comprese', async () => {
    const { weekGrid } = await weekGridModule();
    const grid = weekGrid({ dates: SPRING_WEEK, tz: TZ, granularityMin: 15, bands: { '2027-03-28': NIGHT }, bookings: [] });
    expect(grid.rows).toEqual(range(m('01:00'), m('04:00'), 15));
  });
});

// ---------------------------------------------------------------------------
// slotInstant – SPEC §12 (cambio d'ora), CLAUDE.md regola 2
// ---------------------------------------------------------------------------
describe('slotInstant (SPEC §12, decisione 6)', () => {
  test('giorno normale: ora locale di Roma → istante UTC', async () => {
    const { slotInstant } = await weekGridModule();
    expect(slotInstant('2047-01-15', m('10:00'), TZ)).toEqual(utc('2047-01-15T09:00:00Z'));
    expect(slotInstant('2047-01-15', 0, TZ)).toEqual(utc('2047-01-14T23:00:00Z'));
    expect(slotInstant('2047-07-15', m('10:00'), TZ)).toEqual(utc('2047-07-15T08:00:00Z'));
  });

  test('passaggio all\'ora legale (28/03/2027): 02:00–02:45 non esistono', async () => {
    const { slotInstant } = await weekGridModule();
    expect(slotInstant('2027-03-28', m('01:45'), TZ)).toEqual(utc('2027-03-28T00:45:00Z'));
    for (const time of ['02:00', '02:15', '02:30', '02:45']) {
      expect(slotInstant('2027-03-28', m(time), TZ), time).toBeNull();
    }
    expect(slotInstant('2027-03-28', m('03:00'), TZ)).toEqual(utc('2027-03-28T01:00:00Z'));
  });

  test('ritorno all\'ora solare (25/10/2026): nell\'ora ripetuta vale la prima occorrenza', async () => {
    const { slotInstant } = await weekGridModule();
    expect(slotInstant('2026-10-25', m('01:45'), TZ)).toEqual(utc('2026-10-24T23:45:00Z'));
    expect(slotInstant('2026-10-25', m('02:00'), TZ)).toEqual(utc('2026-10-25T00:00:00Z'));
    expect(slotInstant('2026-10-25', m('02:45'), TZ)).toEqual(utc('2026-10-25T00:45:00Z'));
    expect(slotInstant('2026-10-25', m('03:00'), TZ)).toEqual(utc('2026-10-25T02:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// daySlots – SPEC §6.1, §3.7.1, §3.7.5, §12, decisioni 2, 3, 6
// ---------------------------------------------------------------------------
describe('daySlots (SPEC §6.1, §3.7.1, §3.7.5)', () => {
  const DATE = '2047-01-15'; // martedì, ora solare
  const at = (time: string): Date => winter(DATE, time);
  const iv = (from: string, to: string): Interval => ivw(DATE, from, to);
  const confirmed = (from: string, blockedUntil: string, status: BookingStatus = 'confirmed'): SlotBooking => ({
    status,
    startsAt: at(from),
    blockedUntil: at(blockedUntil),
  });

  const setup = async () => {
    const mod = await weekGridModule();
    const grid = mod.weekGrid({ dates: WEEK, tz: TZ, granularityMin: 15, bands: { [DATE]: SHOP_BANDS }, bookings: [] });
    const base = {
      date: DATE,
      grid,
      tz: TZ,
      bands: [iv('09:00', '13:00'), iv('15:00', '19:30')],
      timeOff: [] as Interval[],
      closures: [] as Interval[],
      bookings: [] as SlotBooking[],
      now: utc('2047-01-01T00:00:00Z'),
      barberActive: true,
    };
    const slotsOf = (overrides: Partial<typeof base> = {}) => {
      const states = mod.daySlots({ ...base, ...overrides });
      expect(states).toHaveLength(grid.rows.length);
      return (time: string): SlotState => {
        const index = grid.rows.indexOf(m(time));
        expect(index, `riga ${time} nella griglia`).toBeGreaterThanOrEqual(0);
        return states[index] as SlotState;
      };
    };
    return { slotsOf, grid };
  };

  test('in fascia libero e cliccabile; fuori fascia (pausa pranzo) sfondo ma cliccabile', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf();
    expect(slot('09:00')).toEqual({ kind: 'free', past: false, clickable: true });
    expect(slot('12:45')).toEqual({ kind: 'free', past: false, clickable: true });
    expect(slot('13:00')).toEqual({ kind: 'outside', past: false, clickable: true });
    expect(slot('14:45')).toEqual({ kind: 'outside', past: false, clickable: true });
    expect(slot('15:00')).toEqual({ kind: 'free', past: false, clickable: true });
  });

  test('confermata occupata fino a blocked_until (buffer incluso): righe non cliccabili', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({ bookings: [confirmed('10:00', '10:40')] });
    expect(slot('09:45')).toEqual({ kind: 'free', past: false, clickable: true });
    for (const time of ['10:00', '10:15', '10:30']) {
      expect(slot(time), time).toEqual({ kind: 'busy', past: false, clickable: false });
    }
    expect(slot('10:45')).toEqual({ kind: 'free', past: false, clickable: true });
  });

  test('cancellate, completate e no-show non occupano le righe', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({
      bookings: [
        confirmed('11:00', '11:30', 'cancelled_by_customer'),
        confirmed('11:00', '11:30', 'cancelled_by_shop'),
        confirmed('16:00', '16:30', 'completed'),
        confirmed('17:00', '17:30', 'no_show'),
      ],
    });
    for (const time of ['11:00', '11:15', '16:00', '17:00']) {
      expect(slot(time), time).toEqual({ kind: 'free', past: false, clickable: true });
    }
  });

  test('assenza parziale e chiusura: sfondo, ma righe cliccabili (gli avvisi arrivano dopo, §3.7.5)', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({ timeOff: [iv('10:00', '12:00')], closures: [iv('15:00', '16:00')] });
    expect(slot('09:45').kind).toBe('free');
    expect(slot('10:00')).toEqual({ kind: 'timeOff', past: false, clickable: true });
    expect(slot('11:45')).toEqual({ kind: 'timeOff', past: false, clickable: true });
    expect(slot('12:00').kind).toBe('free');
    expect(slot('15:00')).toEqual({ kind: 'closure', past: false, clickable: true });
    expect(slot('15:45')).toEqual({ kind: 'closure', past: false, clickable: true });
    expect(slot('16:00').kind).toBe('free');
  });

  test('precedenza: busy > closure > timeOff > outside > free', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({
      timeOff: [iv('12:00', '14:00')],
      closures: [iv('12:30', '13:30')],
      bookings: [confirmed('12:45', '13:15')],
    });
    expect(slot('11:45').kind).toBe('free');
    expect(slot('12:00').kind).toBe('timeOff');
    expect(slot('12:15').kind).toBe('timeOff');
    expect(slot('12:30').kind).toBe('closure');
    expect(slot('12:45').kind).toBe('busy');
    expect(slot('13:00').kind).toBe('busy'); // anche fuori fascia
    expect(slot('13:15').kind).toBe('closure'); // chiusura fuori fascia
    expect(slot('13:30').kind).toBe('timeOff'); // assenza fuori fascia
    expect(slot('13:45').kind).toBe('timeOff');
    expect(slot('14:00').kind).toBe('outside');
    expect(slot('15:00').kind).toBe('free');
  });

  test('passato: past = istante della riga <= now (bordo incluso), clickable invariato', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({ now: at('10:00'), bookings: [confirmed('09:00', '09:30')], timeOff: [iv('09:30', '09:45')] });
    expect(slot('09:00')).toEqual({ kind: 'busy', past: true, clickable: false });
    expect(slot('09:30')).toEqual({ kind: 'timeOff', past: true, clickable: true });
    expect(slot('09:45')).toEqual({ kind: 'free', past: true, clickable: true });
    expect(slot('10:00')).toEqual({ kind: 'free', past: true, clickable: true });
    expect(slot('10:15')).toEqual({ kind: 'free', past: false, clickable: true });
    expect(slot('13:00')).toEqual({ kind: 'outside', past: false, clickable: true });
  });

  test('barbiere disattivato: nessuna riga cliccabile, stati invariati', async () => {
    const { slotsOf } = await setup();
    const slot = slotsOf({ barberActive: false, bookings: [confirmed('10:00', '10:30')], closures: [iv('16:00', '17:00')] });
    expect(slot('09:00')).toEqual({ kind: 'free', past: false, clickable: false });
    expect(slot('10:00')).toEqual({ kind: 'busy', past: false, clickable: false });
    expect(slot('13:00')).toEqual({ kind: 'outside', past: false, clickable: false });
    expect(slot('16:00')).toEqual({ kind: 'closure', past: false, clickable: false });
  });

  test('passaggio all\'ora legale (28/03/2027): 02:00–02:45 inesistenti e non cliccabili, con precedenza su tutto', async () => {
    const mod = await weekGridModule();
    const date = '2027-03-28';
    const grid = mod.weekGrid({ dates: SPRING_WEEK, tz: TZ, granularityMin: 15, bands: { [date]: NIGHT }, bookings: [] });
    const states = mod.daySlots({
      date,
      grid,
      tz: TZ,
      // 01:00 CET → 04:00 CEST
      bands: [{ startsAt: utc('2027-03-28T00:00:00Z'), endsAt: utc('2027-03-28T02:00:00Z') }],
      timeOff: [],
      // Chiusura su tutta la notte: non cambia le righe inesistenti
      closures: [{ startsAt: utc('2027-03-27T23:00:00Z'), endsAt: utc('2027-03-28T00:45:00Z') }],
      // 01:45 CET → 03:15 CEST (30 minuti reali)
      bookings: [{ status: 'confirmed', startsAt: utc('2027-03-28T00:45:00Z'), blockedUntil: utc('2027-03-28T01:15:00Z') }],
      now: utc('2027-01-01T00:00:00Z'),
      barberActive: true,
    });
    const slot = (time: string): SlotState => states[grid.rows.indexOf(m(time))] as SlotState;
    expect(states).toHaveLength(12);
    expect(slot('01:30')).toEqual({ kind: 'closure', past: false, clickable: true });
    expect(slot('01:45')).toEqual({ kind: 'busy', past: false, clickable: false });
    for (const time of ['02:00', '02:15', '02:30', '02:45']) {
      expect(slot(time).kind, time).toBe('nonexistent');
      expect(slot(time).clickable, time).toBe(false);
    }
    expect(slot('03:00')).toEqual({ kind: 'busy', past: false, clickable: false });
    expect(slot('03:15')).toEqual({ kind: 'free', past: false, clickable: true });
  });

  test('ritorno all\'ora solare (25/10/2026): la riga 02:00 è la prima occorrenza', async () => {
    const mod = await weekGridModule();
    const date = '2026-10-25';
    const grid = mod.weekGrid({ dates: FALL_WEEK, tz: TZ, granularityMin: 15, bands: { [date]: NIGHT }, bookings: [] });
    const states = mod.daySlots({
      date,
      grid,
      tz: TZ,
      // 01:00 CEST → 04:00 CET
      bands: [{ startsAt: utc('2026-10-24T23:00:00Z'), endsAt: utc('2026-10-25T03:00:00Z') }],
      timeOff: [],
      closures: [],
      // 02:00–02:30 della prima occorrenza (ora legale)
      bookings: [{ status: 'confirmed', startsAt: utc('2026-10-25T00:00:00Z'), blockedUntil: utc('2026-10-25T00:30:00Z') }],
      // now fra le due righe: 02:15 della prima occorrenza è passata, 02:30 no
      now: utc('2026-10-25T00:20:00Z'),
      barberActive: true,
    });
    const slot = (time: string): SlotState => states[grid.rows.indexOf(m(time))] as SlotState;
    expect(states).toHaveLength(12);
    expect(slot('01:45')).toEqual({ kind: 'free', past: true, clickable: true });
    expect(slot('02:00')).toEqual({ kind: 'busy', past: true, clickable: false });
    expect(slot('02:15')).toEqual({ kind: 'busy', past: true, clickable: false });
    expect(slot('02:30')).toEqual({ kind: 'free', past: false, clickable: true });
    expect(slot('03:00')).toEqual({ kind: 'free', past: false, clickable: true });
  });
});

// ---------------------------------------------------------------------------
// isClosedDay – SPEC §6.1 (giorni di chiusura totale attenuati), decisione 4
// ---------------------------------------------------------------------------
describe('isClosedDay (SPEC §6.1, decisione 4)', () => {
  test('chiusura dell\'intera giornata locale → true; nessuna chiusura → false', async () => {
    const { isClosedDay } = await weekGridModule();
    const day = { startsAt: winter('2047-01-16', '00:00'), endsAt: winter('2047-01-17', '00:00') };
    expect(isClosedDay('2047-01-16', [day], TZ)).toBe(true);
    expect(isClosedDay('2047-01-16', [], TZ)).toBe(false);
    // Chiusura più ampia del giorno (dalla sera prima alla mattina dopo)
    expect(isClosedDay('2047-01-16', [{ startsAt: winter('2047-01-15', '18:00'), endsAt: winter('2047-01-17', '08:00') }], TZ)).toBe(true);
  });

  test('chiusura parziale → false (anche se manca un solo minuto)', async () => {
    const { isClosedDay } = await weekGridModule();
    expect(isClosedDay('2047-01-16', [ivw('2047-01-16', '00:00', '13:00')], TZ)).toBe(false);
    expect(isClosedDay('2047-01-16', [ivw('2047-01-16', '00:00', '23:59')], TZ)).toBe(false);
    expect(isClosedDay('2047-01-16', [{ startsAt: winter('2047-01-16', '00:01'), endsAt: winter('2047-01-17', '00:00') }], TZ)).toBe(false);
  });

  test('più chiusure contigue o sovrapposte che coprono il giorno → true; con un buco → false', async () => {
    const { isClosedDay } = await weekGridModule();
    const evening = { startsAt: winter('2047-01-16', '12:00'), endsAt: winter('2047-01-17', '00:00') };
    expect(isClosedDay('2047-01-16', [evening, ivw('2047-01-16', '00:00', '12:00')], TZ)).toBe(true);
    expect(isClosedDay('2047-01-16', [ivw('2047-01-16', '00:00', '14:00'), evening, ivw('2047-01-16', '09:00', '10:00')], TZ)).toBe(true);
    expect(isClosedDay('2047-01-16', [ivw('2047-01-16', '00:00', '11:59'), evening], TZ)).toBe(false);
  });

  test('chiusura di più giorni: true per i giorni interni, false per quelli fuori', async () => {
    const { isClosedDay } = await weekGridModule();
    // Come il seed: "Natale e Santo Stefano", qui dal 25 al 27 compreso
    const holidays = [{ startsAt: winter('2047-12-25', '00:00'), endsAt: winter('2047-12-28', '00:00') }];
    expect(isClosedDay('2047-12-24', holidays, TZ)).toBe(false);
    expect(isClosedDay('2047-12-25', holidays, TZ)).toBe(true);
    expect(isClosedDay('2047-12-26', holidays, TZ)).toBe(true);
    expect(isClosedDay('2047-12-27', holidays, TZ)).toBe(true);
    expect(isClosedDay('2047-12-28', holidays, TZ)).toBe(false);
  });

  test('giorno di 25 ore (25/10/2026): servono 25 ore reali di chiusura', async () => {
    const { isClosedDay } = await weekGridModule();
    // Mezzanotte locale del 25 = 22:00Z del 24; mezzanotte del 26 = 23:00Z del 25
    const whole = { startsAt: utc('2026-10-24T22:00:00Z'), endsAt: utc('2026-10-25T23:00:00Z') };
    const only24h = { startsAt: utc('2026-10-24T22:00:00Z'), endsAt: utc('2026-10-25T22:00:00Z') };
    expect(isClosedDay('2026-10-25', [whole], TZ)).toBe(true);
    expect(isClosedDay('2026-10-25', [only24h], TZ)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// weekDropTarget – SPEC §6.3 (trascinamento nella vista settimana), ADR 008, decisioni 2, 3, 10
// ---------------------------------------------------------------------------
describe('weekDropTarget (SPEC §6.3, decisioni 2, 3, 10)', () => {
  const setup = async () => {
    const mod = await weekGridModule();
    // Martedì–sabato 09:00–19:00: asse 09:00–19:00, 40 righe da 15 minuti
    const bands = Object.fromEntries(WEEK.slice(1, 6).map((date) => [date, [{ start: '09:00', end: '19:00' }]]));
    const grid = mod.weekGrid({ dates: WEEK, tz: TZ, granularityMin: 15, bands, bookings: [] });
    expect(grid.rows).toHaveLength(40);
    const base = {
      grid,
      tz: TZ,
      role: 'admin' as 'admin' | 'barber',
      booking: { barberId: LUCA, startsAt: winter('2047-01-16', '10:00') }, // mercoledì 10:00
      isOwn: false,
      overDate: '2047-01-16' as string | null,
      deltaRows: 0,
      now: utc('2047-01-01T00:00:00Z'),
    };
    const drop = (overrides: Partial<typeof base>) => mod.weekDropTarget({ ...base, ...overrides });
    return { drop, mod };
  };

  test('altro giorno, stessa ora (anche un giorno senza fasce)', async () => {
    const { drop } = await setup();
    expect(drop({ overDate: '2047-01-18' })).toEqual({ kind: 'move', date: '2047-01-18', startsAt: winter('2047-01-18', '10:00') });
    expect(drop({ overDate: '2047-01-14' })).toEqual({ kind: 'move', date: '2047-01-14', startsAt: winter('2047-01-14', '10:00') });
  });

  test('cambio di riga nello stesso giorno e in un altro giorno', async () => {
    const { drop } = await setup();
    expect(drop({ deltaRows: 2 })).toEqual({ kind: 'move', date: '2047-01-16', startsAt: winter('2047-01-16', '10:30') });
    expect(drop({ overDate: '2047-01-20', deltaRows: -4 })).toEqual({
      kind: 'move',
      date: '2047-01-20',
      startsAt: winter('2047-01-20', '09:00'),
    });
    // Ultima riga (18:45): ammessa; una oltre → fuori griglia
    expect(drop({ overDate: '2047-01-17', deltaRows: 35 })).toEqual({
      kind: 'move',
      date: '2047-01-17',
      startsAt: winter('2047-01-17', '18:45'),
    });
  });

  test('fuori dalla griglia, invariata o puntatore fuori dalle colonne → none', async () => {
    const { drop } = await setup();
    expect(drop({ deltaRows: -5 })).toEqual({ kind: 'none' });
    expect(drop({ overDate: '2047-01-17', deltaRows: 36 })).toEqual({ kind: 'none' });
    expect(drop({ deltaRows: 0 })).toEqual({ kind: 'none' });
    expect(drop({ overDate: null, deltaRows: 2 })).toEqual({ kind: 'none' });
  });

  test('arrivo non futuro → past (bordo: uguale a now), anche in un giorno precedente', async () => {
    const { drop } = await setup();
    const now = winter('2047-01-18', '09:00'); // venerdì 09:00
    expect(drop({ now, overDate: '2047-01-18', deltaRows: -4 })).toEqual({
      kind: 'past',
      date: '2047-01-18',
      startsAt: winter('2047-01-18', '09:00'),
    });
    expect(drop({ now, overDate: '2047-01-18', deltaRows: -3 })).toEqual({
      kind: 'move',
      date: '2047-01-18',
      startsAt: winter('2047-01-18', '09:15'),
    });
    expect(drop({ now, overDate: '2047-01-17' })).toEqual({ kind: 'past', date: '2047-01-17', startsAt: winter('2047-01-17', '10:00') });
  });

  test('prenotazione non allineata (10:05): parte dalla riga in cui è disegnata (10:00)', async () => {
    const { drop } = await setup();
    const booking = { barberId: LUCA, startsAt: winter('2047-01-16', '10:05') };
    expect(drop({ booking, deltaRows: 1 })).toEqual({ kind: 'move', date: '2047-01-16', startsAt: winter('2047-01-16', '10:15') });
    expect(drop({ booking, overDate: '2047-01-17' })).toEqual({ kind: 'move', date: '2047-01-17', startsAt: winter('2047-01-17', '10:00') });
    expect(drop({ booking, deltaRows: 0 })).toEqual({ kind: 'none' });
  });

  test('permessi come nella vista giorno: il barbiere solo le proprie, l\'admin tutte', async () => {
    const { drop } = await setup();
    const target = { kind: 'move', date: '2047-01-17', startsAt: winter('2047-01-17', '10:00') };
    expect(drop({ role: 'barber', isOwn: true, overDate: '2047-01-17' })).toEqual(target);
    expect(drop({ role: 'barber', isOwn: false, overDate: '2047-01-17' })).toEqual({ kind: 'none' });
    expect(drop({ role: 'admin', isOwn: false, overDate: '2047-01-17' })).toEqual(target);
  });

  test('passaggio all\'ora legale: arrivo su un\'ora inesistente → none; le righe vicine valgono', async () => {
    const { mod } = await setup();
    const grid = mod.weekGrid({
      dates: SPRING_WEEK,
      tz: TZ,
      granularityMin: 15,
      bands: { '2027-03-27': NIGHT, '2027-03-28': NIGHT },
      bookings: [],
    });
    const base = {
      grid,
      tz: TZ,
      role: 'admin' as const,
      booking: { barberId: LUCA, startsAt: utc('2027-03-27T01:00:00Z') }, // sabato 02:00 CET
      isOwn: false,
      now: utc('2027-01-01T00:00:00Z'),
    };
    expect(mod.weekDropTarget({ ...base, overDate: '2027-03-28', deltaRows: 0 })).toEqual({ kind: 'none' });
    expect(mod.weekDropTarget({ ...base, overDate: '2027-03-28', deltaRows: 3 })).toEqual({ kind: 'none' });
    expect(mod.weekDropTarget({ ...base, overDate: '2027-03-28', deltaRows: 4 })).toEqual({
      kind: 'move',
      date: '2027-03-28',
      startsAt: utc('2027-03-28T01:00:00Z'),
    });
    expect(mod.weekDropTarget({ ...base, overDate: '2027-03-28', deltaRows: -1 })).toEqual({
      kind: 'move',
      date: '2027-03-28',
      startsAt: utc('2027-03-28T00:45:00Z'),
    });
  });

  test('ritorno all\'ora solare: arrivo sulla riga 02:00 del 25/10/2026 → prima occorrenza', async () => {
    const { mod } = await setup();
    const grid = mod.weekGrid({
      dates: FALL_WEEK,
      tz: TZ,
      granularityMin: 15,
      bands: { '2026-10-24': NIGHT, '2026-10-25': NIGHT },
      bookings: [],
    });
    expect(
      mod.weekDropTarget({
        grid,
        tz: TZ,
        role: 'admin',
        booking: { barberId: LUCA, startsAt: utc('2026-10-24T00:00:00Z') }, // sabato 02:00 CEST
        isOwn: false,
        overDate: '2026-10-25',
        deltaRows: 0,
        now: utc('2026-01-01T00:00:00Z'),
      }),
    ).toEqual({ kind: 'move', date: '2026-10-25', startsAt: utc('2026-10-25T00:00:00Z') });
  });
});
