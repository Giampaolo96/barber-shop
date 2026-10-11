// Test di accettazione – FETTA 9a (SPEC §11: "Statistiche – l'admin vede prenotazioni, incasso
// stimato e no-show del periodo, per barbiere e per servizio").
// Sezioni: SPEC §2 (statistiche: solo admin), §6.9 (formule, giorno locale, settimane da lunedì,
// periodo predefinito il mese corrente, massimo 366 giorni, prenotazioni demo), §9 (testi in
// italiano centralizzati), CLAUDE.md regole 2, 3, 5 (logica pura, centesimi interi) e Sicurezza
// (requireRole in ogni pagina di /admin, revoke/grant sulle funzioni) + decisioni approvate per la
// fetta 9a.
//
// Interfacce attese (logica pura, nessun I/O, nessun "adesso" implicito):
//   src/lib/stats/aggregate.ts
//     type StatsGroup = { day: "YYYY-MM-DD"; barber_id: string; service_id: string;
//       status: "confirmed" | "completed" | "cancelled_by_customer" | "cancelled_by_shop" | "no_show";
//       started: boolean; bookings: number; revenue_cents: number }   (elementi di admin_booking_stats)
//     type Granularity = "giorno" | "settimana" | "mese"
//     type StatsMetrics = {
//       bookings: number            confirmed + completed + no_show
//       revenueCents: number        revenue di completed + confirmed (intero)
//       noShows: number             no_show
//       noShowRate: number | null   noShows / prenotazioni non cancellate con started (0..1); null se 0
//       cancellations: number       cancelledByCustomer + cancelledByShop
//       cancelledByCustomer: number
//       cancelledByShop: number
//       toClose: number             confirmed con started = true ("Passate da chiudere")
//     }
//     type StatsBucket = StatsMetrics & { start: "YYYY-MM-DD"; end: "YYYY-MM-DD" }  (bordi tagliati al periodo)
//     type StatsRow = StatsMetrics & { id: string }                                   (barbiere o servizio)
//     buildStats(groups: readonly StatsGroup[], options: { from: string; to: string;
//       granularity: Granularity; barberId?: string | null;
//       activeBarberIds?: readonly string[]; activeServiceIds?: readonly string[] })
//       → { totals: StatsMetrics; series: StatsBucket[]; byBarber: StatsRow[]; byService: StatsRow[] }
//     - i gruppi con day fuori da [from, to] si ignorano; con barberId si considerano solo i suoi;
//     - series: tutti i bucket del periodo in ordine cronologico, anche vuoti (zeri), settimane da
//       lunedì, mesi di calendario, primo e ultimo bucket tagliati ai bordi del periodo;
//     - byBarber / byService: una riga per ogni id presente nei gruppi considerati (anche con sole
//       cancellazioni) più una riga a zero (tasso null) per ogni barbiere/servizio attivo
//       (activeBarberIds / activeServiceIds) senza gruppi; i disattivati compaiono solo se hanno
//       gruppi nel periodo. Con barberId, byBarber contiene solo quel barbiere (a zero se attivo e
//       senza gruppi); byService: servizi attivi + servizi con gruppi di quel barbiere.
//       Ordine: bookings decrescente, poi revenueCents decrescente, poi id crescente.
//   src/lib/stats/format.ts
//     formatRate(rate: number | null): string   null → "—"; altrimenti percentuale intera "33%"
//   src/lib/stats/periods.ts
//     STATS_SHORTCUTS: readonly ["thisWeek", "thisMonth", "last3Months", "thisYear"]
//     periodShortcut(key, today: "YYYY-MM-DD") → { from, to }
//       thisWeek: lunedì–domenica della settimana di today; thisMonth: mese di calendario;
//       last3Months: dal 1° del mese di due mesi prima alla fine del mese corrente;
//       thisYear: 1/1–31/12.
//   src/lib/stats/schemas.ts
//     STATS_MAX_DAYS = 366
//     statsSearchParamsSchema(today: "YYYY-MM-DD"): schema Zod che non fallisce mai;
//       input { dal?, al?, raggruppa?, barbiere?, escludi_demo?, grafico? } (stringhe)
//       → { from, to, granularity: Granularity, barberId: string | null, excludeDemo: boolean,
//           chart: "prenotazioni" | "incasso" }
//       Predefiniti: mese corrente di today (dal 1° all'ultimo giorno), "giorno", null, false,
//       "prenotazioni". Periodo: si usa solo se dal e al sono entrambe date valide, dal <= al e al
//       massimo 366 giorni; altrimenti entrambe le date tornano ai predefiniti. barbiere non uuid →
//       null; raggruppa/grafico sconosciuti → predefiniti; escludi_demo vero con "1" o "on".
//   Nessun I/O in src/lib/stats/: la lettura (rpc admin_booking_stats) sta in src/lib/db/stats.ts.
//   Pagina src/app/admin/(panel)/statistiche/page.tsx con requireRole(["admin"]).
//   Migrazione con public.admin_booking_stats: revoke da public, anon, authenticated; grant solo
//   ad authenticated (comportamento verificato in supabase/tests/28_admin_booking_stats.test.sql).
//   Testi in src/i18n/it.ts sotto admin.stats (REQUIRED_KEYS).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';

// ---------------------------------------------------------------------------
// Moduli attesi (import dinamico: un modulo mancante fa fallire solo i suoi test)
// ---------------------------------------------------------------------------
type Status = 'confirmed' | 'completed' | 'cancelled_by_customer' | 'cancelled_by_shop' | 'no_show';
type StatsGroup = {
  day: string;
  barber_id: string;
  service_id: string;
  status: Status;
  started: boolean;
  bookings: number;
  revenue_cents: number;
};
type Granularity = 'giorno' | 'settimana' | 'mese';
type StatsMetrics = {
  bookings: number;
  revenueCents: number;
  noShows: number;
  noShowRate: number | null;
  cancellations: number;
  cancelledByCustomer: number;
  cancelledByShop: number;
  toClose: number;
};
type StatsBucket = StatsMetrics & { start: string; end: string };
type StatsRow = StatsMetrics & { id: string };
type Stats = { totals: StatsMetrics; series: StatsBucket[]; byBarber: StatsRow[]; byService: StatsRow[] };
type AggregateModule = {
  buildStats: (
    groups: readonly StatsGroup[],
    options: {
      from: string;
      to: string;
      granularity: Granularity;
      barberId?: string | null;
      activeBarberIds?: readonly string[];
      activeServiceIds?: readonly string[];
    },
  ) => Stats;
};
type FormatModule = { formatRate: (rate: number | null) => string };
type ShortcutKey = 'thisWeek' | 'thisMonth' | 'last3Months' | 'thisYear';
type PeriodsModule = {
  STATS_SHORTCUTS: readonly ShortcutKey[];
  periodShortcut: (key: ShortcutKey, today: string) => { from: string; to: string };
};
type StatsParams = {
  from: string;
  to: string;
  granularity: Granularity;
  barberId: string | null;
  excludeDemo: boolean;
  chart: 'prenotazioni' | 'incasso';
};
type SchemasModule = {
  STATS_MAX_DAYS: number;
  statsSearchParamsSchema: (today: string) => {
    safeParse: (input: unknown) => { success: boolean; data?: StatsParams };
  };
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

// ---------------------------------------------------------------------------
// Dati
// ---------------------------------------------------------------------------
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const g = (
  day: string,
  barber: string,
  service: string,
  status: Status,
  started: boolean,
  bookings: number,
  revenue: number,
): StatsGroup => ({ day, barber_id: barber, service_id: service, status, started, bookings, revenue_cents: revenue });

const ZERO: StatsMetrics = {
  bookings: 0,
  revenueCents: 0,
  noShows: 0,
  noShowRate: null,
  cancellations: 0,
  cancelledByCustomer: 0,
  cancelledByShop: 0,
  toClose: 0,
};

/** Un gruppo per ogni stato e per started/non started: copre tutte le formule. */
const MIXED: StatsGroup[] = [
  g('2026-10-05', A, S1, 'completed', true, 4, 8000),
  g('2026-10-05', A, S1, 'no_show', true, 2, 4000),
  g('2026-10-05', A, S1, 'confirmed', true, 1, 2000), // passata da chiudere
  g('2026-10-06', A, S2, 'cancelled_by_customer', true, 3, 4500),
  g('2026-10-06', B, S2, 'cancelled_by_shop', false, 1, 1500),
  g('2026-10-07', B, S1, 'confirmed', false, 5, 10000), // futura
  g('2026-10-07', B, S2, 'cancelled_by_customer', false, 2, 3000),
];

const days = (series: StatsBucket[]): string[] => series.map((bucket) => `${bucket.start}..${bucket.end}`);

// ---------------------------------------------------------------------------
// buildStats – formule (SPEC §6.9)
// ---------------------------------------------------------------------------
describe('buildStats: formule dei totali (SPEC §6.9)', () => {
  const options = { from: '2026-10-01', to: '2026-10-31', granularity: 'giorno' as const };

  test('prenotazioni = confirmed + completed + no_show; cancellazioni a parte, per cliente e negozio', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { totals } = buildStats(MIXED, options);
    expect(totals.bookings).toBe(4 + 2 + 1 + 5);
    expect(totals.cancelledByCustomer).toBe(3 + 2);
    expect(totals.cancelledByShop).toBe(1);
    expect(totals.cancellations).toBe(6);
    expect(totals.noShows).toBe(2);
  });

  test('incasso stimato = somma delle completed e confirmed, in centesimi interi (CLAUDE.md regola 3)', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { totals } = buildStats(MIXED, options);
    expect(totals.revenueCents).toBe(8000 + 2000 + 10000);
    expect(Number.isInteger(totals.revenueCents)).toBe(true);
  });

  test('tasso no-show = no_show / prenotazioni non cancellate già iniziate (le future e le cancellate non contano)', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { totals } = buildStats(MIXED, options);
    // started e non cancellate: 4 completed + 2 no_show + 1 confirmed = 7
    expect(totals.noShowRate).toBeCloseTo(2 / 7, 10);
  });

  test('tasso no-show null se nessuna prenotazione non cancellata è già iniziata', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const onlyFutureOrCancelled = [
      g('2026-10-07', B, S1, 'confirmed', false, 5, 10000),
      g('2026-10-06', A, S2, 'cancelled_by_customer', true, 3, 4500),
      g('2026-10-06', A, S2, 'cancelled_by_shop', true, 1, 1500),
    ];
    expect(buildStats(onlyFutureOrCancelled, options).totals.noShowRate).toBeNull();
    expect(buildStats([], options).totals.noShowRate).toBeNull();
  });

  test('tasso no-show 0 (non null) se ci sono prenotazioni iniziate e nessuna no-show', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { totals } = buildStats([g('2026-10-05', A, S1, 'completed', true, 3, 6000)], options);
    expect(totals.noShowRate).toBe(0);
  });

  test('passate da chiudere = confirmed con started = true (le future no)', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    expect(buildStats(MIXED, options).totals.toClose).toBe(1);
  });

  test('nessun gruppo: totali a zero e tasso null', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const stats = buildStats([], options);
    expect(stats.totals).toMatchObject(ZERO);
    expect(stats.byBarber).toEqual([]);
    expect(stats.byService).toEqual([]);
  });

  test('i gruppi fuori dal periodo si ignorano', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const stats = buildStats(
      [
        g('2026-09-30', A, S1, 'completed', true, 9, 9000),
        g('2026-10-01', A, S1, 'completed', true, 1, 1000),
        g('2026-11-01', A, S1, 'completed', true, 9, 9000),
      ],
      options,
    );
    expect(stats.totals.bookings).toBe(1);
    expect(stats.totals.revenueCents).toBe(1000);
  });

  test('funzione pura: non modifica i gruppi in ingresso', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const input = Object.freeze(MIXED.map((group) => Object.freeze({ ...group })));
    const snapshot = JSON.stringify(input);
    buildStats(input, { ...options, granularity: 'settimana' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// buildStats – andamento per giorno, settimana, mese (SPEC §6.9)
// ---------------------------------------------------------------------------
describe('buildStats: bucket dell\'andamento (SPEC §6.9)', () => {
  test('giorno: un bucket per ogni giorno del periodo, anche vuoto, in ordine cronologico', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { series } = buildStats(
      [g('2026-10-07', B, S1, 'confirmed', false, 5, 10000), g('2026-10-05', A, S1, 'completed', true, 4, 8000)],
      { from: '2026-10-04', to: '2026-10-08', granularity: 'giorno' },
    );
    expect(days(series)).toEqual([
      '2026-10-04..2026-10-04',
      '2026-10-05..2026-10-05',
      '2026-10-06..2026-10-06',
      '2026-10-07..2026-10-07',
      '2026-10-08..2026-10-08',
    ]);
    expect(series.map((bucket) => bucket.bookings)).toEqual([0, 4, 0, 5, 0]);
    expect(series.map((bucket) => bucket.revenueCents)).toEqual([0, 8000, 0, 10000, 0]);
    expect(series[0]).toMatchObject(ZERO);
  });

  test('giorno: il cambio d\'ora (25/10/2026) non salta né duplica giorni (SPEC §12)', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { series } = buildStats([], { from: '2026-10-24', to: '2026-10-26', granularity: 'giorno' });
    expect(series.map((bucket) => bucket.start)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  test('settimana: da lunedì, primo e ultimo bucket tagliati ai bordi del periodo', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    // giovedì 1/10/2026 – mercoledì 21/10/2026
    const { series } = buildStats(
      [
        g('2026-10-01', A, S1, 'completed', true, 1, 1000),
        g('2026-10-04', A, S1, 'completed', true, 2, 2000), // domenica: stessa settimana del 1/10
        g('2026-10-05', A, S1, 'completed', true, 3, 3000), // lunedì: settimana nuova
        g('2026-10-21', A, S1, 'confirmed', false, 4, 4000),
      ],
      { from: '2026-10-01', to: '2026-10-21', granularity: 'settimana' },
    );
    expect(days(series)).toEqual([
      '2026-10-01..2026-10-04',
      '2026-10-05..2026-10-11',
      '2026-10-12..2026-10-18',
      '2026-10-19..2026-10-21',
    ]);
    expect(series.map((bucket) => bucket.bookings)).toEqual([3, 3, 0, 4]);
  });

  test('settimana: a cavallo dell\'anno resta una sola settimana da lunedì a domenica', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { series } = buildStats(
      [g('2026-12-28', A, S1, 'completed', true, 1, 1000), g('2027-01-03', A, S1, 'completed', true, 1, 1000)],
      { from: '2026-12-28', to: '2027-01-04', granularity: 'settimana' },
    );
    expect(days(series)).toEqual(['2026-12-28..2027-01-03', '2027-01-04..2027-01-04']);
    expect(series.map((bucket) => bucket.bookings)).toEqual([2, 0]);
  });

  test('settimana: quella del cambio d\'ora (19–25/10/2026) è una sola', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { series } = buildStats([], { from: '2026-10-19', to: '2026-10-26', granularity: 'settimana' });
    expect(days(series)).toEqual(['2026-10-19..2026-10-25', '2026-10-26..2026-10-26']);
  });

  test('mese: mesi di calendario, bordi tagliati, mesi vuoti presenti, febbraio bisestile', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { series } = buildStats(
      [g('2028-01-31', A, S1, 'completed', true, 2, 3000), g('2028-04-10', A, S1, 'no_show', true, 1, 2000)],
      { from: '2028-01-15', to: '2028-04-10', granularity: 'mese' },
    );
    expect(days(series)).toEqual([
      '2028-01-15..2028-01-31',
      '2028-02-01..2028-02-29',
      '2028-03-01..2028-03-31',
      '2028-04-01..2028-04-10',
    ]);
    expect(series.map((bucket) => bucket.bookings)).toEqual([2, 0, 0, 1]);
    expect(series.map((bucket) => bucket.revenueCents)).toEqual([3000, 0, 0, 0]);
  });

  test('periodo di un giorno: un solo bucket per ogni granularità', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    for (const granularity of ['giorno', 'settimana', 'mese'] as const) {
      const { series } = buildStats([], { from: '2026-10-07', to: '2026-10-07', granularity });
      expect(days(series), granularity).toEqual(['2026-10-07..2026-10-07']);
    }
  });

  test('ogni bucket ha le stesse metriche dei totali e la somma dei bucket coincide con i totali', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { totals, series } = buildStats(MIXED, { from: '2026-10-01', to: '2026-10-31', granularity: 'settimana' });
    const sum = (key: 'bookings' | 'revenueCents' | 'noShows' | 'cancellations' | 'toClose'): number =>
      series.reduce((total, bucket) => total + bucket[key], 0);
    expect(sum('bookings')).toBe(totals.bookings);
    expect(sum('revenueCents')).toBe(totals.revenueCents);
    expect(sum('noShows')).toBe(totals.noShows);
    expect(sum('cancellations')).toBe(totals.cancellations);
    expect(sum('toClose')).toBe(totals.toClose);
    const week = series.find((bucket) => bucket.start === '2026-10-05');
    expect(week).toMatchObject({ bookings: 12, revenueCents: 20000, toClose: 1, cancelledByShop: 1 });
    expect(week?.noShowRate).toBeCloseTo(2 / 7, 10);
  });
});

// ---------------------------------------------------------------------------
// buildStats – per barbiere, per servizio, filtro barbiere (SPEC §6.9)
// ---------------------------------------------------------------------------
describe('buildStats: righe per barbiere e per servizio (SPEC §6.9)', () => {
  const options = { from: '2026-10-01', to: '2026-10-31', granularity: 'giorno' as const };

  test('per barbiere: metriche di ciascuno', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber } = buildStats(MIXED, options);
    const a = byBarber.find((row) => row.id === A);
    const b = byBarber.find((row) => row.id === B);
    expect(a).toMatchObject({ bookings: 7, revenueCents: 10000, noShows: 2, cancelledByCustomer: 3, toClose: 1 });
    expect(a?.noShowRate).toBeCloseTo(2 / 7, 10);
    expect(b).toMatchObject({ bookings: 5, revenueCents: 10000, cancelledByShop: 1, cancelledByCustomer: 2, toClose: 0 });
    expect(b?.noShowRate).toBeNull();
  });

  test('per servizio: metriche di ciascuno', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byService } = buildStats(MIXED, options);
    expect(byService.find((row) => row.id === S1)).toMatchObject({ bookings: 12, revenueCents: 20000, noShows: 2 });
    expect(byService.find((row) => row.id === S2)).toMatchObject({
      bookings: 0,
      revenueCents: 0,
      cancellations: 6,
      cancelledByCustomer: 5,
      cancelledByShop: 1,
    });
  });

  test('ordine deterministico: prenotazioni decrescenti, poi incasso decrescente, poi id', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber } = buildStats(
      [
        g('2026-10-05', A, S1, 'completed', true, 2, 2000),
        g('2026-10-05', B, S1, 'completed', true, 2, 3000),
        g('2026-10-05', C, S1, 'completed', true, 5, 1000),
        g('2026-10-06', A, S2, 'cancelled_by_customer', true, 1, 1000),
      ],
      options,
    );
    expect(byBarber.map((row) => row.id)).toEqual([C, B, A]);
    // stessi numeri: decide l'id, indipendentemente dall'ordine in ingresso
    const tie = [g('2026-10-05', B, S1, 'completed', true, 1, 1000), g('2026-10-05', A, S1, 'completed', true, 1, 1000)];
    expect(buildStats(tie, options).byBarber.map((row) => row.id)).toEqual([A, B]);
    expect(buildStats([...tie].reverse(), options).byBarber.map((row) => row.id)).toEqual([A, B]);
  });

  test('una riga anche per chi ha solo cancellazioni nel periodo', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber } = buildStats([g('2026-10-06', C, S2, 'cancelled_by_shop', true, 1, 1500)], options);
    expect(byBarber).toHaveLength(1);
    expect(byBarber[0]).toMatchObject({ id: C, bookings: 0, cancellations: 1 });
  });

  test('filtro barbiere: totali, andamento e righe considerano solo quel barbiere', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const stats = buildStats(MIXED, { ...options, barberId: B });
    expect(stats.totals).toMatchObject({
      bookings: 5,
      revenueCents: 10000,
      noShows: 0,
      noShowRate: null,
      cancelledByCustomer: 2,
      cancelledByShop: 1,
      toClose: 0,
    });
    expect(stats.byBarber.map((row) => row.id)).toEqual([B]);
    expect(stats.byService.map((row) => row.id)).toEqual([S1, S2]);
    expect(stats.series.find((bucket) => bucket.start === '2026-10-05')?.bookings).toBe(0);
    expect(stats.series.find((bucket) => bucket.start === '2026-10-07')?.bookings).toBe(5);
  });

  test('filtro barbiere null o assente: tutti i barbieri', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    expect(buildStats(MIXED, { ...options, barberId: null }).totals.bookings).toBe(12);
    expect(buildStats(MIXED, options).totals.bookings).toBe(12);
  });

  // Decisione dell'utente (punto 3): attivi senza prenotazioni a zero, disattivati solo con gruppi
  test('barbieri e servizi attivi senza prenotazioni nel periodo: riga a zero con tasso null', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber, byService } = buildStats([g('2026-10-05', A, S1, 'completed', true, 1, 2000)], {
      ...options,
      activeBarberIds: [A, C],
      activeServiceIds: [S1, S2],
    });
    expect(byBarber.map((row) => row.id)).toEqual([A, C]);
    expect(byBarber[1]).toMatchObject({ id: C, ...ZERO });
    expect(byService.map((row) => row.id)).toEqual([S1, S2]);
    expect(byService[1]).toMatchObject({ id: S2, ...ZERO });
  });

  test('disattivati: compaiono solo se hanno gruppi nel periodo (anche solo cancellazioni)', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber, byService } = buildStats(
      [g('2026-10-05', A, S1, 'completed', true, 1, 2000), g('2026-10-06', B, S2, 'cancelled_by_shop', true, 1, 1500)],
      { ...options, activeBarberIds: [A], activeServiceIds: [S1] },
    );
    // B e S2 non attivi ma con una cancellazione; C non attivo e senza gruppi: assente
    expect(byBarber.map((row) => row.id)).toEqual([A, B]);
    expect(byBarber[1]).toMatchObject({ id: B, bookings: 0, cancelledByShop: 1 });
    expect(byService.map((row) => row.id)).toEqual([S1, S2]);
  });

  test('righe a zero: in fondo, a parità di numeri ordinate per id', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber } = buildStats([g('2026-10-05', C, S1, 'completed', true, 1, 2000)], {
      ...options,
      activeBarberIds: [B, C, A],
    });
    expect(byBarber.map((row) => row.id)).toEqual([C, A, B]);
  });

  test('id attivi ripetuti o già presenti nei gruppi: una sola riga per id', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const { byBarber } = buildStats(MIXED, { ...options, activeBarberIds: [A, A, B] });
    expect(byBarber.map((row) => row.id)).toEqual([A, B]);
    expect(byBarber[0]).toMatchObject({ id: A, bookings: 7 });
  });

  test('filtro barbiere: byBarber solo quel barbiere, a zero se attivo e senza gruppi', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const stats = buildStats(MIXED, { ...options, barberId: C, activeBarberIds: [A, B, C], activeServiceIds: [S1] });
    expect(stats.byBarber).toMatchObject([{ id: C, ...ZERO }]);
    expect(stats.totals).toMatchObject(ZERO);
    expect(stats.byService).toMatchObject([{ id: S1, ...ZERO }]);
  });

  test('filtro barbiere: byService = servizi attivi (anche a zero) + servizi con gruppi di quel barbiere', async () => {
    const { buildStats } = await load<AggregateModule>('@/lib/stats/aggregate');
    const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const groups = [...MIXED, g('2026-10-08', A, S3, 'completed', true, 1, 3000)];
    // B ha gruppi su S1 (attivo) e S2 (non attivo); S3 (non attivo) ha gruppi solo di A
    const stats = buildStats(groups, { ...options, barberId: B, activeBarberIds: [A, B], activeServiceIds: [S1] });
    expect(stats.byBarber.map((row) => row.id)).toEqual([B]);
    expect(stats.byService.map((row) => row.id)).toEqual([S1, S2]);
    expect(stats.byService[1]).toMatchObject({ id: S2, bookings: 0, cancelledByCustomer: 2, cancelledByShop: 1 });
    // con un servizio attivo in più, senza gruppi di B: riga a zero
    const withActive = buildStats(groups, { ...options, barberId: B, activeServiceIds: [S1, S3] });
    expect(withActive.byService.map((row) => row.id)).toEqual([S1, S2, S3]);
    expect(withActive.byService[2]).toMatchObject({ id: S3, ...ZERO });
  });
});

// ---------------------------------------------------------------------------
// formatRate – "—" se il tasso non è calcolabile (SPEC §6.9)
// ---------------------------------------------------------------------------
describe('formatRate (SPEC §6.9)', () => {
  test.each([
    [null, '—'],
    [0, '0%'],
    [0.5, '50%'],
    [1 / 3, '33%'],
    [2 / 3, '67%'],
    [1, '100%'],
  ])('%s → %s', async (rate, expected) => {
    const { formatRate } = await load<FormatModule>('@/lib/stats/format');
    expect(formatRate(rate)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Scorciatoie del periodo (decisione 3)
// ---------------------------------------------------------------------------
describe('scorciatoie del periodo (decisione 3)', () => {
  test('elenco e ordine: Questa settimana, Questo mese, Ultimi 3 mesi, Quest\'anno', async () => {
    const { STATS_SHORTCUTS } = await load<PeriodsModule>('@/lib/stats/periods');
    expect([...STATS_SHORTCUTS]).toEqual(['thisWeek', 'thisMonth', 'last3Months', 'thisYear']);
  });

  test.each([
    ['thisWeek', '2026-10-11', '2026-10-05', '2026-10-11'], // domenica
    ['thisWeek', '2026-10-05', '2026-10-05', '2026-10-11'], // lunedì
    ['thisWeek', '2027-01-01', '2026-12-28', '2027-01-03'], // a cavallo dell'anno
    ['thisMonth', '2026-10-11', '2026-10-01', '2026-10-31'],
    ['thisMonth', '2028-02-10', '2028-02-01', '2028-02-29'],
    ['last3Months', '2026-10-11', '2026-08-01', '2026-10-31'],
    ['last3Months', '2027-01-15', '2026-11-01', '2027-01-31'],
    ['thisYear', '2026-10-11', '2026-01-01', '2026-12-31'],
    ['thisYear', '2028-06-30', '2028-01-01', '2028-12-31'],
  ] as const)('%s con oggi %s → %s – %s', async (key, today, from, to) => {
    const { periodShortcut } = await load<PeriodsModule>('@/lib/stats/periods');
    expect(periodShortcut(key, today)).toEqual({ from, to });
  });

  test('ogni scorciatoia è un periodo accettato dai parametri della pagina (anche l\'anno bisestile)', async () => {
    const { periodShortcut, STATS_SHORTCUTS } = await load<PeriodsModule>('@/lib/stats/periods');
    const { statsSearchParamsSchema } = await load<SchemasModule>('@/lib/stats/schemas');
    for (const today of ['2026-10-11', '2028-12-31', '2027-01-01']) {
      for (const key of STATS_SHORTCUTS) {
        const period = periodShortcut(key, today);
        const parsed = statsSearchParamsSchema(today).safeParse({ dal: period.from, al: period.to });
        expect(parsed.data, `${key} ${today}`).toMatchObject({ from: period.from, to: period.to });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Parametri della pagina (decisione 3; SPEC §6.9: predefinito il mese corrente, max 366 giorni)
// ---------------------------------------------------------------------------
describe('parametri della pagina /admin/statistiche (SPEC §6.9)', () => {
  const TODAY = '2026-10-11';
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const parse = async (input: Record<string, string | undefined>, today = TODAY): Promise<StatsParams | undefined> => {
    const { statsSearchParamsSchema } = await load<SchemasModule>('@/lib/stats/schemas');
    const result = statsSearchParamsSchema(today).safeParse(input);
    expect(result.success, `parametri rifiutati: ${JSON.stringify(input)}`).toBe(true);
    return result.data;
  };
  const DEFAULTS: StatsParams = {
    from: '2026-10-01',
    to: '2026-10-31',
    granularity: 'giorno',
    barberId: null,
    excludeDemo: false,
    chart: 'prenotazioni',
  };

  test('STATS_MAX_DAYS = 366', async () => {
    const { STATS_MAX_DAYS } = await load<SchemasModule>('@/lib/stats/schemas');
    expect(STATS_MAX_DAYS).toBe(366);
  });

  test('senza parametri: mese corrente di oggi, per giorno, tutti i barbieri, demo incluse, grafico prenotazioni', async () => {
    expect(await parse({})).toEqual(DEFAULTS);
  });

  test.each([
    ['2028-02-10', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2027-01-01', '2027-01-01', '2027-01-31'],
  ])('mese corrente con oggi %s → %s – %s', async (today, from, to) => {
    expect(await parse({}, today)).toMatchObject({ from, to });
  });

  test('tutti i parametri validi vengono tenuti', async () => {
    expect(
      await parse({
        dal: '2026-01-01',
        al: '2026-12-31',
        raggruppa: 'mese',
        barbiere: UUID,
        escludi_demo: '1',
        grafico: 'incasso',
      }),
    ).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      granularity: 'mese',
      barberId: UUID,
      excludeDemo: true,
      chart: 'incasso',
    });
  });

  test.each([
    ['un solo giorno', '2026-10-07', '2026-10-07'],
    ['366 giorni (2028 bisestile)', '2028-01-01', '2028-12-31'],
    ['366 giorni a cavallo dell\'anno', '2026-03-01', '2027-03-01'],
    ['periodo nel passato', '2025-01-13', '2025-01-19'],
  ])('periodo valido (%s) tenuto', async (_label, dal, al) => {
    expect(await parse({ dal, al })).toMatchObject({ from: dal, to: al });
  });

  test.each([
    ['367 giorni', '2026-01-01', '2027-01-02'],
    ['periodo invertito', '2026-10-20', '2026-10-10'],
    ['data inesistente', '2026-02-30', '2026-03-10'],
    ['formato non valido', '01/10/2026', '2026-10-31'],
    ['testo', 'ieri', 'oggi'],
    ['solo dal', '2026-09-01', undefined],
    ['solo al', undefined, '2026-09-30'],
    ['vuoti', '', ''],
  ])('periodo non valido (%s) → mese corrente', async (_label, dal, al) => {
    expect(await parse({ dal, al })).toMatchObject({ from: DEFAULTS.from, to: DEFAULTS.to });
  });

  test('un periodo non valido non cambia gli altri parametri', async () => {
    expect(await parse({ dal: '2026-10-20', al: '2026-10-10', raggruppa: 'settimana', grafico: 'incasso' })).toEqual({
      ...DEFAULTS,
      granularity: 'settimana',
      chart: 'incasso',
    });
  });

  test.each([
    ['giorno', 'giorno'],
    ['settimana', 'settimana'],
    ['mese', 'mese'],
    ['week', 'giorno'],
    ['anno', 'giorno'],
    ['', 'giorno'],
  ] as const)('raggruppa=%s → %s', async (raggruppa, expected) => {
    expect((await parse({ raggruppa }))?.granularity).toBe(expected);
  });

  test.each([
    ['prenotazioni', 'prenotazioni'],
    ['incasso', 'incasso'],
    ['revenue', 'prenotazioni'],
    ['', 'prenotazioni'],
  ] as const)('grafico=%s → %s', async (grafico, expected) => {
    expect((await parse({ grafico }))?.chart).toBe(expected);
  });

  test.each([
    [UUID, UUID],
    ['non-un-uuid', null],
    ['', null],
    [`${UUID}' or 1=1`, null],
  ])('barbiere=%s → %s (uuid non valido ignorato)', async (barbiere, expected) => {
    expect((await parse({ barbiere }))?.barberId).toBe(expected);
  });

  test.each([
    ['1', true],
    ['on', true],
    [undefined, false],
    ['', false],
    ['0', false],
  ])('escludi_demo=%s → %s (casella spenta di base)', async (value, expected) => {
    expect((await parse({ escludi_demo: value }))?.excludeDemo).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Struttura: logica pura, pagina solo admin, migrazione (CLAUDE.md regola 5 e Sicurezza)
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (dir: string): string[] => {
  const absolute = resolve(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const rel = relative(ROOT, join(absolute, entry.name)).replace(/\\/g, '/');
    return entry.isDirectory() ? walk(rel) : [rel];
  });
};
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const ADMIN_ONLY = /\brequireRole\s*\(\s*\[\s*['"]admin['"]\s*,?\s*\]\s*\)/;

describe('struttura della fetta (CLAUDE.md regola 5 e Sicurezza)', () => {
  test.each(['aggregate.ts', 'format.ts', 'periods.ts', 'schemas.ts'])(
    'src/lib/stats/%s è logica pura: niente database, server, rete né orologio di sistema',
    (name) => {
      const path = resolve(ROOT, 'src/lib/stats', name);
      expect(existsSync(path), `file mancante: src/lib/stats/${name}`).toBe(true);
      const code = stripComments(readFileSync(path, 'utf8'));
      expect(code).not.toMatch(/from\s+['"](?:@\/lib\/db[^'"]*|server-only|next\/[^'"]*|@supabase\/[^'"]*)['"]/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\bDate\.now\s*\(/);
      expect(code).not.toMatch(/new\s+Date\s*\(\s*\)/);
    },
  );

  test('nessun file di src/lib/stats/ fa I/O: la lettura dal database sta in src/lib/db/stats.ts', () => {
    const offending = walk('src/lib/stats')
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .filter((file) =>
        /from\s+['"](?:@\/lib\/db[^'"]*|server-only|next\/[^'"]*|@supabase\/[^'"]*)['"]|\bfetch\s*\(|\.rpc\s*\(/.test(
          stripComments(readFileSync(resolve(ROOT, file), 'utf8')),
        ),
      );
    expect(offending).toEqual([]);
    const db = resolve(ROOT, 'src/lib/db/stats.ts');
    expect(existsSync(db), 'file mancante: src/lib/db/stats.ts').toBe(true);
    const code = stripComments(readFileSync(db, 'utf8'));
    expect(code).toMatch(/\.rpc\s*\(\s*['"]admin_booking_stats['"]/);
    expect(code).not.toMatch(/createAdminClient|SERVICE_ROLE/);
  });

  test('/admin/statistiche: pagina dedicata con requireRole(["admin"]) e senza service role (SPEC §2, §6.9)', () => {
    const file = walk('src/app/admin').find((candidate) =>
      /^src\/app\/admin\/(?:\([^/]+\)\/)?statistiche\/page\.tsx$/.test(candidate),
    );
    expect(file, 'pagina mancante: src/app/admin/(panel)/statistiche/page.tsx').toBeDefined();
    const code = stripComments(readFileSync(resolve(ROOT, file ?? ''), 'utf8'));
    expect(code).toMatch(ADMIN_ONLY);
    expect(code).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
  });

  test('la migrazione di admin_booking_stats revoca da public, anon, authenticated e concede solo ad authenticated', () => {
    const migrations = walk('supabase/migrations').filter((file) => file.endsWith('.sql'));
    const file = migrations.find((candidate) =>
      /create\s+(?:or\s+replace\s+)?function\s+public\.admin_booking_stats\s*\(/i.test(
        readFileSync(resolve(ROOT, candidate), 'utf8'),
      ),
    );
    expect(file, 'nessuna migrazione crea public.admin_booking_stats').toBeDefined();
    const sql = readFileSync(resolve(ROOT, file ?? ''), 'utf8').replace(/--.*$/gm, '');
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.admin_booking_stats\s*\([^)]*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated(?:\s*,\s*service_role)?\s*;/i,
    );
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.admin_booking_stats\s*\([^)]*\)\s+to\s+authenticated\s*;/i);
    // nessun grant ad anon, public o service_role (punto 4: service_role senza execute, verificato in pgTAP)
    expect(sql).not.toMatch(/grant\s+[^;]*public\.admin_booking_stats[^;]*\bto\s+[^;]*\b(?:anon|public|service_role)\b/i);
  });
});

// ---------------------------------------------------------------------------
// Testi (SPEC §9: tutto in src/i18n/it.ts)
// ---------------------------------------------------------------------------
const REQUIRED_KEYS = [
  'fromLabel',
  'toLabel',
  'groupByLabel',
  'granularity.day',
  'granularity.week',
  'granularity.month',
  'barberLabel',
  'allBarbers',
  'excludeDemo',
  'apply',
  'shortcutsLabel',
  'shortcuts.thisWeek',
  'shortcuts.thisMonth',
  'shortcuts.last3Months',
  'shortcuts.thisYear',
  'totals.bookings',
  'totals.revenue',
  'totals.noShowRate',
  'totals.cancellations',
  'totals.toClose',
  'chartLabel',
  'chart.bookings',
  'chart.revenue',
  'trendTitle',
  'byBarberTitle',
  'byServiceTitle',
] as const;

const text = (path: string): unknown => {
  let node: unknown = texts;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
};

describe('testi delle statistiche in src/i18n/it.ts (SPEC §9)', () => {
  test.each(REQUIRED_KEYS)('it.admin.stats.%s è un testo non vuoto', (key) => {
    const value = text(`admin.stats.${key}`);
    expect(typeof value === 'string' && value.trim() !== '', `chiave mancante: it.admin.stats.${key}`).toBe(true);
  });

  test.each([
    ['shortcuts.thisWeek', 'Questa settimana'],
    ['shortcuts.thisMonth', 'Questo mese'],
    ['shortcuts.last3Months', 'Ultimi 3 mesi'],
    ['shortcuts.thisYear', "Quest'anno"],
    ['excludeDemo', 'Escludi prenotazioni demo'],
    ['totals.toClose', 'Passate da chiudere'],
  ])('it.admin.stats.%s = "%s" (decisioni approvate)', (key, expected) => {
    expect(text(`admin.stats.${key}`)).toBe(expected);
  });
});
