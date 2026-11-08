// Test di accettazione – FETTA 8h "Sicurezza dati" (nota di docs/PROGRESS.md: "da verificare se la
// route degli orari applica anche il blocco per soglia di no-show"; decisioni approvate dall'utente il
// 2026-11-08). SPEC §3.1 (no_show_block_threshold, 0 = disattivato), §3.7.4 e §5.3 (cliente bloccato
// manualmente o per no-show: niente prenotazione online), §12 (cliente bloccato per no-show).
// Client Supabase finto come in booking-when-8g-server.test.ts.
//
// Interfaccia attesa (già esistente):
//   GET /prenota/quando/orari?servizio&da&a – cliente con is_blocked = false ma no_show_count >=
//   no_show_block_threshold (soglia > 0) → 403 { error: "blocked" }, nessuna lettura degli orari
//   (né availability_inputs_json né availability_inputs).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  noShowCount: 0,
  adminClientCreated: false,
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
  // Non bloccato a mano: il blocco viene solo dai no-show
  const user = { id: 'c8b00000-0000-4000-8000-000000000001', role: 'customer', isBlocked: false, fullName: 'Cliente', profileComplete: true };
  return {
    getCurrentUser: async () => user,
    getVerifiedUserId: async () => user.id,
    getCurrentNoShowCount: async () => fake.noShowCount,
    loadCurrentUser: async () => user,
    requireRole: async () => user,
  };
});

function builder(result: () => { data: unknown; error: unknown }): unknown {
  const proxy: unknown = new Proxy({} as Record<string | symbol, unknown>, {
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
      return builder(() => ({ data: [], error: null }));
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'c8b00000-0000-4000-8000-000000000001' } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: 'c8b00000-0000-4000-8000-000000000001', role: 'authenticated' } }, error: null }),
    },
  }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => {
    fake.adminClientCreated = true;
    throw new Error('service_role non ammessa nel percorso di disponibilità');
  },
}));

const SERVICE = '58b00000-0000-4000-8000-000000000001';
const settings = (threshold: number) => ({
  id: true,
  name: 'Barber Shop',
  timezone: 'Europe/Rome',
  slot_granularity_min: 15,
  min_advance_min: 60,
  max_horizon_days: 30,
  cancel_limit_min: 120,
  buffer_min: 0,
  no_show_block_threshold: threshold,
  privacy_policy_version: '1',
});

const callRoute = async (): Promise<Response> => {
  const { GET } = (await import('@/app/(customer)/prenota/quando/orari/route')) as {
    GET: (request: NextRequest) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/prenota/quando/orari?servizio=${SERVICE}&da=2027-03-02&a=2027-03-04`));
};
const availabilityReads = () => fake.rpcCalls.filter((c) => c.name === 'availability_inputs_json' || c.name === 'availability_inputs');

beforeEach(() => {
  fake.rpcCalls = [];
  fake.adminClientCreated = false;
  fake.noShowCount = 0;
  fake.tables = {
    shop_settings: [settings(3)],
    services: [{ id: SERVICE, name: 'Taglio', description: null, duration_min: 30, price_cents: 2000, is_active: true, sort_order: 1 }],
  };
  vi.useFakeTimers({ now: new Date('2027-03-01T08:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GET /prenota/quando/orari – blocco per soglia di no-show (fetta 8h, SPEC §3.7.4, §12)', () => {
  test.each([3, 7])('is_blocked false e %i no-show con soglia 3 → 403 { error: "blocked" }, nessuna lettura degli orari', async (count) => {
    fake.noShowCount = count;
    const response = await callRoute();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'blocked' });
    expect(availabilityReads()).toEqual([]);
    expect(fake.adminClientCreated).toBe(false);
  });

  test('2 no-show con soglia 3 → non bloccato, gli orari si leggono', async () => {
    fake.noShowCount = 2;
    const response = await callRoute();
    expect(response.status).toBe(200);
    expect(availabilityReads()).toHaveLength(1);
  });

  test('soglia 0 (blocco automatico disattivato) con 10 no-show → non bloccato', async () => {
    fake.tables.shop_settings = [settings(0)];
    fake.noShowCount = 10;
    const response = await callRoute();
    expect(response.status).toBe(200);
  });
});
