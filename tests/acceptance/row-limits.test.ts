// Test di accettazione – FETTA 8h "Sicurezza dati", punto 3 dell'audit del 2026-10-30 esteso agli
// elenchi (decisioni approvate dall'utente il 2026-11-08): nessun taglio silenzioso delle righe.
// PostgREST consegna al massimo 1000 righe (max_rows) senza errore: ogni elenco che può crescere ha
// un limite esplicito e, se lo supera, lo dice. SPEC §5.3 (le mie prenotazioni), §6.1 (calendario),
// §6.5–6.6 (assenze e chiusure), §9 (testi da src/i18n/it.ts).
//
// Interfacce attese:
//   src/lib/admin/periods.ts:   export const PERIODS_LIST_LIMIT = 200
//   /admin/assenze (barbiere e admin) e /admin/chiusure: query con .order("starts_at", { ascending: false })
//     e .limit(PERIODS_LIST_LIMIT + 1); con più di 200 righe se ne mostrano 200 (ordinate con
//     sortPeriodsForList) e compare fillText(it.admin.period.listTruncated, { count: 200 }).
//   src/lib/booking/queries.ts: export const MY_BOOKINGS_LIMIT = 200;
//     getMyBookings(customerId) → { bookings: MyBooking[]; truncated: boolean } | null, con
//     .limit(MY_BOOKINGS_LIMIT + 1); /prenotazioni mostra it.booking.list.myBookingsTruncated ({count}).
//   src/lib/calendar/queries.ts: export const CALENDAR_BOOKINGS_LIMIT = 1000; getBookingsInRange usa
//     .limit(CALENDAR_BOOKINGS_LIMIT).
//   src/lib/calendar/page-data.ts: DayViewData e WeekViewData con incomplete: boolean (righe lette >=
//     CALENDAR_BOOKINGS_LIMIT); il calendario mostra it.admin.calendar.incomplete quando incomplete.
// Client Supabase finto: simula il database (ordine dato dal test, limite applicato come PostgREST).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Row = Record<string, unknown>;
type Call = { table: string; method: string; args: unknown[] };

const fake = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  role: 'admin' as 'admin' | 'barber',
  ownBarberId: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth/current-user', () => ({
  requireRole: async () => ({ id: 'a8000000-0000-4000-8000-000000000001', role: fake.role, isBlocked: false, profileComplete: true }),
  getCurrentUser: async () => ({ id: 'a8000000-0000-4000-8000-000000000001', role: fake.role, isBlocked: false, profileComplete: true }),
  getVerifiedUserId: async () => 'a8000000-0000-4000-8000-000000000001',
}));
vi.mock('@/lib/admin/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getOwnBarberId: async () => fake.ownBarberId,
  getShopTimezone: async () => 'Europe/Rome',
}));

/** Query builder: registra ogni chiamata; al termine restituisce le righe della tabella, tagliate da limit. */
const fakeClient = vi.hoisted(() => () => {
  const builder = (table: string): unknown => {
    let limit: number | null = null;
    const result = () => {
      const all = fake.rows[table] ?? [];
      return { data: limit === null ? all : all.slice(0, limit), error: null };
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'then') {
            return (ok: (value: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
          }
          if (property === 'single' || property === 'maybeSingle') {
            return async () => {
              const { data } = result();
              return { data: data[0] ?? null, error: null };
            };
          }
          return (...args: unknown[]) => {
            fake.calls.push({ table, method: String(property), args });
            if (property === 'limit') limit = Number(args[0]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return {
    from: (table: string) => builder(table),
    rpc: (name: string) => builder(`rpc:${name}`),
    auth: {
      getUser: async () => ({ data: { user: { id: 'a8000000-0000-4000-8000-000000000001' } }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: 'a8000000-0000-4000-8000-000000000001', role: 'authenticated', amr: [{ method: 'password' }] } },
        error: null,
      }),
    },
  };
});
vi.mock('@/lib/db/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => {
    throw new Error('service_role non ammessa negli elenchi');
  },
}));

beforeEach(() => {
  fake.rows = {};
  fake.calls = [];
  fake.role = 'admin';
  fake.ownBarberId = null;
  vi.resetModules();
});

const callsOn = (table: string, method: string): Call[] => fake.calls.filter((c) => c.table === table && c.method === method);
const html = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const strings = async () => (await import('@/i18n/it')).it as unknown as Record<string, Record<string, Record<string, unknown>>>;
const fill = async (template: string, values: Record<string, number>): Promise<string> => {
  const { fillText } = await import('@/lib/admin/text');
  return fillText(template, values);
};
const textKey = async (path: string): Promise<string> => {
  let node: unknown = await strings();
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  expect(typeof node === 'string' && node.trim() !== '', `manca it.${path} in src/i18n/it.ts`).toBe(true);
  return node as string;
};

const ROOT = process.cwd();
const sourceOf = (path: string): string => {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `file mancante: ${path}`).toBe(true);
  return readFileSync(absolute, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** n periodi in ordine di inizio decrescente (come li restituisce il database), tutti passati. */
const periods = (n: number, prefix: string, extra: Row = {}): Row[] =>
  Array.from({ length: n }, (_, i) => {
    const start = new Date(Date.UTC(2026, 9, 1) - i * 86_400_000);
    return {
      id: id(prefix, i + 1),
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
      reason: `Motivo ${i + 1}`,
      ...extra,
    };
  });
const linksTo = (markup: string, base: string): Set<string> =>
  new Set([...markup.matchAll(new RegExp(`href="${base}/([0-9a-f-]{36})"`, 'g'))].map((m) => m[1]));

// ---------------------------------------------------------------------------
// Limiti esportati
// ---------------------------------------------------------------------------
describe('limiti espliciti degli elenchi (fetta 8h)', () => {
  test('PERIODS_LIST_LIMIT = 200, MY_BOOKINGS_LIMIT = 200, CALENDAR_BOOKINGS_LIMIT = 1000', async () => {
    expect(((await import('@/lib/admin/periods')) as Record<string, unknown>).PERIODS_LIST_LIMIT).toBe(200);
    expect(((await import('@/lib/booking/queries')) as Record<string, unknown>).MY_BOOKINGS_LIMIT).toBe(200);
    expect(((await import('@/lib/calendar/queries')) as Record<string, unknown>).CALENDAR_BOOKINGS_LIMIT).toBe(1000);
  });

  test('testi degli avvisi in it.ts, con {count} dove serve', async () => {
    expect(await textKey('admin.period.listTruncated')).toContain('{count}');
    expect(await textKey('booking.list.myBookingsTruncated')).toContain('{count}');
    await textKey('admin.calendar.incomplete');
  });
});

// ---------------------------------------------------------------------------
// Chiusure – SPEC §6.6
// ---------------------------------------------------------------------------
type Page = (props: Record<string, unknown>) => Promise<ReactElement>;
const renderPage = async (module: string, props: Record<string, unknown> = {}): Promise<string> => {
  const { default: page } = (await import(/* @vite-ignore */ module)) as { default: Page };
  return renderToStaticMarkup(await page(props));
};

describe('/admin/chiusure: al massimo 200 righe, con avviso oltre (fetta 8h)', () => {
  const CLOSURES = '@/app/admin/(panel)/chiusure/page';

  test('query ordinata per inizio decrescente e limitata a 201 righe', async () => {
    fake.rows.shop_closures = periods(3, 'c8c00000');
    await renderPage(CLOSURES);
    expect(callsOn('shop_closures', 'order')).toContainEqual({
      table: 'shop_closures',
      method: 'order',
      args: ['starts_at', { ascending: false }],
    });
    expect(callsOn('shop_closures', 'limit').map((c) => c.args[0])).toEqual([201]);
  });

  test('201 righe nel database → 200 mostrate e avviso con count 200', async () => {
    fake.rows.shop_closures = periods(250, 'c8c00000');
    const markup = await renderPage(CLOSURES);
    const shown = linksTo(markup, '/admin/chiusure');
    expect(shown.size).toBe(200);
    expect(shown.has(id('c8c00000', 201)), 'la riga oltre il limite non compare').toBe(false);
    expect(markup).toContain(html(await fill(await textKey('admin.period.listTruncated'), { count: 200 })));
  });

  test('esattamente 200 righe → tutte mostrate, nessun avviso', async () => {
    fake.rows.shop_closures = periods(200, 'c8c00000');
    const markup = await renderPage(CLOSURES);
    expect(linksTo(markup, '/admin/chiusure').size).toBe(200);
    expect(markup).not.toContain(html(await fill(await textKey('admin.period.listTruncated'), { count: 200 })));
  });
});

// ---------------------------------------------------------------------------
// Assenze – SPEC §6.5 (barbiere: le proprie; admin: tutte o filtrate)
// ---------------------------------------------------------------------------
describe('/admin/assenze: al massimo 200 righe, con avviso oltre (fetta 8h)', () => {
  const TIME_OFF = '@/app/admin/(panel)/assenze/page';
  const OWN = 'b8c00000-0000-4000-8000-000000000001';
  const props = { searchParams: Promise.resolve({}) };

  test.each(['barber', 'admin'] as const)('%s: query per inizio decrescente, limitata a 201 righe', async (role) => {
    fake.role = role;
    fake.ownBarberId = OWN;
    fake.rows.barbers = [{ id: OWN, display_name: 'Mario' }];
    fake.rows.time_off = periods(3, 'af800000', { barber_id: OWN });
    await renderPage(TIME_OFF, props);
    expect(callsOn('time_off', 'order')).toContainEqual({ table: 'time_off', method: 'order', args: ['starts_at', { ascending: false }] });
    expect(callsOn('time_off', 'limit').map((c) => c.args[0])).toEqual([201]);
  });

  test.each(['barber', 'admin'] as const)('%s: oltre 200 righe → 200 mostrate e avviso con count 200', async (role) => {
    fake.role = role;
    fake.ownBarberId = OWN;
    fake.rows.barbers = [{ id: OWN, display_name: 'Mario' }];
    fake.rows.time_off = periods(230, 'af800000', { barber_id: OWN });
    const markup = await renderPage(TIME_OFF, props);
    const shown = linksTo(markup, '/admin/assenze');
    expect(shown.size).toBe(200);
    expect(shown.has(id('af800000', 201))).toBe(false);
    expect(markup).toContain(html(await fill(await textKey('admin.period.listTruncated'), { count: 200 })));
  });

  test.each(['barber', 'admin'] as const)('%s: 200 righe → nessun avviso', async (role) => {
    fake.role = role;
    fake.ownBarberId = OWN;
    fake.rows.barbers = [{ id: OWN, display_name: 'Mario' }];
    fake.rows.time_off = periods(200, 'af800000', { barber_id: OWN });
    const markup = await renderPage(TIME_OFF, props);
    expect(linksTo(markup, '/admin/assenze').size).toBe(200);
    expect(markup).not.toContain(html(await fill(await textKey('admin.period.listTruncated'), { count: 200 })));
  });

  test('le righe mostrate restano nell\'ordine di sortPeriodsForList (prima le future)', async () => {
    fake.role = 'barber';
    fake.ownBarberId = OWN;
    const future = { id: id('af800000', 999), starts_at: '2099-01-10T09:00:00Z', ends_at: '2099-01-10T10:00:00Z', reason: 'Futura', barber_id: OWN };
    const past = periods(2, 'af800000', { barber_id: OWN });
    fake.rows.time_off = [future, ...past];
    const markup = await renderPage(TIME_OFF, props);
    const order = [...markup.matchAll(/href="\/admin\/assenze\/([0-9a-f-]{36})"/g)].map((m) => m[1]);
    expect([...new Set(order)]).toEqual([future.id, past[0].id, past[1].id]);
  });
});

// ---------------------------------------------------------------------------
// Le mie prenotazioni – SPEC §5.3
// ---------------------------------------------------------------------------
type MyBookingsModule = {
  getMyBookings: (customerId: string) => Promise<{ bookings: Array<{ id: string }>; truncated: boolean } | null>;
};
const myBookingRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: id('d8c00000', i + 1),
    starts_at: new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString(),
    status: 'completed',
    duration_min: 30,
    price_cents: 2000,
    notes: null,
    services: { name: 'Taglio' },
    barbers: { display_name: 'Mario' },
  }));

describe('getMyBookings: al massimo 200 prenotazioni, con truncated (fetta 8h)', () => {
  const CUSTOMER = 'c8c00000-0000-4000-8000-000000000001';

  test('più di 200 → 200 prenotazioni (le più recenti) e truncated true; limite 201, ordine decrescente', async () => {
    fake.rows.bookings = myBookingRows(240);
    const { getMyBookings } = (await import('@/lib/booking/queries')) as unknown as MyBookingsModule;
    const result = await getMyBookings(CUSTOMER);
    expect(result?.truncated).toBe(true);
    expect(result?.bookings.map((b) => b.id)).toEqual(myBookingRows(200).map((r) => r.id));
    expect(callsOn('bookings', 'limit').map((c) => c.args[0])).toEqual([201]);
    expect(callsOn('bookings', 'order')).toContainEqual({ table: 'bookings', method: 'order', args: ['starts_at', { ascending: false }] });
    expect(callsOn('bookings', 'eq')).toContainEqual({ table: 'bookings', method: 'eq', args: ['customer_id', CUSTOMER] });
  });

  test.each([200, 0])('%i prenotazioni → tutte, truncated false', async (n) => {
    fake.rows.bookings = myBookingRows(n);
    const { getMyBookings } = (await import('@/lib/booking/queries')) as unknown as MyBookingsModule;
    const result = await getMyBookings(CUSTOMER);
    expect(result).toEqual({ bookings: expect.any(Array), truncated: false });
    expect(result?.bookings).toHaveLength(n);
  });

  test('/prenotazioni mostra l\'avviso con MY_BOOKINGS_LIMIT quando truncated', () => {
    const code = sourceOf('src/app/(customer)/prenotazioni/page.tsx');
    expect(code).toMatch(/\btruncated\b/);
    expect(code).toMatch(/fillText\(\s*(?:it\.booking\.list|t)\.myBookingsTruncated\s*,\s*\{\s*count:\s*MY_BOOKINGS_LIMIT\s*\}\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Calendario – SPEC §6.1
// ---------------------------------------------------------------------------
const BARBER = 'b8c00000-0000-4000-8000-000000000010';
const SETTINGS = { timezone: 'Europe/Rome', granularityMin: 15 };
const calendarRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => {
    const start = new Date(Date.parse('2027-03-02T08:00:00Z') + (i % 40) * 15 * 60_000);
    return {
      id: id('e8c00000', i + 1),
      barber_id: BARBER,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 15 * 60_000).toISOString(),
      blocked_until: new Date(start.getTime() + 15 * 60_000).toISOString(),
      status: 'cancelled_by_customer',
      guest_name: 'Ospite',
      service: { name: 'Taglio' },
      customer: null,
    };
  });

type PageDataModule = {
  loadDayView: (...args: unknown[]) => Promise<{ incomplete?: unknown }>;
  loadWeekView: (...args: unknown[]) => Promise<{ incomplete?: unknown }>;
};
const views = async () => {
  const data = (await import('@/lib/calendar/page-data')) as unknown as PageDataModule;
  const { parseCalendarQuery } = await import('@/lib/calendar/view');
  const barbers = [{ id: BARBER, displayName: 'Mario', isActive: true }];
  const client = fakeClient();
  return {
    day: () => data.loadDayView(client, SETTINGS, parseCalendarQuery({ data: '2027-03-02' }, '2027-03-01'), barbers),
    week: () =>
      data.loadWeekView(
        client,
        SETTINGS,
        parseCalendarQuery({ data: '2027-03-02', vista: 'settimana', barbiere: BARBER }, '2027-03-01'),
        barbers,
        null,
      ),
  };
};

describe('calendario: lettura limitata a 1000 prenotazioni e vista segnalata incompleta (fetta 8h)', () => {
  test('getBookingsInRange usa .limit(1000)', async () => {
    fake.rows.bookings = calendarRows(3);
    const { getBookingsInRange } = (await import('@/lib/calendar/queries')) as unknown as {
      getBookingsInRange: (...args: unknown[]) => Promise<unknown[]>;
    };
    await getBookingsInRange(fakeClient(), [BARBER], new Date('2027-03-01T23:00:00Z'), new Date('2027-03-02T23:00:00Z'));
    expect(callsOn('bookings', 'limit').map((c) => c.args[0])).toEqual([1000]);
  });

  test.each([
    [1500, true],
    [1000, true],
    [999, false],
  ])('vista giorno con %i prenotazioni nel database → incomplete %s', async (n, expected) => {
    fake.rows.bookings = calendarRows(n);
    const { day } = await views();
    expect((await day()).incomplete).toBe(expected);
  });

  test.each([
    [1500, true],
    [1000, true],
    [999, false],
  ])('vista settimana con %i prenotazioni nel database → incomplete %s', async (n, expected) => {
    fake.rows.bookings = calendarRows(n);
    fake.rows['rpc:shop_opening_hours'] = [{ weekday: 2, opens_at: '09:00', closes_at: '19:00' }];
    const { week } = await views();
    expect((await week()).incomplete).toBe(expected);
  });

  test('la pagina del calendario mostra it.admin.calendar.incomplete per la vista giorno e settimana', () => {
    const code = sourceOf('src/app/admin/(panel)/page.tsx');
    expect(code).toMatch(/\bweek\.incomplete\b/);
    expect(code).toMatch(/\bday\.incomplete\b/);
    expect(code).toMatch(/(?:it\.admin\.calendar|\bt)\.incomplete\b/);
  });
});
