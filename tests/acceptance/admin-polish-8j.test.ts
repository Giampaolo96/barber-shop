// Test di accettazione – FETTA 8j (rifiniture di stile dell'area admin): logica pura e casi limite.
// Fonte: docs/audit/2026-10-31-taste.md e decisioni approvate dall'utente per la fetta ("8j.N" è il
// numero dell'intervento). Sezioni: SPEC §6.1 (griglia del calendario), §6.8 (impostazioni), §6.9
// (statistiche); CLAUDE.md regola 2 (istanti reali) e regola 5 (logica pura); §9 (testi in it.ts).
// I comportamenti nel browser sono in tests/e2e/admin-polish-8j.spec.ts.
//
// Interfacce attese:
//   src/lib/admin/active-section.ts
//     activeSection(pathname, sections: ReadonlyArray<{ slug; href }>): string | null
//   src/lib/calendar/grid.ts
//     cardGeometry(box: { rowStartsAt; clipEndsAt }, booking: { startsAt; endsAt; blockedUntil }):
//       { offsetMin; serviceMin; bufferMin }
//   src/lib/admin/minutes-effect.ts
//     minutesEffect(kind: 'minAdvance' | 'cancelLimit' | 'buffer', minutes): string
//   src/lib/stats/aggregate.ts     isEmptyBucket(metrics): boolean
//   src/lib/stats/schemas.ts       statsSearchParamsSchema accetta `vuoti`, restituisce showEmpty: true solo con vuoti=1
//   src/lib/stats/paths.ts         statsPath conserva showEmpty come vuoti=1
//   src/i18n/it.ts                 admin.calendar.newBookingShort, admin.calendar.detail.saveNote,
//                                  admin.calendar.edit.saveChanges, admin.stats.showEmptyPeriods,
//                                  admin.stats.hideEmptyPeriods, admin.settings.groups.{shop,bookings,rules}
// I moduli si caricano con import dinamico: un modulo o una funzione mancante fa fallire i soli
// test che li usano, con un errore chiaro.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

// ---------------------------------------------------------------------------
// Voce di menu attiva – 8j.1
// ---------------------------------------------------------------------------
type Section = { slug: string; href: string };
type ActiveSectionModule = {
  activeSection: (pathname: string, sections: ReadonlyArray<Section>) => string | null;
};

/** Stesse voci di src/app/admin/(panel)/sections.ts. */
const SECTIONS: Section[] = [
  { slug: 'calendario', href: '/admin' },
  { slug: 'assenze', href: '/admin/assenze' },
  { slug: 'servizi', href: '/admin/servizi' },
  { slug: 'barbieri', href: '/admin/barbieri' },
  { slug: 'chiusure', href: '/admin/chiusure' },
  { slug: 'clienti', href: '/admin/clienti' },
  { slug: 'impostazioni', href: '/admin/impostazioni' },
  { slug: 'statistiche', href: '/admin/statistiche' },
];
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('activeSection (8j.1; SPEC §6)', () => {
  const active = async (pathname: string, sections = SECTIONS): Promise<string | null> => {
    const { activeSection } = await load<ActiveSectionModule>('@/lib/admin/active-section');
    return activeSection(pathname, sections);
  };

  test.each([
    ['/admin', 'calendario'],
    ['/admin/calendario', 'calendario'],
    ['/admin/calendario/nuova', 'calendario'],
    [`/admin/calendario/${ID}`, 'calendario'],
  ])('%s → calendario', async (pathname, expected) => {
    expect(await active(pathname)).toBe(expected);
  });

  test.each([
    ['/admin/assenze', 'assenze'],
    [`/admin/assenze/${ID}`, 'assenze'],
    ['/admin/servizi', 'servizi'],
    ['/admin/servizi/nuovo', 'servizi'],
    [`/admin/servizi/${ID}`, 'servizi'],
    [`/admin/barbieri/${ID}`, 'barbieri'],
    [`/admin/barbieri/${ID}/orari`, 'barbieri'],
    [`/admin/chiusure/${ID}`, 'chiusure'],
    [`/admin/clienti/${ID}`, 'clienti'],
    ['/admin/impostazioni', 'impostazioni'],
    ['/admin/statistiche/da-aggiornare', 'statistiche'],
  ])('sottopagina %s → %s', async (pathname, expected) => {
    expect(await active(pathname)).toBe(expected);
  });

  test('le assenze di un barbiere stanno sotto Barbieri, non sotto Assenze', async () => {
    expect(await active(`/admin/barbieri/${ID}/assenze`)).toBe('barbieri');
    expect(await active(`/admin/barbieri/${ID}/assenze/${ID}`)).toBe('barbieri');
  });

  test.each(['/admin/servizio', '/admin/servizi-vecchi', '/admin/calendariox', '/adminx'])(
    'il prefisso vale per segmenti interi: %s → null',
    async (pathname) => {
      expect(await active(pathname)).toBeNull();
    },
  );

  test.each(['/', '/prenota', '/admin/login', '/admin/sconosciuta', '/admin/sconosciuta/altro'])(
    'percorso estraneo: %s → null (/admin non fa da prefisso di tutto)',
    async (pathname) => {
      expect(await active(pathname)).toBeNull();
    },
  );

  test('il risultato non dipende dall\'ordine delle voci', async () => {
    expect(await active('/admin/statistiche', [...SECTIONS].reverse())).toBe('statistiche');
    expect(await active(`/admin/calendario/${ID}`, [...SECTIONS].reverse())).toBe('calendario');
  });

  test('una voce non presente per il ruolo non è mai attiva', async () => {
    const barber = SECTIONS.filter((section) => ['calendario', 'assenze'].includes(section.slug));
    expect(await active('/admin/statistiche', barber)).toBeNull();
    expect(await active('/admin/assenze', barber)).toBe('assenze');
  });
});

// ---------------------------------------------------------------------------
// Geometria della scheda – 8j.4, SPEC §6.1
// ---------------------------------------------------------------------------
type Geometry = { offsetMin: number; serviceMin: number; bufferMin: number };
type GridModule = {
  cardGeometry: (
    box: { rowStartsAt: Date; clipEndsAt: Date },
    booking: { startsAt: Date; endsAt: Date; blockedUntil: Date },
  ) => Geometry;
  dayGrid: (input: {
    date: string;
    tz: string;
    granularityMin: number;
    bands: Array<{ start: string; end: string }>;
    bookings: Array<{ startsAt: Date; endsAt: Date }>;
  }) => { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] };
  blockPosition: (
    grid: { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] },
    block: { startsAt: Date; endsAt: Date },
  ) => { row: number; span: number } | null;
};

/** Ora di Roma d'inverno di un giorno fisso. */
const at = (time: string): Date => new Date(`2047-01-16T${time}:00+01:00`);

describe('cardGeometry (8j.4; SPEC §6.1)', () => {
  const geometry = async (
    box: [string, string],
    booking: [string, string, string],
  ): Promise<Geometry> => {
    const { cardGeometry } = await load<GridModule>('@/lib/calendar/grid');
    return cardGeometry(
      { rowStartsAt: at(box[0]), clipEndsAt: at(box[1]) },
      { startsAt: at(booking[0]), endsAt: at(booking[1]), blockedUntil: at(booking[2]) },
    );
  };

  test('servizio di 20 minuti su righe da 15 (audit: Barba 10:45–11:05): altezza 20, non 30', async () => {
    expect(await geometry(['10:45', '19:00'], ['10:45', '11:05', '11:05'])).toEqual({
      offsetMin: 0,
      serviceMin: 20,
      bufferMin: 0,
    });
  });

  test('inizio a metà riga: offsetMin sono i minuti dall\'inizio della riga', async () => {
    expect(await geometry(['10:00', '19:00'], ['10:05', '10:25', '10:25'])).toEqual({
      offsetMin: 5,
      serviceMin: 20,
      bufferMin: 0,
    });
  });

  test('pausa: bufferMin sono i minuti fra ends_at e blocked_until', async () => {
    expect(await geometry(['10:00', '19:00'], ['10:00', '10:30', '10:40'])).toEqual({
      offsetMin: 0,
      serviceMin: 30,
      bufferMin: 10,
    });
  });

  test('bufferMin è 0 se blocked_until coincide con ends_at', async () => {
    expect((await geometry(['10:00', '19:00'], ['10:00', '10:30', '10:30'])).bufferMin).toBe(0);
  });

  test('prenotazione iniziata prima della riga: offsetMin 0 e solo la parte visibile del servizio', async () => {
    expect(await geometry(['10:00', '19:00'], ['09:50', '10:20', '10:30'])).toEqual({
      offsetMin: 0,
      serviceMin: 20,
      bufferMin: 10,
    });
  });

  test('il taglio cade dentro il servizio: servizio ritagliato e nessuna pausa', async () => {
    expect(await geometry(['12:45', '13:00'], ['12:50', '13:20', '13:30'])).toEqual({
      offsetMin: 5,
      serviceMin: 10,
      bufferMin: 0,
    });
  });

  test('il taglio cade dentro la pausa: servizio intero e pausa ritagliata', async () => {
    expect(await geometry(['12:30', '13:00'], ['12:30', '12:50', '13:10'])).toEqual({
      offsetMin: 0,
      serviceMin: 20,
      bufferMin: 10,
    });
  });

  test('il taglio coincide con ends_at: nessuna pausa', async () => {
    expect(await geometry(['12:30', '13:00'], ['12:30', '13:00', '13:10'])).toEqual({
      offsetMin: 0,
      serviceMin: 30,
      bufferMin: 0,
    });
  });

  // CLAUDE.md regola 2: minuti reali, non differenze fra orologi locali
  test('cambio d\'ora: conta i minuti reali (01:50 → 03:10 del 28 marzo 2027 sono 20 minuti)', async () => {
    const { cardGeometry } = await load<GridModule>('@/lib/calendar/grid');
    const endsAt = new Date('2027-03-28T03:10:00+02:00');
    expect(
      cardGeometry(
        { rowStartsAt: new Date('2027-03-28T01:45:00+01:00'), clipEndsAt: new Date('2027-03-28T19:00:00+02:00') },
        { startsAt: new Date('2027-03-28T01:50:00+01:00'), endsAt, blockedUntil: endsAt },
      ),
    ).toEqual({ offsetMin: 5, serviceMin: 20, bufferMin: 0 });
  });

  test('blockPosition resta invariata: arrotonda alle righe intere (corsie e trascinamento ci contano)', async () => {
    const { blockPosition, dayGrid } = await load<GridModule>('@/lib/calendar/grid');
    const grid = dayGrid({
      date: '2047-01-16',
      tz: 'Europe/Rome',
      granularityMin: 15,
      bands: [{ start: '09:00', end: '19:00' }],
      bookings: [],
    });
    expect(blockPosition(grid, { startsAt: at('10:45'), endsAt: at('11:05') })).toEqual({ row: 7, span: 2 });
  });
});

// ---------------------------------------------------------------------------
// Effetto dei minuti – 8j.9, SPEC §6.8
// ---------------------------------------------------------------------------
type MinutesKind = 'minAdvance' | 'cancelLimit' | 'buffer';
type MinutesEffectModule = { minutesEffect: (kind: MinutesKind, minutes: number) => string };

describe('minutesEffect (8j.9; SPEC §3.1, §6.8)', () => {
  test.each<[MinutesKind, number, string]>([
    // Esempi della decisione
    ['cancelLimit', 120, '2 ore prima'],
    ['cancelLimit', 90, '1 ora e 30 minuti prima'],
    ['cancelLimit', 1440, '1 giorno prima'],
    ['minAdvance', 60, '1 ora prima'],
    ['minAdvance', 0, 'Anche subito'],
    ['cancelLimit', 0, "Fino all'inizio"],
    ['buffer', 0, 'Nessuna pausa'],
    ['buffer', 10, '10 minuti di pausa'],
    // Singolari, plurali e combinazioni che ne discendono
    ['cancelLimit', 1, '1 minuto prima'],
    ['cancelLimit', 45, '45 minuti prima'],
    ['cancelLimit', 61, '1 ora e 1 minuto prima'],
    ['cancelLimit', 150, '2 ore e 30 minuti prima'],
    ['cancelLimit', 2880, '2 giorni prima'],
    ['minAdvance', 120, '2 ore prima'],
    ['minAdvance', 30, '30 minuti prima'],
    ['minAdvance', 1440, '1 giorno prima'],
    ['buffer', 1, '1 minuto di pausa'],
    ['buffer', 5, '5 minuti di pausa'],
  ])('(%s, %d) → %s', async (kind, minutes, expected) => {
    const { minutesEffect } = await load<MinutesEffectModule>('@/lib/admin/minutes-effect');
    expect(minutesEffect(kind, minutes)).toBe(expected);
  });

  // Il campo vuoto o in digitazione non deve mostrare testi senza senso
  test.each<[MinutesKind, number]>([
    ['minAdvance', Number.NaN],
    ['cancelLimit', Number.NaN],
    ['buffer', Number.NaN],
    ['minAdvance', -1],
    ['cancelLimit', -120],
    ['buffer', -5],
  ])('(%s, %d) → stringa vuota', async (kind, minutes) => {
    const { minutesEffect } = await load<MinutesEffectModule>('@/lib/admin/minutes-effect');
    expect(minutesEffect(kind, minutes)).toBe('');
  });

  test('funzione pura, testi da src/i18n/it.ts (SPEC §9, CLAUDE.md Convenzioni)', () => {
    const path = resolve(ROOT, 'src/lib/admin/minutes-effect.ts');
    expect(existsSync(path), 'file mancante: src/lib/admin/minutes-effect.ts').toBe(true);
    const code = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    expect(code).toMatch(/from\s+['"]@\/i18n\/it['"]/);
    expect(code).not.toMatch(/['"`][^'"`]*\b(?:prima|pausa|subito|ore|minuti)\b[^'"`]*['"`]/i);
    expect(code).not.toMatch(/from\s+['"](?:@\/lib\/db[^'"]*|server-only|next\/[^'"]*|@supabase\/[^'"]*)['"]/);
  });
});

// ---------------------------------------------------------------------------
// Periodi vuoti delle statistiche – 8j.8, SPEC §6.9
// ---------------------------------------------------------------------------
type Metrics = {
  bookings: number;
  revenueCents: number;
  noShows: number;
  noShowRate: number | null;
  cancellations: number;
  cancelledByCustomer: number;
  cancelledByShop: number;
  toClose: number;
};
type AggregateModule = {
  isEmptyBucket: (metrics: Metrics) => boolean;
  buildStats: (
    groups: ReadonlyArray<{
      day: string;
      barber_id: string;
      service_id: string;
      status: string;
      started: boolean;
      bookings: number;
      revenue_cents: number;
    }>,
    options: { from: string; to: string; granularity: 'giorno' },
  ) => { series: Array<Metrics & { start: string; end: string }> };
};

const metrics = (overrides: Partial<Metrics> = {}): Metrics => ({
  bookings: 0,
  revenueCents: 0,
  noShows: 0,
  noShowRate: null,
  cancellations: 0,
  cancelledByCustomer: 0,
  cancelledByShop: 0,
  toClose: 0,
  ...overrides,
});

describe('isEmptyBucket (8j.8; SPEC §6.9)', () => {
  test.each<[string, Partial<Metrics>, boolean]>([
    ['nessun appuntamento e nessuna cancellazione', {}, true],
    ['un appuntamento', { bookings: 1, revenueCents: 2000 }, false],
    ['un appuntamento gratuito', { bookings: 1 }, false],
    ['solo un cliente non presentato', { bookings: 1, noShows: 1, noShowRate: 1 }, false],
    ['solo una cancellazione dal cliente', { cancellations: 1, cancelledByCustomer: 1 }, false],
    ['solo una cancellazione dal negozio', { cancellations: 1, cancelledByShop: 1 }, false],
  ])('%s', async (_label, overrides, expected) => {
    const { isEmptyBucket } = await load<AggregateModule>('@/lib/stats/aggregate');
    expect(isEmptyBucket(metrics(overrides))).toBe(expected);
  });

  test('sulle serie di buildStats: restano i giorni con appuntamenti o cancellazioni', async () => {
    const { buildStats, isEmptyBucket } = await load<AggregateModule>('@/lib/stats/aggregate');
    const group = { barber_id: 'b', service_id: 's', started: true, bookings: 1 };
    const { series } = buildStats(
      [
        { ...group, day: '2026-10-05', status: 'completed', revenue_cents: 2000 },
        { ...group, day: '2026-10-07', status: 'cancelled_by_shop', revenue_cents: 2000 },
      ],
      { from: '2026-10-05', to: '2026-10-08', granularity: 'giorno' },
    );
    expect(series.filter((bucket) => !isEmptyBucket(bucket)).map((bucket) => bucket.start)).toEqual([
      '2026-10-05',
      '2026-10-07',
    ]);
  });
});

type StatsParams = {
  from: string;
  to: string;
  granularity: 'giorno' | 'settimana' | 'mese';
  barberId: string | null;
  excludeDemo: boolean;
  chart: 'prenotazioni' | 'incasso';
  showEmpty?: boolean;
};
type SchemasModule = {
  statsSearchParamsSchema: (today: string) => { parse: (input: Record<string, string | undefined>) => StatsParams };
};
type PathsModule = { statsPath: (params: StatsParams, options?: { keepGranularity?: boolean }) => string };

describe('parametro vuoti delle statistiche (8j.8; SPEC §6.9)', () => {
  const parse = async (input: Record<string, string | undefined>): Promise<StatsParams> => {
    const { statsSearchParamsSchema } = await load<SchemasModule>('@/lib/stats/schemas');
    return statsSearchParamsSchema('2026-10-15').parse(input);
  };
  const base: StatsParams = {
    from: '2026-10-01',
    to: '2026-10-31',
    granularity: 'giorno',
    barberId: null,
    excludeDemo: false,
    chart: 'prenotazioni',
    showEmpty: false,
  };

  test('senza parametro i periodi vuoti sono nascosti', async () => {
    expect((await parse({})).showEmpty ?? false).toBe(false);
  });

  test('vuoti=1 li mostra', async () => {
    expect((await parse({ vuoti: '1' })).showEmpty).toBe(true);
  });

  test.each(['0', '', 'si'])('vuoti=%j non è una scelta valida: nascosti, senza errori', async (vuoti) => {
    expect((await parse({ vuoti })).showEmpty ?? false).toBe(false);
  });

  test('statsPath conserva la scelta nell\'URL, insieme agli altri parametri', async () => {
    const { statsPath } = await load<PathsModule>('@/lib/stats/paths');
    const search = new URL(
      statsPath({ ...base, showEmpty: true, chart: 'incasso', excludeDemo: true }),
      'http://localhost',
    ).searchParams;
    expect(search.get('vuoti')).toBe('1');
    expect(search.get('grafico')).toBe('incasso');
    expect(search.get('escludi_demo')).toBe('1');
  });

  test('il valore predefinito resta fuori dall\'URL', async () => {
    const { statsPath } = await load<PathsModule>('@/lib/stats/paths');
    expect(new URL(statsPath(base), 'http://localhost').searchParams.has('vuoti')).toBe(false);
  });

  test('il percorso rilegge la stessa scelta (andata e ritorno)', async () => {
    const { statsPath } = await load<PathsModule>('@/lib/stats/paths');
    const search = new URL(statsPath({ ...base, showEmpty: true }), 'http://localhost').searchParams;
    expect(await parse(Object.fromEntries(search))).toMatchObject({ showEmpty: true, from: base.from, to: base.to });
  });
});

// ---------------------------------------------------------------------------
// Testi – SPEC §9, 8j.3, 8j.5, 8j.8, 8j.9
// ---------------------------------------------------------------------------
describe('testi della fetta in src/i18n/it.ts (SPEC §9)', () => {
  const text = async (path: string): Promise<unknown> => {
    const { it } = await load<{ it: unknown }>('@/i18n/it');
    let node: unknown = it;
    for (const key of path.split('.')) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
    }
    return node;
  };

  test.each([
    ['admin.calendar.newBooking', 'Nuova prenotazione'],
    ['admin.calendar.newBookingShort', '+ Nuova'],
    ['admin.calendar.detail.saveNote', 'Salva nota'],
    ['admin.calendar.edit.saveChanges', 'Salva modifiche'],
    ['admin.common.save', 'Salva'],
    ['admin.settings.groups.shop', 'Negozio'],
    ['admin.settings.groups.bookings', 'Prenotazioni'],
    ['admin.settings.groups.rules', 'Regole'],
  ])('it.%s = %j', async (path, expected) => {
    expect(await text(path)).toBe(expected);
  });

  test.each(['admin.stats.showEmptyPeriods', 'admin.stats.hideEmptyPeriods'])('it.%s esiste', async (path) => {
    expect(await text(path)).toEqual(expect.stringMatching(/\S/));
  });

  test('i due comandi dei periodi vuoti hanno testi diversi', async () => {
    expect(await text('admin.stats.showEmptyPeriods')).not.toBe(await text('admin.stats.hideEmptyPeriods'));
  });
});
