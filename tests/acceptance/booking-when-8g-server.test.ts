// Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
// Test di accettazione – FETTA 8g ("Quando?": orari di tutti i giorni dal server; decisioni approvate
// dall'utente il 2026-10-25). SPEC §5.2 ("una sola richiesta ... restituisce solo orari e id dei
// barbieri"), §4, CLAUDE.md regola 6 (solo orari liberi) e Sicurezza (requireRole in ogni route
// handler, Zod, mai la service_role). Client Supabase finto come in booking-when.test.ts.
//
// Interfacce attese:
//   src/lib/booking/availability.ts ("server-only"):
//     getWhenOverview(args: { serviceId: string; requestedDay?: string }): Promise<WhenOverview>
//     WhenOverview =
//       | { ok: true;
//           days: DayStatus[];            // da oggi all'ultimo giorno prenotabile (come prima)
//           initialDay: string | null;    // initialDay(days, requestedDay); null = stato vuoto
//           whenDays: WhenDay[];          // UNO per ogni giorno della fila (rowDays(days): i non chiusi), in ordine
//           recentId: string | null }     // barbiere dell'ultimo appuntamento (ordine delle colonne)
//       | { ok: false }
//     WhenDay = { date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> }
//       slots in ISO UTC; next = primo orario nei giorni dopo fino all'ultimo giorno prenotabile, solo
//       per i barbieri senza orari quel giorno. Una sola chiamata ad availability_inputs per tutto il
//       periodo (da oggi a oggi + max_horizon_days), mai la service_role.
//   src/app/(customer)/prenota/quando/orari/route.ts:
//     export const dynamic = "force-dynamic"   (o export const revalidate = 0)
//     export async function GET(request: NextRequest | Request): Promise<Response>
//       prima istruzione: await requireRole(["customer"]) (redirect al login senza sessione);
//       query: servizio (uuid), da e a (YYYY-MM-DD valide, oggi ≤ da ≤ a ≤ oggi + max_horizon_days),
//       validate con Zod; non valide → 400;
//       200: JSON { days: WhenDay[] } con i giorni NON chiusi in [da, a] nell'ordine (next calcolato
//       fino all'ultimo giorno prenotabile, anche oltre `a`); header Cache-Control "private, no-store",
//       Content-Type application/json.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Finti: Supabase, sessione, navigazione
// ---------------------------------------------------------------------------
const fake = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpcRows: [] as Array<Record<string, unknown>>,
  adminClientCreated: false,
  session: true,
  requireRoleCalls: [] as unknown[],
}));

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
    id: 'c8a00000-0000-4000-8000-000000000001',
    role: 'customer',
    isBlocked: false,
    fullName: 'Cliente',
    profileComplete: true,
  };
  return {
    getCurrentUser: async () => (fake.session ? user : null),
    getVerifiedUserId: async () => (fake.session ? user.id : null),
    getCurrentNoShowCount: async () => (fake.session ? 0 : null),
    loadCurrentUser: async () => (fake.session ? user : null),
    requireRole: async (roles: unknown) => {
      fake.requireRoleCalls.push(roles);
      if (!fake.session) throw new Error('redirect /accedi');
      return user;
    },
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
    from: (table: string) => builder(() => ({ data: fake.tables[table] ?? [], error: null })),
    rpc: (name: string, args: Record<string, unknown>) => {
      fake.rpcCalls.push({ name, args });
      return builder(() => ({ data: name === 'availability_inputs_json' ? fake.rpcRows : [], error: null }));
    },
    auth: {
      getUser: async () => ({
        data: { user: fake.session ? { id: 'c8a00000-0000-4000-8000-000000000001' } : null },
        error: null,
      }),
      getClaims: async () => ({
        data: fake.session ? { claims: { sub: 'c8a00000-0000-4000-8000-000000000001', role: 'authenticated' } } : null,
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

// ---------------------------------------------------------------------------
// Dati: oggi = lun 01/03/2027 09:00 locali, periodo prenotabile fino al 31/03 (30 giorni, ora legale dal 28)
// ---------------------------------------------------------------------------
const TZ = 'Europe/Rome';
const SERVICE = '58a00000-0000-4000-8000-000000000001';
const B1 = 'b8a00000-0000-4000-8000-000000000001';
const B2 = 'b8a00000-0000-4000-8000-000000000002';
const B3 = 'b8a00000-0000-4000-8000-000000000003';
const CUSTOMER = 'c8a00000-0000-4000-8000-000000000001';
const BOOKING_ID = 'd8a00000-0000-4000-8000-000000000001';
/** Dati di prenotazioni e clienti che non devono mai uscire (nell'overview "status" c'è già, nei DayStatus). */
const SECRETS = [CUSTOMER, BOOKING_ID, 'Ospite Riservato', '+393339999999', 'completed', 'confirmed', 'busy', 'guest_name', 'customer_id'];

const row = (kind: string, barberId: string | null, start: string, end: string) => ({
  kind,
  barber_id: barberId,
  starts_at: start,
  ends_at: end,
});

type WhenDay = { date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> };
type DayStatus = { date: string; status: 'closed' | 'full' | 'open' };
type WhenOverview =
  | { ok: true; days: DayStatus[]; initialDay: string | null; whenDays: WhenDay[]; recentId: string | null }
  | { ok: false };
type AvailabilityModule = { getWhenOverview: (args: { serviceId: string; requestedDay?: string }) => Promise<WhenOverview> };
type RouteModule = {
  GET: (request: NextRequest, context: { params: Promise<Record<string, never>> }) => Promise<Response>;
  dynamic?: unknown;
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;
const ROUTE = '@/app/(customer)/prenota/quando/orari/route';
const callRoute = async (query: string): Promise<Response> => {
  const { GET } = await load<RouteModule>(ROUTE);
  expect(GET, 'export mancante: GET').toBeTypeOf('function');
  return GET(new NextRequest(`http://localhost/prenota/quando/orari?${query}`), { params: Promise.resolve({}) });
};
const availabilityCalls = () => fake.rpcCalls.filter((c) => c.name === 'availability_inputs_json');
const byBarber = (day: WhenDay | undefined) => Object.fromEntries((day?.barbers ?? []).map((b) => [b.barberId, b]));

beforeEach(() => {
  fake.rpcCalls = [];
  fake.adminClientCreated = false;
  fake.session = true;
  fake.requireRoleCalls = [];
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
    // storico del cliente: mai nell'uscita (conta solo come barbiere dell'ultimo appuntamento)
    bookings: [
      {
        id: BOOKING_ID,
        customer_id: CUSTOMER,
        barber_id: B2,
        starts_at: '2027-02-20T09:00:00Z',
        status: 'completed',
        guest_name: 'Ospite Riservato',
        guest_phone: '+393339999999',
      },
    ],
    profiles: [{ id: CUSTOMER, role: 'customer', full_name: 'Cliente', phone: '+393330000000', is_blocked: false }],
  };
  fake.rpcRows = [
    // 02/03 (ora solare): B1 09:00–10:00, B2 09:30–10:30 locali; B2 occupato 10:00–10:30
    row('work', B1, '2027-03-02T08:00:00Z', '2027-03-02T09:00:00Z'),
    row('work', B2, '2027-03-02T08:30:00Z', '2027-03-02T09:30:00Z'),
    row('busy', B2, '2027-03-02T09:00:00Z', '2027-03-02T09:30:00Z'),
    // 04/03: solo B3 09:00–10:00
    row('work', B3, '2027-03-04T08:00:00Z', '2027-03-04T09:00:00Z'),
    // 31/03, ultimo giorno prenotabile (ora legale, +02:00): B1 09:00–09:30
    row('work', B1, '2027-03-31T07:00:00Z', '2027-03-31T07:30:00Z'),
  ];
  vi.useFakeTimers({ now: new Date('2027-03-01T08:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getWhenOverview – SPEC §5.2: la pagina riceve gli orari di tutti i giorni della fila
// ---------------------------------------------------------------------------
describe('getWhenOverview – orari di tutti i giorni della fila da una sola lettura (fetta 8g)', () => {
  test('una sola chiamata ad availability_inputs per tutto il periodo prenotabile, nessuna service_role', async () => {
    const { getWhenOverview } = await load<AvailabilityModule>('@/lib/booking/availability');
    const overview = await getWhenOverview({ serviceId: SERVICE });
    expect(overview.ok).toBe(true);
    expect(availabilityCalls()).toHaveLength(1);
    expect(availabilityCalls()[0]?.args).toMatchObject({
      p_service_id: SERVICE,
      p_barber_id: null,
      p_from: '2027-02-28T23:00:00.000Z', // 01/03 00:00 a Roma
      p_to: '2027-03-31T22:00:00.000Z', // 01/04 00:00 a Roma (ora legale)
    });
    expect(fake.adminClientCreated).toBe(false);
  });

  test('whenDays: uno per ogni giorno della fila (non chiusi), con orari e prossimo orario fino all\'ultimo giorno', async () => {
    const { getWhenOverview } = await load<AvailabilityModule>('@/lib/booking/availability');
    const overview = await getWhenOverview({ serviceId: SERVICE });
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    const rowDays = overview.days.filter((d) => d.status !== 'closed').map((d) => d.date);
    expect(rowDays).toEqual(['2027-03-02', '2027-03-04', '2027-03-31']);
    expect(overview.whenDays.map((d) => d.date), 'giorni della fila, in ordine').toEqual(rowDays);
    expect(overview.initialDay).toBe('2027-03-02');

    const [d02, d04, d31] = overview.whenDays;
    expect(byBarber(d02)[B1]).toEqual({
      barberId: B1,
      slots: ['2027-03-02T08:00:00.000Z', '2027-03-02T08:15:00.000Z', '2027-03-02T08:30:00.000Z'],
      next: null,
    });
    expect(byBarber(d02)[B2]).toEqual({ barberId: B2, slots: ['2027-03-02T08:30:00.000Z'], next: null });
    expect(byBarber(d02)[B3]).toEqual({ barberId: B3, slots: [], next: '2027-03-04T08:00:00.000Z' });
    expect(byBarber(d04)[B1], 'prossimo orario anche a fine periodo').toEqual({
      barberId: B1,
      slots: [],
      next: '2027-03-31T07:00:00.000Z',
    });
    expect(byBarber(d04)[B3]?.slots).toEqual(['2027-03-04T08:00:00.000Z', '2027-03-04T08:15:00.000Z', '2027-03-04T08:30:00.000Z']);
    expect(byBarber(d31)[B1]?.slots, 'ultimo giorno prenotabile incluso').toEqual(['2027-03-31T07:00:00.000Z']);
    expect(byBarber(d31)[B2]).toEqual({ barberId: B2, slots: [], next: null });
  });

  test('giorno richiesto non chiuso → initialDay; ultimo appuntamento del cliente → recentId', async () => {
    const { getWhenOverview } = await load<AvailabilityModule>('@/lib/booking/availability');
    const overview = await getWhenOverview({ serviceId: SERVICE, requestedDay: '2027-03-04' });
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.initialDay).toBe('2027-03-04');
    expect(overview.recentId).toBe(B2);
    const closedRequested = await getWhenOverview({ serviceId: SERVICE, requestedDay: '2027-03-03' });
    expect(closedRequested.ok && closedRequested.initialDay, 'giorno chiuso → primo con orari').toBe('2027-03-02');
  });

  test('solo le chiavi previste: nessun dato di prenotazioni o clienti (CLAUDE.md regola 6)', async () => {
    const { getWhenOverview } = await load<AvailabilityModule>('@/lib/booking/availability');
    const overview = await getWhenOverview({ serviceId: SERVICE });
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(Object.keys(overview).sort()).toEqual(['days', 'initialDay', 'ok', 'recentId', 'whenDays']);
    for (const day of overview.whenDays) {
      expect(Object.keys(day).sort()).toEqual(['barbers', 'date']);
      for (const entry of day.barbers) expect(Object.keys(entry).sort()).toEqual(['barberId', 'next', 'slots']);
    }
    const json = JSON.stringify(overview);
    for (const secret of SECRETS) expect(json, secret).not.toContain(secret);
    // l'inizio della prenotazione altrui su B2 (10:00 locali del 02/03) non è un orario libero
    expect(json).not.toContain('2027-03-02T09:00:00.000Z');
  });

  test('nessun barbiere lavora nel periodo → stato vuoto: initialDay null, whenDays []', async () => {
    fake.rpcRows = [];
    const { getWhenOverview } = await load<AvailabilityModule>('@/lib/booking/availability');
    const overview = await getWhenOverview({ serviceId: SERVICE });
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.initialDay).toBeNull();
    expect(overview.whenDays).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Route handler GET /prenota/quando/orari – ricarica in background (fetta 8g)
// ---------------------------------------------------------------------------
describe('GET /prenota/quando/orari – solo orari, input validato, risposta privata (fetta 8g)', () => {
  test('200: giorni non chiusi in [da, a], next anche oltre `a`, Cache-Control private no-store, JSON', async () => {
    const response = await callRoute(`servizio=${SERVICE}&da=2027-03-02&a=2027-03-04`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toContain('application/json');
    const cache = response.headers.get('cache-control') ?? '';
    expect(cache).toContain('private');
    expect(cache).toContain('no-store');
    const body = (await response.json()) as { days: WhenDay[] };
    expect(body.days.map((d) => d.date), '03/03 è chiuso').toEqual(['2027-03-02', '2027-03-04']);
    expect(byBarber(body.days[0])[B1]?.slots).toEqual(['2027-03-02T08:00:00.000Z', '2027-03-02T08:15:00.000Z', '2027-03-02T08:30:00.000Z']);
    expect(byBarber(body.days[1])[B1], 'next fino all\'ultimo giorno prenotabile').toEqual({
      barberId: B1,
      slots: [],
      next: '2027-03-31T07:00:00.000Z',
    });
    expect(availabilityCalls()).toHaveLength(1);
    expect(fake.adminClientCreated).toBe(false);
    expect(fake.requireRoleCalls, 'requireRole chiamato').toHaveLength(1);
    expect(fake.requireRoleCalls[0]).toEqual(expect.arrayContaining(['customer']));

    const single = (await (await callRoute(`servizio=${SERVICE}&da=2027-03-02&a=2027-03-02`)).json()) as { days: WhenDay[] };
    expect(single.days.map((d) => d.date)).toEqual(['2027-03-02']);
    expect(byBarber(single.days[0])[B3]?.next, 'next oltre `a`').toBe('2027-03-04T08:00:00.000Z');
  });

  test('solo le chiavi previste: { days }, e per ogni giorno solo orari e id dei barbieri', async () => {
    const response = await callRoute(`servizio=${SERVICE}&da=2027-03-01&a=2027-03-31`);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown> & { days: WhenDay[] };
    expect(Object.keys(body)).toEqual(['days']);
    for (const day of body.days) {
      expect(Object.keys(day).sort()).toEqual(['barbers', 'date']);
      for (const entry of day.barbers) expect(Object.keys(entry).sort()).toEqual(['barberId', 'next', 'slots']);
    }
    for (const secret of [...SECRETS, 'status', 'recentId']) expect(text, secret).not.toContain(secret);
    expect(text).not.toContain('2027-03-02T09:00:00.000Z');
  });

  test.each([
    ['senza parametri', ''],
    ['servizio non uuid', 'servizio=taglio&da=2027-03-02&a=2027-03-04'],
    ['senza a', `servizio=${SERVICE}&da=2027-03-02`],
    ['da inesistente', `servizio=${SERVICE}&da=2027-02-30&a=2027-03-04`],
    ['formato sbagliato', `servizio=${SERVICE}&da=02/03/2027&a=2027-03-04`],
    ['a prima di da', `servizio=${SERVICE}&da=2027-03-04&a=2027-03-02`],
  ])('parametri non validi (%s) → 400, nessuna lettura degli orari', async (_label, query) => {
    const response = await callRoute(query);
    expect(response.status).toBe(400);
    expect(availabilityCalls()).toEqual([]);
    expect(await response.text()).not.toContain('slots');
  });

  test.each([
    ['da prima di oggi', `servizio=${SERVICE}&da=2027-02-28&a=2027-03-04`],
    ['a oltre l\'ultimo giorno prenotabile', `servizio=${SERVICE}&da=2027-03-02&a=2027-04-01`],
  ])('fuori dal periodo prenotabile (%s) → 400', async (_label, query) => {
    const response = await callRoute(query);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('slots');
  });

  test('senza sessione: requireRole respinge (redirect al login) prima di leggere o validare', async () => {
    fake.session = false;
    await expect(callRoute(`servizio=${SERVICE}&da=2027-03-02&a=2027-03-04`)).rejects.toThrow(/redirect/);
    await expect(callRoute('servizio=taglio')).rejects.toThrow(/redirect/);
    expect(fake.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Struttura – CLAUDE.md Sicurezza: requireRole in ogni route handler, niente cache, niente service_role
// ---------------------------------------------------------------------------
const ROOT = process.cwd();
const ROUTE_FILE = 'src/app/(customer)/prenota/quando/orari/route.ts';
const sourceOf = (path: string): string => {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `file mancante: ${path}`).toBe(true);
  return readFileSync(absolute, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

describe('struttura del route handler degli orari (fetta 8g)', () => {
  test('GET chiama requireRole come prima istruzione', () => {
    const code = sourceOf(ROUTE_FILE);
    expect(code).toMatch(
      /export\s+(?:async\s+function\s+GET\s*\([^)]*\)\s*(?::\s*[^{]+)?\{|const\s+GET\s*=\s*async\s*\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{)\s*(?:(?:const|let)\s+[\w{}\s,:]+=\s*)?await\s+requireRole\s*\(/,
    );
  });

  test('dinamico: export const dynamic = "force-dynamic" (o revalidate = 0); Cache-Control private, no-store', () => {
    const code = sourceOf(ROUTE_FILE);
    expect(code).toMatch(/export\s+const\s+(?:dynamic\s*=\s*['"]force-dynamic['"]|revalidate\s*=\s*0\b)/);
    expect(code).toMatch(/Cache-Control['"]?\s*[:,]\s*['"]private,\s*no-store['"]/i);
  });

  test('nessuna service_role nel route handler né in availability.ts', () => {
    for (const path of [ROUTE_FILE, 'src/lib/booking/availability.ts']) {
      expect(sourceOf(path), path).not.toMatch(/@\/lib\/db\/admin|createAdminClient|service_role|SERVICE_ROLE/i);
    }
  });
});
