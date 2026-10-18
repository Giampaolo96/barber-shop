// Test di accettazione – FETTA 8e (SPEC §11: "Prenotazione da telefono: servizio → quando → conferma").
// Regole: SPEC §5.2 passo 2 ("Quando?": striscia dei giorni, giorni chiusi e senza posti, giorno
// iniziale, "Primo libero", sezioni per barbiere e loro ordine, Mattina/Pomeriggio, prossimo orario
// libero, vecchi URL), §4 (motore e regola di "qualsiasi barbiere"), §3.1 (max_horizon_days),
// §9 (testi in italiano), CLAUDE.md regole 2, 5, 6 e Sicurezza (Zod, solo orari in uscita) +
// decisioni approvate per la fetta 8e (docs/PROGRESS.md, "Fetta 8e").
//
// Interfacce attese:
//   src/lib/availability (export da index.ts, funzioni pure, `now` in input):
//     type DayStatus = { date: string; status: "closed" | "full" | "open" }
//     dayStatuses(input: AvailabilityInput, from: string, to: string): DayStatus[]
//       un elemento per giorno locale in [from, to]; "closed" = nessun barbiere ha lavoro − chiusure −
//       assenze quel giorno (indipendente da prenotazioni e da now); "open" = almeno uno slot
//       (computeSlots); altrimenti "full".
//     nextSlotByBarber(input, afterDate: string, to: string): Record<string, Date | null>
//       per ogni barbiere dell'input il primo slot nei giorni locali dopo afterDate fino a `to` incluso.
//     firstFree(input, date: string, preferredBarberIds: string[]): { barberId: string; startsAt: Date } | null
//       primo orario del giorno fra tutti i barbieri; a parità il primo preferito libero a quell'ora,
//       altrimenti pickBarber con conteggi = intervalli busy che iniziano quel giorno locale per barbiere.
//   src/lib/booking/when.ts (puro, nessun I/O):
//     orderBarbers<T extends { id: string; name: string }>(barbers: T[], opts: { preferredId?: string | null; recentId?: string | null }): T[]
//     recentBarberId(bookings: Array<{ barberId: string | null; startsAt: string; status: string }>, now: Date): string | null
//     splitByPeriod(slots: string[], timezone: string): { morning: string[]; afternoon: string[] }
//     initialDay(days: DayStatus[], requested?: string | null): string | null
//     formatSlotTime(iso: string, timezone: string): string          ("9:30")
//     formatNextFree(iso: string, timezone: string): string          ("mar 20, 9:30")
//   src/lib/booking/paths.ts:
//     BOOK_WHEN_PATH = "/prenota/quando"
//     whenStepUrl(serviceId: string, opts?: { day?: string; barberId?: string }): string
//     legacyWhenUrl(params: Record<string, string | undefined>): string   (vecchi /prenota/barbiere e /prenota/orario)
//   src/lib/booking/availability-actions.ts ("use server"):
//     fetchWhenDay({ serviceId, date, barberId? }) →
//       { ok: true; date: string; firstFree: { barberId: string; startsAt: string } | null;
//         barbers: Array<{ barberId: string; slots: string[]; next: string | null }> }
//       | { ok: false; error: "invalid" | "error" }
//     input validato con Zod, una sola chiamata ad availability_inputs per richiesta.
//   src/i18n/it.ts, it.booking.when: title, firstFree, slotLabel, morning, afternoon, noSlots,
//     nextFree, preferred, dayClosed (valori sotto).
//
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromZonedTime } from 'date-fns-tz';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese
// ---------------------------------------------------------------------------
type Interval = { start: Date; end: Date };
type BarberAvailabilityInput = { barberId: string; work: Interval[]; timeOff: Interval[]; busy: Interval[] };
type AvailabilityInput = {
  timezone: string;
  now: Date;
  settings: { slotGranularityMin: number; minAdvanceMin: number; maxHorizonDays: number; bufferMin: number };
  serviceDurationMin: number;
  closures: Interval[];
  barbers: BarberAvailabilityInput[];
};
type DayStatus = { date: string; status: 'closed' | 'full' | 'open' };

type EngineModule = {
  computeSlotsByBarber: (input: AvailabilityInput, date: string) => Record<string, Date[]>;
  pickBarber: (input: AvailabilityInput, start: Date, bookingCounts: Record<string, number>) => string | null;
  dayStatuses: (input: AvailabilityInput, from: string, to: string) => DayStatus[];
  nextSlotByBarber: (input: AvailabilityInput, afterDate: string, to: string) => Record<string, Date | null>;
  firstFree: (
    input: AvailabilityInput,
    date: string,
    preferredBarberIds: string[],
  ) => { barberId: string; startsAt: Date } | null;
};

type WhenModule = {
  orderBarbers: <T extends { id: string; name: string }>(
    barbers: T[],
    opts: { preferredId?: string | null; recentId?: string | null },
  ) => T[];
  recentBarberId: (
    bookings: Array<{ barberId: string | null; startsAt: string; status: string }>,
    now: Date,
  ) => string | null;
  splitByPeriod: (slots: string[], timezone: string) => { morning: string[]; afternoon: string[] };
  initialDay: (days: DayStatus[], requested?: string | null) => string | null;
  formatSlotTime: (iso: string, timezone: string) => string;
  formatNextFree: (iso: string, timezone: string) => string;
};

type PathsModule = {
  BOOK_WHEN_PATH: string;
  whenStepUrl: (serviceId: string, opts?: { day?: string; barberId?: string }) => string;
  legacyWhenUrl: (params: Record<string, string | undefined>) => string;
};

type WhenDayResult =
  | {
      ok: true;
      date: string;
      firstFree: { barberId: string; startsAt: string } | null;
      barbers: Array<{ barberId: string; slots: string[]; next: string | null }>;
    }
  | { ok: false; error: 'invalid' | 'error' };
type ActionsModule = {
  fetchWhenDay: (args: { serviceId: string; date: string; barberId?: string }) => Promise<WhenDayResult>;
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

let engine: EngineModule;
let when: WhenModule;
let paths: PathsModule;
const loadErrors: Record<string, unknown> = {};
beforeAll(async () => {
  const tryLoad = async <T>(key: string, specifier: string): Promise<T | undefined> => {
    try {
      return await load<T>(specifier);
    } catch (error) {
      loadErrors[key] = error;
      return undefined;
    }
  };
  engine = (await tryLoad<EngineModule>('engine', '@/lib/availability')) as EngineModule;
  when = (await tryLoad<WhenModule>('when', '@/lib/booking/when')) as WhenModule;
  paths = (await tryLoad<PathsModule>('paths', '@/lib/booking/paths')) as PathsModule;
});
/** Modulo mancante o funzione non esportata: il test fallisce (non viene saltato). */
const need = (key: 'engine' | 'when' | 'paths', fn?: string): void => {
  if (loadErrors[key]) throw loadErrors[key];
  if (fn) {
    const mod = { engine, when, paths }[key] as unknown as Record<string, unknown>;
    expect(mod[fn], `export mancante: ${fn}`).toBeTypeOf('function');
  }
};

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------
const TZ = 'Europe/Rome';
const B1 = 'b8e00000-0000-4000-8000-000000000001';
const B2 = 'b8e00000-0000-4000-8000-000000000002';
const B3 = 'b8e00000-0000-4000-8000-000000000003';

const at = (date: string, time: string): Date => fromZonedTime(`${date}T${time}:00`, TZ);
const iv = (date: string, from: string, to: string): Interval => ({ start: at(date, from), end: at(date, to) });
/** Giornata locale intera [00:00, 00:00 del giorno dopo). */
const wholeDay = (date: string, next: string): Interval => ({ start: at(date, '00:00'), end: at(next, '00:00') });

const barber = (barberId: string, b: Partial<Omit<BarberAvailabilityInput, 'barberId'>> = {}): BarberAvailabilityInput => ({
  barberId,
  work: [],
  timeOff: [],
  busy: [],
  ...b,
});

type Overrides = Partial<Omit<AvailabilityInput, 'settings'>> & { settings?: Partial<AvailabilityInput['settings']> };
const input = (over: Overrides = {}): AvailabilityInput => {
  const { settings, ...rest } = over;
  return {
    timezone: TZ,
    // lunedì 1 marzo 2027, 08:00 locali (ora solare, +01:00)
    now: at('2027-03-01', '08:00'),
    serviceDurationMin: 30,
    closures: [],
    barbers: [barber(B1)],
    ...rest,
    settings: { slotGranularityMin: 15, minAdvanceMin: 60, maxHorizonDays: 30, bufferMin: 0, ...settings },
  };
};

// ---------------------------------------------------------------------------
// dayStatuses – SPEC §5.2: giorno chiuso / senza posti / con orari
// ---------------------------------------------------------------------------
describe('dayStatuses – SPEC §5.2: striscia dei giorni, "chiuso" e "senza posti"', () => {
  test('un elemento per ogni giorno locale in [from, to], in ordine, con la data YYYY-MM-DD', () => {
    need('engine', 'dayStatuses');
    const result = engine.dayStatuses(input(), '2027-03-02', '2027-03-06');
    expect(result.map((d) => d.date)).toEqual(['2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06']);
    // nessun barbiere ha fasce: tutti chiusi
    expect(result.every((d) => d.status === 'closed')).toBe(true);
  });

  test('con slot → open; giorno senza fasce → closed; assenza di tutta la giornata → closed; chiusura del negozio → closed; tutto prenotato → full', () => {
    need('engine', 'dayStatuses');
    const result = engine.dayStatuses(
      input({
        barbers: [
          barber(B1, {
            work: [
              iv('2027-03-02', '09:00', '12:00'), // open
              // 03/03: nessuna fascia → closed
              iv('2027-03-04', '09:00', '12:00'), // assenza di tutto il giorno → closed
              iv('2027-03-05', '09:00', '12:00'), // chiusura del negozio → closed
              iv('2027-03-06', '09:00', '10:00'), // tutto prenotato → full
            ],
            timeOff: [wholeDay('2027-03-04', '2027-03-05')],
            busy: [iv('2027-03-06', '09:00', '10:00')],
          }),
        ],
        closures: [wholeDay('2027-03-05', '2027-03-06')],
      }),
      '2027-03-02',
      '2027-03-06',
    );
    expect(result).toEqual([
      { date: '2027-03-02', status: 'open' },
      { date: '2027-03-03', status: 'closed' },
      { date: '2027-03-04', status: 'closed' },
      { date: '2027-03-05', status: 'closed' },
      { date: '2027-03-06', status: 'full' },
    ]);
  });

  test('assenza di tutta la giornata di tutti i barbieri → closed; se uno solo è assente e l\'altro lavora → open', () => {
    need('engine', 'dayStatuses');
    const work = [iv('2027-03-02', '09:00', '12:00'), iv('2027-03-03', '09:00', '12:00')];
    const result = engine.dayStatuses(
      input({
        barbers: [
          barber(B1, { work, timeOff: [wholeDay('2027-03-02', '2027-03-03'), wholeDay('2027-03-03', '2027-03-04')] }),
          barber(B2, { work, timeOff: [wholeDay('2027-03-02', '2027-03-03')] }),
        ],
      }),
      '2027-03-02',
      '2027-03-03',
    );
    expect(result).toEqual([
      { date: '2027-03-02', status: 'closed' },
      { date: '2027-03-03', status: 'open' },
    ]);
  });

  test('oggi con fasce già passate o dentro l\'anticipo minimo → full, non closed (indipendente da now)', () => {
    need('engine', 'dayStatuses');
    // now = 01/03 08:00, anticipo 60': la fascia 06:00–07:00 è passata, 07:00–08:30 cade nell'anticipo
    const result = engine.dayStatuses(
      input({ barbers: [barber(B1, { work: [iv('2027-03-01', '06:00', '07:00'), iv('2027-03-01', '07:00', '08:30')] })] }),
      '2027-03-01',
      '2027-03-01',
    );
    expect(result).toEqual([{ date: '2027-03-01', status: 'full' }]);
  });

  test('assenza parziale (SPEC §12) che lascia ore di lavoro ma nessuno slot → full', () => {
    need('engine', 'dayStatuses');
    // Fascia 09:00–10:00, assenza 09:20–10:00: restano 20', meno della durata del servizio (30')
    const result = engine.dayStatuses(
      input({
        barbers: [barber(B1, { work: [iv('2027-03-02', '09:00', '10:00')], timeOff: [iv('2027-03-02', '09:20', '10:00')] })],
      }),
      '2027-03-02',
      '2027-03-02',
    );
    expect(result).toEqual([{ date: '2027-03-02', status: 'full' }]);
  });
});

// ---------------------------------------------------------------------------
// nextSlotByBarber – SPEC §5.2: "prossimo: mar 20, 9:30"
// ---------------------------------------------------------------------------
describe('nextSlotByBarber – SPEC §5.2: prossimo orario libero nei giorni successivi', () => {
  test('salta il giorno selezionato, trova il primo giorno successivo, null se nulla entro `to`; barbieri indipendenti', () => {
    need('engine', 'nextSlotByBarber');
    const result = engine.nextSlotByBarber(
      input({
        barbers: [
          // ha orari anche il 02/03 (giorno selezionato): non contano
          barber(B1, { work: [iv('2027-03-02', '09:00', '12:00'), iv('2027-03-04', '10:00', '12:00')] }),
          // il primo slot del 03/03 è preso: vale il secondo
          barber(B2, { work: [iv('2027-03-03', '09:00', '12:00')], busy: [iv('2027-03-03', '09:00', '09:30')] }),
          // lavora solo dopo `to`
          barber(B3, { work: [iv('2027-03-06', '09:00', '12:00')] }),
        ],
      }),
      '2027-03-02',
      '2027-03-05',
    );
    expect(Object.keys(result).sort()).toEqual([B1, B2, B3].sort());
    expect(result[B1]?.toISOString()).toBe(at('2027-03-04', '10:00').toISOString());
    expect(result[B2]?.toISOString()).toBe(at('2027-03-03', '09:30').toISOString());
    expect(result[B3]).toBeNull();
  });

  test('`to` è incluso', () => {
    need('engine', 'nextSlotByBarber');
    const result = engine.nextSlotByBarber(
      input({ barbers: [barber(B1, { work: [iv('2027-03-05', '15:00', '16:00')] })] }),
      '2027-03-02',
      '2027-03-05',
    );
    expect(result[B1]?.toISOString()).toBe(at('2027-03-05', '15:00').toISOString());
  });
});

// ---------------------------------------------------------------------------
// firstFree – SPEC §5.2 "Primo libero", §4 (regola di "qualsiasi barbiere")
// ---------------------------------------------------------------------------
describe('firstFree – SPEC §5.2 "Primo libero" e §4', () => {
  const DAY = '2027-03-02';

  test('primo orario del giorno fra tutti i barbieri, anche se il preferito ha un orario più tardi', () => {
    need('engine', 'firstFree');
    const result = engine.firstFree(
      input({
        barbers: [barber(B1, { work: [iv(DAY, '09:30', '12:00')] }), barber(B2, { work: [iv(DAY, '09:00', '12:00')] })],
      }),
      DAY,
      [B1],
    );
    expect(result).toEqual({ barberId: B2, startsAt: at(DAY, '09:00') });
  });

  test('parità al primo orario: vince il preferito se è libero a quell\'ora (qualunque sia l\'ordine in input)', () => {
    need('engine', 'firstFree');
    const data = input({
      barbers: [barber(B1, { work: [iv(DAY, '09:00', '12:00')] }), barber(B2, { work: [iv(DAY, '09:00', '12:00')] })],
    });
    expect(engine.firstFree(data, DAY, [B1])).toEqual({ barberId: B1, startsAt: at(DAY, '09:00') });
    expect(engine.firstFree(data, DAY, [B2])).toEqual({ barberId: B2, startsAt: at(DAY, '09:00') });
  });

  test('preferiti in ordine (URL, poi ultimo appuntamento): il primo non libero a quell\'ora si salta, vince il successivo libero', () => {
    need('engine', 'firstFree');
    const data = input({
      barbers: [
        barber(B1, { work: [iv(DAY, '09:00', '12:00')] }),
        barber(B2, { work: [iv(DAY, '09:00', '12:00')] }),
        barber(B3, { work: [iv(DAY, '09:00', '12:00')], busy: [iv(DAY, '09:00', '09:30')] }),
      ],
    });
    expect(engine.firstFree(data, DAY, [B3, B2])).toEqual({ barberId: B2, startsAt: at(DAY, '09:00') });
  });

  test('preferito non libero: pickBarber con conteggi = prenotazioni (busy) che iniziano quel giorno locale', () => {
    need('engine', 'firstFree');
    const data = input({
      barbers: [
        // 2 prenotazioni nel giorno
        barber(B1, { work: [iv(DAY, '09:00', '18:00')], busy: [iv(DAY, '15:00', '15:30'), iv(DAY, '16:00', '16:30')] }),
        // 0 nel giorno, 3 il giorno prima (non contano)
        barber(B2, {
          work: [iv(DAY, '09:00', '18:00'), iv('2027-03-01', '10:00', '18:00')],
          busy: [iv('2027-03-01', '10:00', '10:30'), iv('2027-03-01', '11:00', '11:30'), iv('2027-03-01', '12:00', '12:30')],
        }),
        // preferito, occupato alle 9:00
        barber(B3, { work: [iv(DAY, '09:00', '18:00')], busy: [iv(DAY, '09:00', '09:30')] }),
      ],
    });
    const result = engine.firstFree(data, DAY, [B3]);
    expect(result).toEqual({ barberId: B2, startsAt: at(DAY, '09:00') });
    expect(result?.barberId).toBe(engine.pickBarber(data, at(DAY, '09:00'), { [B1]: 2, [B2]: 0, [B3]: 1 }));
  });

  test('senza preferiti, parità: stesso esito di pickBarber (a parità di conteggi il criterio deterministico di §4)', () => {
    need('engine', 'firstFree');
    const data = input({
      barbers: [barber(B1, { work: [iv(DAY, '09:00', '12:00')] }), barber(B2, { work: [iv(DAY, '09:00', '12:00')] })],
    });
    const result = engine.firstFree(data, DAY, []);
    expect(result?.startsAt).toEqual(at(DAY, '09:00'));
    expect(result?.barberId).toBe(engine.pickBarber(data, at(DAY, '09:00'), {}));
  });

  test('nessuno slot nel giorno → null', () => {
    need('engine', 'firstFree');
    const data = input({
      barbers: [barber(B1, { work: [iv(DAY, '09:00', '10:00')], busy: [iv(DAY, '09:00', '10:00')] }), barber(B2)],
    });
    expect(engine.firstFree(data, DAY, [B1])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// orderBarbers – SPEC §5.2 "Ordine dei barbieri"
// ---------------------------------------------------------------------------
describe('orderBarbers – SPEC §5.2: preferito, poi ultimo appuntamento, poi per nome', () => {
  const list = [
    { id: 'z', name: 'Zeno', extra: 1 },
    { id: 'b', name: 'Bruno', extra: 2 },
    { id: 'a', name: 'Àlfio', extra: 3 },
    { id: 'm', name: 'Marco', extra: 4 },
  ];
  const ids = (barbers: Array<{ id: string }>): string[] => barbers.map((b) => b.id);

  test('senza preferenze: per nome con l\'ordinamento italiano (localeCompare "it": "Àlfio" prima di "Bruno")', () => {
    need('when', 'orderBarbers');
    expect(ids(when.orderBarbers(list, {}))).toEqual(['a', 'b', 'm', 'z']);
  });

  test('prima il preferito dall\'URL, poi il barbiere dell\'ultimo appuntamento, poi gli altri per nome', () => {
    need('when', 'orderBarbers');
    expect(ids(when.orderBarbers(list, { preferredId: 'z', recentId: 'm' }))).toEqual(['z', 'm', 'a', 'b']);
  });

  test('preferito uguale al recente: compare una volta sola, in testa', () => {
    need('when', 'orderBarbers');
    expect(ids(when.orderBarbers(list, { preferredId: 'm', recentId: 'm' }))).toEqual(['m', 'a', 'b', 'z']);
  });

  test('id sconosciuti (barbiere non attivo o che non fa il servizio) ignorati', () => {
    need('when', 'orderBarbers');
    expect(ids(when.orderBarbers(list, { preferredId: 'x', recentId: null }))).toEqual(['a', 'b', 'm', 'z']);
    expect(ids(when.orderBarbers(list, { preferredId: null, recentId: 'x' }))).toEqual(['a', 'b', 'm', 'z']);
  });

  test('ordine stabile a parità di nome, oggetti restituiti intatti, input non modificato', () => {
    need('when', 'orderBarbers');
    const twins = [
      { id: '2', name: 'Luca', extra: 'secondo' },
      { id: '1', name: 'Luca', extra: 'primo' },
    ];
    const copy = structuredClone(twins);
    const result = when.orderBarbers(twins, {});
    expect(result).toEqual(copy);
    expect(twins).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// recentBarberId – SPEC §5.2: ultimo appuntamento già iniziato, escluse le cancellate
// ---------------------------------------------------------------------------
describe('recentBarberId – SPEC §5.2: barbiere dell\'ultimo appuntamento già iniziato', () => {
  const NOW = new Date('2027-03-10T10:00:00Z');

  test('l\'appuntamento iniziato più di recente (completed, no_show o confirmed passato), non il primo in elenco', () => {
    need('when', 'recentBarberId');
    expect(
      when.recentBarberId(
        [
          { barberId: B1, startsAt: '2027-03-01T10:00:00Z', status: 'completed' },
          { barberId: B2, startsAt: '2027-03-05T10:00:00Z', status: 'no_show' },
          { barberId: B3, startsAt: '2027-03-03T10:00:00Z', status: 'confirmed' },
        ],
        NOW,
      ),
    ).toBe(B2);
    expect(
      when.recentBarberId([{ barberId: B3, startsAt: '2027-03-09T10:00:00Z', status: 'confirmed' }], NOW),
    ).toBe(B3);
  });

  test('escluse cancelled_by_customer e cancelled_by_shop, anche se più recenti', () => {
    need('when', 'recentBarberId');
    expect(
      when.recentBarberId(
        [
          { barberId: B1, startsAt: '2027-03-01T10:00:00Z', status: 'completed' },
          { barberId: B2, startsAt: '2027-03-08T10:00:00Z', status: 'cancelled_by_customer' },
          { barberId: B3, startsAt: '2027-03-09T10:00:00Z', status: 'cancelled_by_shop' },
        ],
        NOW,
      ),
    ).toBe(B1);
  });

  test('ignora gli appuntamenti futuri e quello che inizia esattamente adesso (starts_at < now)', () => {
    need('when', 'recentBarberId');
    expect(
      when.recentBarberId(
        [
          { barberId: B1, startsAt: '2027-03-02T10:00:00Z', status: 'completed' },
          { barberId: B2, startsAt: '2027-03-12T10:00:00Z', status: 'confirmed' },
          { barberId: B3, startsAt: NOW.toISOString(), status: 'confirmed' },
        ],
        NOW,
      ),
    ).toBe(B1);
  });

  test('senza storico utile → null', () => {
    need('when', 'recentBarberId');
    expect(when.recentBarberId([], NOW)).toBeNull();
    expect(
      when.recentBarberId(
        [
          { barberId: B1, startsAt: '2027-03-12T10:00:00Z', status: 'confirmed' },
          { barberId: B2, startsAt: '2027-03-01T10:00:00Z', status: 'cancelled_by_customer' },
        ],
        NOW,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitByPeriod – SPEC §5.2: Mattina (prima delle 13:00 locali) / Pomeriggio
// ---------------------------------------------------------------------------
describe('splitByPeriod – SPEC §5.2 e CLAUDE.md regola 2: confine alle 13:00 nella timezone del negozio', () => {
  const local = (date: string, time: string): string => at(date, time).toISOString();

  test('12:59 è mattina, 13:00 è pomeriggio; ordine conservato', () => {
    need('when', 'splitByPeriod');
    const slots = [local('2027-03-02', '09:00'), local('2027-03-02', '12:59'), local('2027-03-02', '13:00'), local('2027-03-02', '18:30')];
    expect(when.splitByPeriod(slots, TZ)).toEqual({ morning: slots.slice(0, 2), afternoon: slots.slice(2) });
  });

  test('ora locale, non UTC: 12:30Z è 13:30 d\'inverno (pomeriggio), 11:59Z è 12:59 (mattina)', () => {
    need('when', 'splitByPeriod');
    expect(when.splitByPeriod(['2027-01-12T11:59:00.000Z', '2027-01-12T12:30:00.000Z'], TZ)).toEqual({
      morning: ['2027-01-12T11:59:00.000Z'],
      afternoon: ['2027-01-12T12:30:00.000Z'],
    });
    // d'estate (+02:00) 10:30Z = 12:30 locali: mattina; 11:00Z = 13:00: pomeriggio
    expect(when.splitByPeriod(['2027-07-01T10:30:00.000Z', '2027-07-01T11:00:00.000Z'], TZ)).toEqual({
      morning: ['2027-07-01T10:30:00.000Z'],
      afternoon: ['2027-07-01T11:00:00.000Z'],
    });
  });

  test.each([
    ['ora legale (28/03/2027)', '2027-03-28'],
    ['ora solare (31/10/2027)', '2027-10-31'],
  ])('giorno del cambio d\'ora, %s (SPEC §12)', (_label, date) => {
    need('when', 'splitByPeriod');
    const slots = [local(date, '12:45'), local(date, '13:00')];
    expect(when.splitByPeriod(slots, TZ)).toEqual({ morning: [slots[0]], afternoon: [slots[1]] });
  });

  test('senza orari → due liste vuote', () => {
    need('when', 'splitByPeriod');
    expect(when.splitByPeriod([], TZ)).toEqual({ morning: [], afternoon: [] });
  });
});

// ---------------------------------------------------------------------------
// initialDay – SPEC §5.2: giorno iniziale
// ---------------------------------------------------------------------------
describe('initialDay – SPEC §5.2: giorno dell\'URL se nel periodo e non chiuso, altrimenti il primo con orari', () => {
  const days: DayStatus[] = [
    { date: '2027-03-01', status: 'full' },
    { date: '2027-03-02', status: 'closed' },
    { date: '2027-03-03', status: 'open' },
    { date: '2027-03-04', status: 'full' },
    { date: '2027-03-05', status: 'open' },
  ];

  test('giorno richiesto con orari o senza posti → quello', () => {
    need('when', 'initialDay');
    expect(when.initialDay(days, '2027-03-05')).toBe('2027-03-05');
    expect(when.initialDay(days, '2027-03-04')).toBe('2027-03-04');
  });

  test('giorno richiesto chiuso, fuori periodo, non valido o assente → primo giorno con almeno un orario libero', () => {
    need('when', 'initialDay');
    expect(when.initialDay(days, '2027-03-02')).toBe('2027-03-03');
    expect(when.initialDay(days, '2027-04-30')).toBe('2027-03-03');
    expect(when.initialDay(days, '2027-02-28')).toBe('2027-03-03');
    expect(when.initialDay(days, 'domani')).toBe('2027-03-03');
    expect(when.initialDay(days, null)).toBe('2027-03-03');
    expect(when.initialDay(days)).toBe('2027-03-03');
  });

  test('nessun giorno con orari liberi e nessun giorno richiesto → null (stato vuoto)', () => {
    need('when', 'initialDay');
    const none: DayStatus[] = [
      { date: '2027-03-01', status: 'full' },
      { date: '2027-03-02', status: 'closed' },
    ];
    expect(when.initialDay(none)).toBeNull();
    expect(when.initialDay(none, '2027-03-02')).toBeNull();
    expect(when.initialDay([], null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formati – SPEC §5.2: "10:30 con Giovanni", "prossimo: mar 20, 9:30"
// ---------------------------------------------------------------------------
describe('formatSlotTime / formatNextFree – SPEC §5.2, CLAUDE.md regola 2', () => {
  test('formatSlotTime: "H:mm" senza zero iniziale, nella timezone del negozio', () => {
    need('when', 'formatSlotTime');
    expect(when.formatSlotTime('2027-03-02T08:30:00.000Z', TZ)).toBe('9:30');
    expect(when.formatSlotTime('2027-03-02T09:30:00.000Z', TZ)).toBe('10:30');
    expect(when.formatSlotTime('2027-07-01T07:30:00.000Z', TZ)).toBe('9:30');
    expect(when.formatSlotTime('2027-03-01T23:05:00.000Z', TZ)).toBe('0:05');
  });

  test('formatNextFree: giorno della settimana abbreviato minuscolo, numero del giorno, ora "H:mm"', () => {
    need('when', 'formatNextFree');
    expect(when.formatNextFree('2026-10-20T07:30:00.000Z', TZ)).toBe('mar 20, 9:30');
    expect(when.formatNextFree('2027-03-07T09:00:00.000Z', TZ)).toBe('dom 7, 10:00');
    // il giorno è quello locale: 23:30Z del 01/03 = 00:30 di martedì 2 marzo a Roma
    expect(when.formatNextFree('2027-03-01T23:30:00.000Z', TZ)).toBe('mar 2, 0:30');
  });
});

// ---------------------------------------------------------------------------
// Rotte – SPEC §5.2: /prenota/quando e redirect dei vecchi URL
// ---------------------------------------------------------------------------
const SERVICE = '58e00000-0000-4000-8000-000000000001';
const parse = (url: string): { pathname: string; params: Record<string, string> } => {
  const parsed = new URL(url, 'http://localhost');
  return { pathname: parsed.pathname, params: Object.fromEntries(parsed.searchParams) };
};

describe('whenStepUrl – SPEC §5.2: /prenota/quando?servizio=&giorno=&barbiere=', () => {
  test('BOOK_WHEN_PATH = "/prenota/quando"; solo il servizio, oppure con giorno e barbiere', () => {
    need('paths', 'whenStepUrl');
    expect(paths.BOOK_WHEN_PATH).toBe('/prenota/quando');
    expect(parse(paths.whenStepUrl(SERVICE))).toEqual({ pathname: '/prenota/quando', params: { servizio: SERVICE } });
    expect(parse(paths.whenStepUrl(SERVICE, { day: '2027-03-02' }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE, giorno: '2027-03-02' },
    });
    expect(parse(paths.whenStepUrl(SERVICE, { day: '2027-03-02', barberId: B1 }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE, giorno: '2027-03-02', barbiere: B1 },
    });
  });
});

describe('legacyWhenUrl – SPEC §5.2: i vecchi /prenota/barbiere e /prenota/orario portano a "Quando?"', () => {
  test('/prenota/barbiere?servizio=X → /prenota/quando?servizio=X', () => {
    need('paths', 'legacyWhenUrl');
    expect(parse(paths.legacyWhenUrl({ servizio: SERVICE }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE },
    });
  });

  test('/prenota/orario con barbiere (uuid) e giorno: mantiene servizio, barbiere e giorno', () => {
    need('paths', 'legacyWhenUrl');
    expect(parse(paths.legacyWhenUrl({ servizio: SERVICE, barbiere: B2, giorno: '2027-03-02' }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE, barbiere: B2, giorno: '2027-03-02' },
    });
  });

  test('barbiere "any" o non uuid si scarta', () => {
    need('paths', 'legacyWhenUrl');
    expect(parse(paths.legacyWhenUrl({ servizio: SERVICE, barbiere: 'any', giorno: '2027-03-02' }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE, giorno: '2027-03-02' },
    });
    expect(parse(paths.legacyWhenUrl({ servizio: SERVICE, barbiere: 'mario' }))).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: SERVICE },
    });
  });

  test('giorno non valido (data inesistente o formato sbagliato) si scarta', () => {
    need('paths', 'legacyWhenUrl');
    for (const giorno of ['2027-02-30', '02/03/2027', 'domani', '']) {
      expect(parse(paths.legacyWhenUrl({ servizio: SERVICE, barbiere: B1, giorno })), giorno).toEqual({
        pathname: '/prenota/quando',
        params: { servizio: SERVICE, barbiere: B1 },
      });
    }
  });

  test('senza servizio valido → /prenota', () => {
    need('paths', 'legacyWhenUrl');
    expect(paths.legacyWhenUrl({})).toBe('/prenota');
    expect(paths.legacyWhenUrl({ barbiere: B1, giorno: '2027-03-02' })).toBe('/prenota');
    expect(paths.legacyWhenUrl({ servizio: 'taglio', barbiere: B1 })).toBe('/prenota');
  });
});

// ---------------------------------------------------------------------------
// Testi – SPEC §9 (src/i18n/it.ts)
// ---------------------------------------------------------------------------
describe('testi della fetta 8e in src/i18n/it.ts (SPEC §9)', () => {
  test.each([
    ['booking.when.title', 'Quando?'],
    ['booking.when.firstFree', 'Primo libero: {time} con {barber}'],
    ['booking.when.slotLabel', '{time} con {barber}'],
    ['booking.when.morning', 'Mattina'],
    ['booking.when.afternoon', 'Pomeriggio'],
    ['booking.when.noSlots', 'Nessun orario libero'],
    ['booking.when.nextFree', 'prossimo: {when}'],
    ['booking.when.preferred', 'Il tuo barbiere'],
    ['booking.when.dayClosed', '{day}, chiuso'],
    ['booking.step', 'Passo {current} di {total}'],
    ['booking.time.daysLabel', 'Giorno'],
  ])('it.%s = %j', async (path, value) => {
    const { it: texts } = await load<{ it: Record<string, unknown> }>('@/i18n/it');
    let node: unknown = texts;
    for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
    expect(node).toBe(value);
  });

  test('it.booking.time.noDays (stato vuoto) resta definito', async () => {
    const { it: texts } = await load<{ it: { booking: { time: { noDays?: unknown } } } }>('@/i18n/it');
    expect(typeof texts.booking.time.noDays).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Purezza e accesso – CLAUDE.md regola 5, Sicurezza
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const sourceOf = (path: string): string => {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `file mancante: ${path}`).toBe(true);
  return readFileSync(absolute, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

describe('struttura – CLAUDE.md regola 5 e Sicurezza', () => {
  test('src/lib/booking/when.ts è puro: nessun import di DB, server-only, next o date di sistema implicite', () => {
    const code = sourceOf('src/lib/booking/when.ts');
    expect(code).not.toMatch(/from\s+['"](?:@\/lib\/db\/[^'"]*|server-only|next\/[^'"]*|@supabase\/[^'"]*)['"]/);
    expect(code).not.toMatch(/new Date\(\s*\)|Date\.now\(/);
  });

  test('la pagina /prenota/quando esiste e passa dai controlli di accesso del flusso (requireRole)', () => {
    const code = sourceOf('src/app/(customer)/prenota/quando/page.tsx');
    expect(code).toMatch(/\b(?:loadBookingPageContext|requireRole)\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// fetchWhenDay – SPEC §5.2 ("una sola richiesta per giorno ... solo orari e id dei barbieri"),
// §4, CLAUDE.md regola 6 e Sicurezza (Zod). Client Supabase finto come in availability-server.test.ts.
// ---------------------------------------------------------------------------
const fake = vi.hoisted(() => ({
  fromCalls: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpcRows: [] as Array<Record<string, unknown>>,
  adminClientCreated: false,
}));
const CUSTOMER = 'c8e00000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER = 'c8e00000-0000-4000-8000-000000000002';
const BOOKING_ID = 'd8e00000-0000-4000-8000-000000000001';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('@/lib/auth/current-user', () => {
  const user = {
    id: 'c8e00000-0000-4000-8000-000000000001',
    role: 'customer',
    isBlocked: false,
    fullName: 'Cliente',
    profileComplete: true,
  };
  return {
    getCurrentUser: async () => user,
    requireRole: async () => user,
    loadCurrentUser: async () => user,
  };
});

function builder(result: () => { data: unknown; error: unknown }): unknown {
  const target = {} as Record<string | symbol, unknown>;
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolveFn: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolveFn, reject);
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => {
          const r = result();
          const rows = Array.isArray(r.data) ? r.data : [];
          return builder(() => ({ data: r.error ? null : (rows[0] ?? null), error: r.error }));
        };
      }
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      fake.fromCalls.push(table);
      return builder(() => ({ data: fake.tables[table] ?? [], error: null }));
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      fake.rpcCalls.push({ name, args });
      return builder(() => ({ data: name === 'availability_inputs' ? fake.rpcRows : [], error: null }));
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'c8e00000-0000-4000-8000-000000000001' } }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: 'c8e00000-0000-4000-8000-000000000001', role: 'authenticated' } },
        error: null,
      }),
    },
  }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => {
    fake.adminClientCreated = true;
    throw new Error('service_role non ammessa nel percorso di disponibilità');
  },
}));

describe('fetchWhenDay – SPEC §5.2, §4, CLAUDE.md regola 6: solo orari e id dei barbieri', () => {
  const DATE = '2027-03-02';
  const row = (kind: string, barberId: string | null, start: string, end: string) => ({
    kind,
    barber_id: barberId,
    starts_at: start,
    ends_at: end,
  });

  beforeEach(() => {
    fake.fromCalls = [];
    fake.rpcCalls = [];
    fake.adminClientCreated = false;
    fake.tables = {
      shop_settings: [
        {
          id: true,
          name: 'Barber Shop',
          timezone: TZ,
          slot_granularity_min: 15,
          min_advance_min: 60,
          max_horizon_days: 30,
          cancel_limit_min: 120,
          buffer_min: 0,
          no_show_block_threshold: 3,
          privacy_policy_version: '1',
        },
      ],
      services: [{ id: SERVICE, name: 'Taglio', description: null, duration_min: 30, price_cents: 2000, is_active: true, sort_order: 1 }],
      // storico del cliente: non deve mai comparire nell'uscita
      bookings: [
        {
          id: BOOKING_ID,
          customer_id: CUSTOMER,
          barber_id: B2,
          starts_at: '2027-02-20T09:00:00Z',
          status: 'completed',
          guest_name: 'Ospite Riservato',
        },
      ],
    };
    fake.rpcRows = [
      // 02/03 (ora solare): B1 09:00–10:00, B2 09:30–10:30 locali
      row('work', B1, '2027-03-02T08:00:00Z', '2027-03-02T09:00:00Z'),
      row('work', B2, '2027-03-02T08:30:00Z', '2027-03-02T09:30:00Z'),
      // prenotazione di un altro cliente su B2 alle 10:00 locali
      row('busy', B2, '2027-03-02T09:00:00Z', '2027-03-02T09:30:00Z'),
      // B3 lavora solo il 04/03 09:00–10:00
      row('work', B3, '2027-03-04T08:00:00Z', '2027-03-04T09:00:00Z'),
    ];
    vi.useFakeTimers({ now: new Date('2027-03-01T08:00:00Z'), toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('input non valido (servizio non uuid, data inesistente, barbiere non uuid) → invalid, nessuna lettura', async () => {
    const { fetchWhenDay } = await load<ActionsModule>('@/lib/booking/availability-actions');
    expect(fetchWhenDay, 'export mancante: fetchWhenDay').toBeTypeOf('function');
    for (const args of [
      { serviceId: 'taglio', date: DATE },
      { serviceId: SERVICE, date: '2027-02-30' },
      { serviceId: SERVICE, date: '02/03/2027' },
      { serviceId: SERVICE, date: DATE, barberId: 'mario' },
    ]) {
      expect(await fetchWhenDay(args), JSON.stringify(args)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(fake.rpcCalls).toEqual([]);
  });

  test('una sola chiamata ad availability_inputs; orari per barbiere, primo libero, prossimo orario; nessuna service_role', async () => {
    const { fetchWhenDay } = await load<ActionsModule>('@/lib/booking/availability-actions');
    expect(fetchWhenDay, 'export mancante: fetchWhenDay').toBeTypeOf('function');
    const result = await fetchWhenDay({ serviceId: SERVICE, date: DATE });

    expect(fake.rpcCalls.filter((c) => c.name === 'availability_inputs')).toHaveLength(1);
    expect(fake.adminClientCreated).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.date).toBe(DATE);
    expect(result.firstFree).toEqual({ barberId: B1, startsAt: '2027-03-02T08:00:00.000Z' });

    const byId = Object.fromEntries(result.barbers.map((b) => [b.barberId, b]));
    expect(byId[B1]?.slots).toEqual(['2027-03-02T08:00:00.000Z', '2027-03-02T08:15:00.000Z', '2027-03-02T08:30:00.000Z']);
    expect(byId[B2]?.slots).toEqual(['2027-03-02T08:30:00.000Z']);
    expect(byId[B3]?.slots).toEqual([]);
    expect(byId[B3]?.next).toBe('2027-03-04T08:00:00.000Z');
  });

  test('l\'uscita contiene solo le chiavi previste: nessun dato di prenotazioni o clienti', async () => {
    const { fetchWhenDay } = await load<ActionsModule>('@/lib/booking/availability-actions');
    expect(fetchWhenDay, 'export mancante: fetchWhenDay').toBeTypeOf('function');
    const result = await fetchWhenDay({ serviceId: SERVICE, date: DATE, barberId: B2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(['barbers', 'date', 'firstFree', 'ok']);
    if (result.firstFree) expect(Object.keys(result.firstFree).sort()).toEqual(['barberId', 'startsAt']);
    for (const entry of result.barbers) expect(Object.keys(entry).sort()).toEqual(['barberId', 'next', 'slots']);

    const json = JSON.stringify(result);
    for (const secret of [CUSTOMER, OTHER_CUSTOMER, BOOKING_ID, 'Ospite Riservato', 'completed', 'busy']) {
      expect(json).not.toContain(secret);
    }
    // l'inizio della prenotazione altrui (10:00 locali) non è un orario libero
    expect(json).not.toContain('2027-03-02T09:00:00.000Z');
  });
});
