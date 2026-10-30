// modificato in fetta 8g con l'approvazione dell'utente (2026-10-30, audit punto 6): casi portati su slotsByDay,
// tolti i test di availableDays e pickBarber e di "qualsiasi" = unione.
// Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità").
// Motore puro in src/lib/availability/ (CLAUDE.md, regola di dominio 5): nessun I/O, `now` in input.
// Sezioni: SPEC §4 (passi 1–5, "qualsiasi barbiere", assegnazione), §3.1 (impostazioni),
// §3.7.1–2 (buffer, fascia, assenze, chiusure, anticipo, orizzonte), §12 (casi limite) +
// decisioni approvate per la fetta 4 (regole 1–7).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese (esportate da src/lib/availability/index.ts)
// ---------------------------------------------------------------------------
type Interval = { start: Date; end: Date };
type BarberAvailabilityInput = {
  barberId: string;
  /** Fasce di lavoro già convertite in istanti concreti (dalla funzione SQL availability_inputs). */
  work: Interval[];
  timeOff: Interval[];
  /** Prenotazioni confirmed: [starts_at, blocked_until), buffer copiato incluso. */
  busy: Interval[];
};
type AvailabilityInput = {
  timezone: string;
  now: Date;
  settings: {
    slotGranularityMin: number;
    minAdvanceMin: number;
    maxHorizonDays: number;
    /** buffer_min corrente: vale solo per il nuovo slot. */
    bufferMin: number;
  };
  serviceDurationMin: number;
  closures: Interval[];
  barbers: BarberAvailabilityInput[];
};
type AvailabilityModule = {
  /** Slot di ogni barbiere nel giorno locale `date` (YYYY-MM-DD): una chiave per ogni barbiere in input. */
  computeSlotsByBarber: (input: AvailabilityInput, date: string) => Record<string, Date[]>;
  /** Per ogni giorno locale in [from, to] (inclusi) un elemento per barbiere in input. */
  slotsByDay: (input: AvailabilityInput, from: string, to: string) => Record<string, Array<{ barberId: string; slots: Date[] }>>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

let engine: AvailabilityModule;
let loadError: unknown = null;
beforeAll(async () => {
  try {
    engine = await load<AvailabilityModule>('@/lib/availability');
  } catch (error) {
    loadError = error;
  }
});
// Modulo mancante: ogni test fallisce (non viene saltato)
beforeEach(() => {
  if (loadError) throw loadError;
});

// ---------------------------------------------------------------------------
// Utilità dei test
// ---------------------------------------------------------------------------
const TZ = 'Europe/Rome';
const B1 = 'b4000000-0000-4000-8000-000000000001';
const B2 = 'b4000000-0000-4000-8000-000000000002';

/** Istante dell'ora locale del negozio (solo per orari non ambigui). */
const at = (date: string, time: string): Date => fromZonedTime(`${date}T${time}:00`, TZ);
const iv = (date: string, from: string, to: string): Interval => ({ start: at(date, from), end: at(date, to) });
const utc = (iso: string): Date => new Date(iso);
const hhmm = (dates: Date[]): string[] => dates.map((d) => formatInTimeZone(d, TZ, 'HH:mm'));
const iso = (dates: Date[]): string[] => dates.map((d) => d.toISOString());

const DAY = '2027-03-02'; // martedì, ora solare (+01:00)

type Overrides = Partial<Omit<AvailabilityInput, 'settings'>> & {
  settings?: Partial<AvailabilityInput['settings']>;
};
function input(over: Overrides = {}): AvailabilityInput {
  const { settings, ...rest } = over;
  return {
    timezone: TZ,
    now: at('2027-03-01', '08:00'),
    serviceDurationMin: 30,
    closures: [],
    barbers: [{ barberId: B1, work: [], timeOff: [], busy: [] }],
    ...rest,
    settings: { slotGranularityMin: 15, minAdvanceMin: 60, maxHorizonDays: 30, bufferMin: 0, ...settings },
  };
}
const barber = (b: Partial<BarberAvailabilityInput> = {}): BarberAvailabilityInput => ({
  barberId: B1,
  work: [],
  timeOff: [],
  busy: [],
  ...b,
});
/** Orari del giorno di tutti i barbieri in input (con un barbiere: i suoi). */
const slotsOn = (inp: AvailabilityInput, date: string): Date[] =>
  (engine.slotsByDay(inp, date, date)[date] ?? []).flatMap((b) => b.slots);
const slotsOf = (over: Overrides, date = DAY) => hhmm(slotsOn(input(over), date));
/** Giorni locali in [from, to] con almeno un orario, in ordine. */
const daysWithSlots = (inp: AvailabilityInput, from: string, to: string): string[] =>
  Object.entries(engine.slotsByDay(inp, from, to))
    .filter(([, barbers]) => barbers.some((b) => b.slots.length > 0))
    .map(([date]) => date);

// ---------------------------------------------------------------------------
// Griglia (SPEC §4.4, regola 1)
// ---------------------------------------------------------------------------
describe('SPEC §4.4 – griglia degli orari', () => {
  test('passo 15: ammesso lo slot che finisce esattamente a fine fascia', () => {
    expect(slotsOf({ barbers: [barber({ work: [iv(DAY, '09:00', '10:00')] })] })).toEqual([
      '09:00', '09:15', '09:30',
    ]);
  });

  test('regola 1: griglia allineata all\'orologio locale, non alla fine della prenotazione precedente', () => {
    const slots = slotsOf({
      barbers: [barber({ work: [iv(DAY, '09:00', '11:30')], busy: [iv(DAY, '09:00', '10:20')] })],
    });
    expect(slots).toEqual(['10:30', '10:45', '11:00']);
  });

  test('regola 1: fascia che inizia fuori griglia → primo slot al multiplo successivo', () => {
    expect(slotsOf({ barbers: [barber({ work: [iv(DAY, '09:10', '10:00')] })] })).toEqual(['09:15', '09:30']);
  });

  test('SPEC §12 – granularità 5', () => {
    const slots = slotsOf({
      settings: { slotGranularityMin: 5 },
      serviceDurationMin: 20,
      barbers: [barber({ work: [iv(DAY, '09:00', '09:30')] })],
    });
    expect(slots).toEqual(['09:00', '09:05', '09:10']);
  });

  test('SPEC §12 – granularità 60: solo ore piene locali', () => {
    const slots = slotsOf({
      settings: { slotGranularityMin: 60 },
      barbers: [barber({ work: [iv(DAY, '09:30', '12:00')] })],
    });
    expect(slots).toEqual(['10:00', '11:00']);
  });
});

// ---------------------------------------------------------------------------
// Fasce, assenze, chiusure (SPEC §4.1–2, §3.7.2, §12)
// ---------------------------------------------------------------------------
describe('SPEC §4.1–2 – fasce, assenze e chiusure', () => {
  test('SPEC §12 – servizio che finirebbe nella pausa pranzo o oltre la chiusura', () => {
    const slots = slotsOf({
      serviceDurationMin: 45,
      barbers: [barber({ work: [iv(DAY, '09:00', '13:00'), iv(DAY, '15:00', '19:30')] })],
    });
    expect(slots).toContain('12:15');
    expect(slots.filter((s) => s > '12:15' && s < '15:00')).toEqual([]);
    expect(slots).toContain('15:00');
    expect(slots).toContain('18:45');
    expect(slots.filter((s) => s > '18:45')).toEqual([]);
  });

  test('SPEC §12 – assenza parziale a metà mattina', () => {
    const slots = slotsOf({
      barbers: [barber({ work: [iv(DAY, '09:00', '13:00')], timeOff: [iv(DAY, '10:00', '11:00')] })],
    });
    expect(slots).toContain('09:30');
    expect(slots.filter((s) => s > '09:30' && s < '11:00')).toEqual([]);
    expect(slots).toContain('11:00');
  });

  test('chiusura del negozio per tutto il giorno → nessuno slot per nessun barbiere', () => {
    const slots = slotsOf({
      closures: [{ start: at(DAY, '00:00'), end: at('2027-03-03', '00:00') }],
      barbers: [
        barber({ work: [iv(DAY, '09:00', '13:00')] }),
        barber({ barberId: B2, work: [iv(DAY, '09:00', '13:00')] }),
      ],
    });
    expect(slots).toEqual([]);
  });

  test('chiusura parziale: il servizio deve finire prima dell\'inizio della chiusura', () => {
    const slots = slotsOf({
      closures: [iv(DAY, '12:00', '13:00')],
      barbers: [barber({ work: [iv(DAY, '09:00', '13:00')] })],
    });
    expect(slots[slots.length - 1]).toBe('11:30');
  });

  test('regola 5: occupano solo i busy ricevuti (gli slot fuori dai busy restano)', () => {
    const slots = slotsOf({
      barbers: [barber({ work: [iv(DAY, '09:00', '10:00')], busy: [iv(DAY, '09:00', '09:30')] })],
    });
    expect(slots).toEqual(['09:30']);
  });
});

// ---------------------------------------------------------------------------
// Buffer (SPEC §3.1, §3.7.1, §4.3–4, §12, regola 2)
// ---------------------------------------------------------------------------
describe('SPEC §12 – buffer > 0 tra appuntamenti consecutivi', () => {
  test('la prenotazione esistente occupa fino a blocked_until (buffer copiato), non fino al buffer corrente', () => {
    // 09:00–09:30 + buffer copiato di 15' → blocked_until 09:45; buffer corrente 0
    const slots = slotsOf({
      barbers: [barber({ work: [iv(DAY, '09:00', '11:00')], busy: [iv(DAY, '09:00', '09:45')] })],
    });
    expect(slots[0]).toBe('09:45');
  });

  test('il nuovo slot richiede inizio + durata + buffer corrente libero prima della prenotazione successiva', () => {
    const slots = slotsOf({
      settings: { bufferMin: 10 },
      barbers: [barber({ work: [iv(DAY, '09:00', '13:00')], busy: [iv(DAY, '11:00', '11:30')] })],
    });
    expect(slots).toContain('10:15'); // 10:45 + 10' = 10:55 ≤ 11:00
    expect(slots).not.toContain('10:30'); // 11:00 + 10' > 11:00
    expect(slots).toContain('11:30');
  });

  test('nessuna pausa dopo l\'ultimo appuntamento: a fine fascia e prima di assenze o chiusure basta la durata', () => {
    const slots = slotsOf({
      settings: { bufferMin: 10 },
      closures: [iv(DAY, '18:00', '20:00')],
      barbers: [
        barber({
          work: [iv(DAY, '09:00', '13:00'), iv(DAY, '15:00', '19:00')],
          timeOff: [iv(DAY, '10:00', '11:00')],
        }),
      ],
    });
    expect(slots).toContain('09:30'); // finisce alle 10:00, inizio dell'assenza
    expect(slots).toContain('12:30'); // finisce alle 13:00, fine fascia
    expect(slots).toContain('17:30'); // finisce alle 18:00, inizio della chiusura
  });
});

// ---------------------------------------------------------------------------
// Anticipo e orizzonte (SPEC §4.5, §12, regola 3)
// ---------------------------------------------------------------------------
describe('SPEC §4.5 – anticipo minimo e orizzonte massimo', () => {
  const work = [barber({ work: [iv(DAY, '09:00', '12:00')] })];

  test('anticipo: bordo incluso (inizio = now + min_advance_min)', () => {
    expect(slotsOf({ now: at(DAY, '08:00'), barbers: work })[0]).toBe('09:00');
  });

  test('anticipo: un minuto dopo il bordo lo slot è escluso', () => {
    expect(slotsOf({ now: at(DAY, '08:01'), barbers: work })[0]).toBe('09:15');
  });

  test('anticipo 0: gli slot restano sulla griglia e non partono dal passato', () => {
    expect(slotsOf({ now: at(DAY, '09:07'), settings: { minAdvanceMin: 0 }, barbers: work })[0]).toBe('09:15');
  });

  // Decisione utente: l'orizzonte vale per l'INIZIO dello slot
  test('orizzonte: ammesso l\'inizio fino alla fine della giornata locale di oggi + max_horizon_days', () => {
    const over: Overrides = {
      now: at('2027-03-01', '22:30'),
      settings: { maxHorizonDays: 2 },
      barbers: [
        barber({
          // fascia che attraversa la mezzanotte dell'ultimo giorno ammesso
          work: [{ start: at('2027-03-03', '09:00'), end: at('2027-03-04', '01:00') }, iv('2027-03-04', '09:00', '12:00')],
        }),
      ],
    };
    const lastDay = slotsOf(over, '2027-03-03');
    expect(lastDay[0]).toBe('09:00');
    expect(lastDay).toContain('23:30'); // inizia nell'ultimo giorno, finisce alle 00:00 del giorno dopo
    expect(lastDay[lastDay.length - 1]).toBe('23:45');
    expect(slotsOf(over, '2027-03-04')).toEqual([]);
  });

  test('un giorno passato non ha slot', () => {
    expect(slotsOf({ now: at('2027-03-05', '08:00'), barbers: work })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ora legale (SPEC §4.1, §12, regola 4): giorni locali di 23 e 25 ore
// ---------------------------------------------------------------------------
describe('SPEC §12 – cambio ora legale e solare', () => {
  test('ora legale (28/03/2027, giorno di 23 ore): fascia notturna accorciata e confini del giorno', () => {
    const over: Overrides = {
      now: at('2027-03-20', '08:00'),
      settings: { slotGranularityMin: 60 },
      serviceDurationMin: 60,
      barbers: [
        barber({
          work: [
            // 28/03 00:00–05:00 locali: 4 ore reali (02:00 → 03:00)
            { start: utc('2027-03-27T23:00:00Z'), end: utc('2027-03-28T03:00:00Z') },
            // 28/03 09:00–13:00 locali (+02:00)
            { start: utc('2027-03-28T07:00:00Z'), end: utc('2027-03-28T11:00:00Z') },
            // 29/03 00:00–01:00 locali: appartiene al 29, non al 28
            { start: utc('2027-03-28T22:00:00Z'), end: utc('2027-03-28T23:00:00Z') },
          ],
        }),
      ],
    };
    expect(iso(slotsOn(input(over), '2027-03-28'))).toEqual([
      '2027-03-27T23:00:00.000Z', // 00:00
      '2027-03-28T00:00:00.000Z', // 01:00
      '2027-03-28T01:00:00.000Z', // 03:00
      '2027-03-28T02:00:00.000Z', // 04:00
      '2027-03-28T07:00:00.000Z', // 09:00
      '2027-03-28T08:00:00.000Z',
      '2027-03-28T09:00:00.000Z',
      '2027-03-28T10:00:00.000Z', // 12:00
    ]);
    expect(iso(slotsOn(input(over), '2027-03-29'))).toEqual(['2027-03-28T22:00:00.000Z']);
    expect(iso(slotsOn(input(over), '2027-03-27'))).toEqual([]);
  });

  test('ora solare (31/10/2027, giorno di 25 ore): fascia notturna allungata, le 02:00 due volte', () => {
    const over: Overrides = {
      now: at('2027-10-25', '08:00'),
      settings: { slotGranularityMin: 60 },
      serviceDurationMin: 60,
      barbers: [
        barber({
          // 31/10 00:00–05:00 locali: 6 ore reali
          work: [{ start: utc('2027-10-30T22:00:00Z'), end: utc('2027-10-31T04:00:00Z') }],
        }),
      ],
    };
    expect(iso(slotsOn(input(over), '2027-10-31'))).toEqual([
      '2027-10-30T22:00:00.000Z', // 00:00 (+02)
      '2027-10-30T23:00:00.000Z', // 01:00 (+02)
      '2027-10-31T00:00:00.000Z', // 02:00 (+02)
      '2027-10-31T01:00:00.000Z', // 02:00 (+01)
      '2027-10-31T02:00:00.000Z', // 03:00
      '2027-10-31T03:00:00.000Z', // 04:00
    ]);
  });

  test('ora solare: le 23:00 locali del 31/10 appartengono al 31, non al 1/11', () => {
    const over: Overrides = {
      now: at('2027-10-25', '08:00'),
      // 31/10 23:00–23:45 locali (+01:00)
      barbers: [barber({ work: [{ start: utc('2027-10-31T22:00:00Z'), end: utc('2027-10-31T22:45:00Z') }] })],
    };
    expect(iso(slotsOn(input(over), '2027-10-31'))).toEqual([
      '2027-10-31T22:00:00.000Z',
      '2027-10-31T22:15:00.000Z',
    ]);
    expect(iso(slotsOn(input(over), '2027-11-01'))).toEqual([]);
  });

  test('slotsByDay attraverso i cambi d\'ora usa i giorni locali', () => {
    const autumn = input({
      now: at('2027-10-25', '08:00'),
      barbers: [
        barber({
          work: [iv('2027-10-30', '09:00', '10:00'), { start: utc('2027-10-31T22:00:00Z'), end: utc('2027-10-31T22:45:00Z') }],
        }),
      ],
    });
    expect(daysWithSlots(autumn, '2027-10-29', '2027-11-01')).toEqual(['2027-10-30', '2027-10-31']);

    const spring = input({
      now: at('2027-03-20', '08:00'),
      barbers: [barber({ work: [{ start: utc('2027-03-28T22:00:00Z'), end: utc('2027-03-28T23:00:00Z') }] })],
    });
    expect(daysWithSlots(spring, '2027-03-27', '2027-03-29')).toEqual(['2027-03-29']);
  });
});

// ---------------------------------------------------------------------------
// Più barbieri e giorni (SPEC §4 "qualsiasi barbiere", regola 6)
// ---------------------------------------------------------------------------
describe('SPEC §4 – più barbieri e giorni disponibili', () => {
  test('computeSlotsByBarber: slot per barbiere, chiave anche per chi non ha slot', () => {
    const byBarber = engine.computeSlotsByBarber(
      input({
        barbers: [
          barber({ work: [iv(DAY, '09:00', '10:00')], busy: [iv(DAY, '09:00', '09:30')] }),
          barber({ barberId: B2 }),
        ],
      }),
      DAY,
    );
    expect(Object.keys(byBarber).sort()).toEqual([B1, B2]);
    expect(hhmm(byBarber[B1])).toEqual(['09:30']);
    expect(byBarber[B2]).toEqual([]);
  });

  test('slotsByDay: date locali inclusive, solo i giorni con slot hanno orari, in ordine', () => {
    const days = daysWithSlots(
      input({
        barbers: [
          barber({
            work: [
              iv('2027-03-02', '09:00', '10:00'),
              iv('2027-03-03', '09:00', '09:30'),
              iv('2027-03-05', '18:00', '19:00'),
            ],
            busy: [iv('2027-03-03', '09:00', '09:30')],
          }),
        ],
      }),
      '2027-03-01',
      '2027-03-05',
    );
    expect(days).toEqual(['2027-03-02', '2027-03-05']);
  });
});
