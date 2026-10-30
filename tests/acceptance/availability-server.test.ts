// modificato in fetta 8g con l'approvazione dell'utente (2026-10-30, audit punto 6): tolti i test di getAvailableSlots e
// getAvailableDays; resta l'errore del DB, su getWhenDays.
// Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità"), lato server.
// src/lib/booking/availability.ts: getWhenDays con il client Supabase della richiesta
// (src/lib/db/server.ts).
// Sezioni: SPEC §4 (calcolo lato server, solo orari), §8, CLAUDE.md – regole 5 e 6, Sicurezza
// (Zod, service_role mai nel percorso di disponibilità) + decisioni approvate per la fetta 4.
//
// Il client Supabase è un finto in memoria che registra le chiamate (`from`, `rpc`).
// Interfaccia attesa per i dati: tabelle `shop_settings` e `services` (colonne con i nomi del DB),
// RPC `availability_inputs` con argomenti { p_service_id, p_barber_id, p_from, p_to } che
// restituisce righe { kind, barber_id, starts_at, ends_at }.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese
// ---------------------------------------------------------------------------
type BookingAvailabilityModule = {
  getWhenDays: (args: { serviceId: string; from: string; to: string }) => Promise<{ ok: boolean; error?: string }>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const MODULE = '@/lib/booking/availability';
const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Client Supabase finto
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const fake = vi.hoisted(() => ({
  fromCalls: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpcRows: [] as Array<Record<string, unknown>>,
  rpcError: null as null | { code: string; message: string },
  adminClientCreated: false,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

/** Query builder concatenabile: ogni metodo restituisce il builder, await → { data, error }. */
function builder(result: () => { data: unknown; error: unknown }): unknown {
  const target = {} as Record<string | symbol, unknown>;
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject);
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
      return builder(() => (fake.rpcError ? { data: null, error: fake.rpcError } : { data: fake.rpcRows, error: null }));
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
// Dati
// ---------------------------------------------------------------------------
const SERVICE = '54000000-0000-4000-8000-000000000001';

const SETTINGS: Row = {
  id: true,
  name: 'Barber Shop',
  timezone: 'Europe/Rome',
  slot_granularity_min: 15,
  min_advance_min: 60,
  max_horizon_days: 30,
  cancel_limit_min: 120,
  buffer_min: 0,
  no_show_block_threshold: 3,
  privacy_policy_version: '1',
};
const SERVICE_ROW: Row = {
  id: SERVICE,
  name: 'Taglio',
  description: null,
  duration_min: 30,
  price_cents: 2000,
  is_active: true,
  sort_order: 1,
};

beforeEach(() => {
  fake.fromCalls = [];
  fake.rpcCalls = [];
  fake.tables = { shop_settings: [{ ...SETTINGS }], services: [{ ...SERVICE_ROW }] };
  fake.rpcRows = [];
  fake.rpcError = null;
  fake.adminClientCreated = false;
  vi.useFakeTimers({ now: new Date('2027-03-01T08:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('getWhenDays – errore del DB', () => {
  test('errore del DB → risultato gestito (ok: false), nessuna eccezione', async () => {
    fake.rpcError = { code: 'XX000', message: 'boom' };
    const { getWhenDays } = await load<BookingAvailabilityModule>(MODULE);
    expect(await getWhenDays({ serviceId: SERVICE, from: '2027-03-02', to: '2027-03-02' })).toEqual({ ok: false, error: 'error' });
  });
});

// ---------------------------------------------------------------------------
// Confini dei moduli (CLAUDE.md – regola 5, Sicurezza)
// ---------------------------------------------------------------------------
describe('CLAUDE.md – motore puro e percorso senza service_role', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
  const engineFiles = (): string[] => {
    const dir = join(ROOT, 'src/lib/availability');
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `src/lib/availability/${f.replace(/\\/g, '/')}`);
  };

  test('src/lib/booking/availability.ts è solo server e non usa la service_role', () => {
    const source = read('src/lib/booking/availability.ts');
    expect(source).toMatch(/^\s*import\s+["']server-only["'];?/m);
    expect(source).not.toMatch(/createAdminClient|@\/lib\/db\/admin|SERVICE_ROLE/);
  });

  test('src/lib/availability/ esporta da index.ts e non fa I/O', () => {
    const files = engineFiles();
    expect(files).toContain('src/lib/availability/index.ts');
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /from\s+["'](@supabase\/|next\/|next["']|@\/lib\/db|server-only|node:|fs["']|path["'])/,
      );
      expect(source, file).not.toMatch(/\bfetch\(|process\.env|Date\.now\(|new Date\(\)/);
    }
  });
});
