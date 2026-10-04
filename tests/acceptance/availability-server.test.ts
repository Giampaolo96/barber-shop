// Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità"), lato server.
// src/lib/booking/availability.ts: getAvailableSlots / getAvailableDays con il client Supabase
// della richiesta (src/lib/db/server.ts), un'unica RPC availability_inputs per periodo.
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
type SlotsResult = { ok: true; slots: string[] } | { ok: false; error: 'invalid' | 'error' };
type DaysResult = { ok: true; days: string[] } | { ok: false; error: 'invalid' | 'error' };
type BookingAvailabilityModule = {
  /** date: giorno locale del negozio YYYY-MM-DD; barberId: uuid oppure "any". */
  getAvailableSlots: (args: { serviceId: string; barberId: string; date: string }) => Promise<SlotsResult>;
  /** from / to: giorni locali YYYY-MM-DD, inclusi. */
  getAvailableDays: (args: { serviceId: string; barberId: string; from: string; to: string }) => Promise<DaysResult>;
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
const B1 = 'b4000000-0000-4000-8000-000000000001';
const B2 = 'b4000000-0000-4000-8000-000000000002';

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

// Ora solare (+01:00): 09:00 locali = 08:00Z
const work = (barberId: string, start: string, end: string): Row => ({ kind: 'work', barber_id: barberId, starts_at: start, ends_at: end });
const busy = (barberId: string, start: string, end: string): Row => ({ kind: 'busy', barber_id: barberId, starts_at: start, ends_at: end });

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

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------
describe('getAvailableSlots – SPEC §4: solo orari, un\'unica RPC', () => {
  test('"qualsiasi": p_barber_id null, periodo che copre il giorno locale, unione ordinata di istanti ISO UTC', async () => {
    fake.rpcRows = [
      work(B1, '2027-03-02T08:00:00Z', '2027-03-02T09:00:00Z'), // 09:00–10:00
      work(B2, '2027-03-02T08:30:00Z', '2027-03-02T09:30:00Z'), // 09:30–10:30
    ];
    const { getAvailableSlots } = await load<BookingAvailabilityModule>(MODULE);
    const result = await getAvailableSlots({ serviceId: SERVICE, barberId: 'any', date: '2027-03-02' });

    expect(result).toEqual({
      ok: true,
      slots: [
        '2027-03-02T08:00:00.000Z',
        '2027-03-02T08:15:00.000Z',
        '2027-03-02T08:30:00.000Z',
        '2027-03-02T08:45:00.000Z',
        '2027-03-02T09:00:00.000Z',
      ],
    });
    expect(fake.rpcCalls).toHaveLength(1);
    const [call] = fake.rpcCalls;
    expect(call.name).toBe('availability_inputs');
    expect(call.args.p_service_id).toBe(SERVICE);
    expect(call.args.p_barber_id).toBeNull();
    // giorno locale 02/03 = [2027-03-01T23:00Z, 2027-03-02T23:00Z)
    expect(new Date(String(call.args.p_from)).getTime()).toBeLessThanOrEqual(Date.parse('2027-03-01T23:00:00Z'));
    expect(new Date(String(call.args.p_to)).getTime()).toBeGreaterThanOrEqual(Date.parse('2027-03-02T23:00:00Z'));
    expect(fake.adminClientCreated).toBe(false);
  });

  test('barbiere scelto: p_barber_id = uuid, le prenotazioni (busy) tolgono gli slot', async () => {
    fake.rpcRows = [
      work(B1, '2027-03-02T08:00:00Z', '2027-03-02T09:00:00Z'),
      busy(B1, '2027-03-02T08:00:00Z', '2027-03-02T08:30:00Z'),
    ];
    const { getAvailableSlots } = await load<BookingAvailabilityModule>(MODULE);
    const result = await getAvailableSlots({ serviceId: SERVICE, barberId: B1, date: '2027-03-02' });

    expect(result).toEqual({ ok: true, slots: ['2027-03-02T08:30:00.000Z'] });
    expect(fake.rpcCalls.map((c) => c.args.p_barber_id)).toEqual([B1]);
  });

  test('il risultato contiene solo istanti ISO UTC (nessun dato di prenotazioni o barbieri)', async () => {
    fake.rpcRows = [
      work(B1, '2027-03-02T08:00:00Z', '2027-03-02T12:00:00Z'),
      busy(B1, '2027-03-02T09:00:00Z', '2027-03-02T09:45:00Z'),
    ];
    const { getAvailableSlots } = await load<BookingAvailabilityModule>(MODULE);
    const result = await getAvailableSlots({ serviceId: SERVICE, barberId: 'any', date: '2027-03-02' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(['ok', 'slots']);
    expect(result.slots.length).toBeGreaterThan(0);
    for (const s of result.slots) expect(s).toMatch(ISO_UTC);
    expect(new Set(result.slots).size).toBe(result.slots.length);
    expect([...result.slots].sort()).toEqual(result.slots);
    expect(JSON.stringify(result)).not.toContain(B1);
  });

  test.each([
    ['serviceId non uuid', { serviceId: 'taglio', barberId: 'any', date: '2027-03-02' }],
    ['barberId né uuid né "any"', { serviceId: SERVICE, barberId: 'tutti', date: '2027-03-02' }],
    ['data inesistente', { serviceId: SERVICE, barberId: 'any', date: '2027-02-30' }],
    ['data in un altro formato', { serviceId: SERVICE, barberId: 'any', date: '02/03/2027' }],
    ['data con orario', { serviceId: SERVICE, barberId: 'any', date: '2027-03-02T09:00:00Z' }],
  ])('CLAUDE.md – Zod: %s → { ok: false, error: "invalid" } senza chiamare il DB', async (_name, args) => {
    const { getAvailableSlots } = await load<BookingAvailabilityModule>(MODULE);
    expect(await getAvailableSlots(args)).toEqual({ ok: false, error: 'invalid' });
    expect(fake.rpcCalls).toEqual([]);
  });

  test('errore del DB → risultato gestito (ok: false), nessuna eccezione', async () => {
    fake.rpcError = { code: 'XX000', message: 'boom' };
    const { getAvailableSlots } = await load<BookingAvailabilityModule>(MODULE);
    const result = await getAvailableSlots({ serviceId: SERVICE, barberId: 'any', date: '2027-03-02' });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAvailableDays
// ---------------------------------------------------------------------------
describe('getAvailableDays – un solo caricamento dei dati per tutto il periodo', () => {
  test('giorni locali con almeno uno slot; una sola RPC e una lettura di impostazioni e servizio', async () => {
    fake.rpcRows = [
      work(B1, '2027-03-02T08:00:00Z', '2027-03-02T09:00:00Z'),
      work(B1, '2027-03-03T08:00:00Z', '2027-03-03T08:30:00Z'),
      busy(B1, '2027-03-03T08:00:00Z', '2027-03-03T08:30:00Z'),
      work(B1, '2027-03-04T08:00:00Z', '2027-03-04T09:00:00Z'),
    ];
    const { getAvailableDays } = await load<BookingAvailabilityModule>(MODULE);
    const result = await getAvailableDays({ serviceId: SERVICE, barberId: B1, from: '2027-03-01', to: '2027-03-05' });

    expect(result).toEqual({ ok: true, days: ['2027-03-02', '2027-03-04'] });
    expect(fake.rpcCalls).toHaveLength(1);
    const [call] = fake.rpcCalls;
    expect(call.name).toBe('availability_inputs');
    expect(call.args.p_barber_id).toBe(B1);
    // dal 01/03 00:00 locale (2027-02-28T23:00Z) al 06/03 00:00 locale (2027-03-05T23:00Z)
    expect(new Date(String(call.args.p_from)).getTime()).toBeLessThanOrEqual(Date.parse('2027-02-28T23:00:00Z'));
    expect(new Date(String(call.args.p_to)).getTime()).toBeGreaterThanOrEqual(Date.parse('2027-03-05T23:00:00Z'));
    expect(fake.fromCalls.filter((t) => t === 'shop_settings').length).toBeLessThanOrEqual(1);
    expect(fake.fromCalls.filter((t) => t === 'services').length).toBeLessThanOrEqual(1);
    expect(fake.adminClientCreated).toBe(false);
  });

  test.each([
    ['from dopo to', { serviceId: SERVICE, barberId: 'any', from: '2027-03-05', to: '2027-03-01' }],
    ['data non valida', { serviceId: SERVICE, barberId: 'any', from: '2027-03-01', to: '2027-13-01' }],
    ['barberId non valido', { serviceId: SERVICE, barberId: '', from: '2027-03-01', to: '2027-03-05' }],
  ])('CLAUDE.md – Zod: %s → { ok: false, error: "invalid" }', async (_name, args) => {
    const { getAvailableDays } = await load<BookingAvailabilityModule>(MODULE);
    expect(await getAvailableDays(args)).toEqual({ ok: false, error: 'invalid' });
    expect(fake.rpcCalls).toEqual([]);
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
