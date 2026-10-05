// Test di accettazione – FETTA 6b (SPEC §11: "Admin: clienti – l'admin trova un cliente, ne vede lo
// storico e lo blocca o sblocca").
// Sezioni: SPEC §2 (clienti: solo admin), §3.1 (no_show_block_threshold, 0 = disattivato), §5.3
// (cliente bloccato manualmente o per no-show), §6.2 (ricerca cliente nella manuale), §6.7, §12
// (cliente bloccato per no-show), CLAUDE.md – Sicurezza (requireRole + Zod in ogni server action e
// pagina di /admin, niente service role) + decisioni approvate per la fetta 6b.
//
// Interfacce attese:
//   src/lib/customers/status.ts
//     customerBlockStatus(profile: { isBlocked: boolean; noShowCount: number }, threshold: number)
//       → { manual: boolean; noShow: boolean; blocked: boolean }   (soglia 0 = disattivato, bordo >=)
//   src/lib/customers/schemas.ts
//     customerListQuerySchema: { q?: string; pagina?: string } → { q: string (trim, max 100); page: number (≥ 1,
//       default 1, valori non validi → 1) }
//     customerIdSchema: uuid
//     setCustomerBlockedSchema: { customerId: uuid; blocked: "true" | "false" } → { customerId; blocked: boolean }
//   src/lib/customers/paths.ts
//     customersPath(params?: { q?: string; page?: number }) → /admin/clienti?q=…&pagina=N
//     customerPath(id) → /admin/clienti/<id>
//   src/lib/customers/actions.ts ("use server"), firma (prev, formData) → { status: "saved" | "invalid" |
//     "forbidden" | "error" }: setCustomerBlocked (customerId, blocked), resetNoShows (customerId);
//     entrambe requireRole(["admin"]); scrivono con il client della sessione (RLS), mai la service role:
//       setCustomerBlocked → update profiles set is_blocked where id = customerId
//       resetNoShows       → rpc reset_no_show_count({ p_customer_id })
//     setCustomerBlocked filtra l'update su role = 'customer' (.eq('role', 'customer')); 0 righe
//     aggiornate → "error" (punto 4 approvato dopo la prima consegna).
//     Mappatura errori del database: P0002 → "error", 42501 → "forbidden" (punto 8).
//   src/lib/calendar/actions.ts searchCustomers(query) → { ok: true, matches: { id, fullName, phone,
//     blocked: boolean | null }[], blockStatusUnknown: boolean } | { ok: false }; "blocked" da rpc
//     blocked_customer_ids({ p_ids }) (decisione 8). Se quella rpc fallisce: ok: true con i risultati,
//     blocked: null su ogni match, blockStatusUnknown: true e console.error (punto 7 modificato).
//   Pagine: src/app/admin/(panel)/clienti/page.tsx e clienti/[id]/page.tsx con requireRole(["admin"]).
//   Testi in src/i18n/it.ts sotto admin.customers (REQUIRED_KEYS) e admin.calendar.form.customerBlocked.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { it as texts } from '@/i18n/it';

// ---------------------------------------------------------------------------
// Moduli attesi (import dinamico: un modulo mancante fa fallire solo i suoi test)
// ---------------------------------------------------------------------------
type BlockStatus = { manual: boolean; noShow: boolean; blocked: boolean };
type StatusModule = {
  customerBlockStatus: (profile: { isBlocked: boolean; noShowCount: number }, threshold: number) => BlockStatus;
};
type SafeParse = (input: unknown) => { success: boolean; data?: unknown };
type SchemasModule = {
  customerListQuerySchema: { safeParse: SafeParse };
  customerIdSchema: { safeParse: SafeParse };
  setCustomerBlockedSchema: { safeParse: SafeParse };
};
type PathsModule = {
  customersPath: (params?: { q?: string; page?: number }) => string;
  customerPath: (id: string) => string;
};
type ActionResult = { status: 'saved' | 'invalid' | 'forbidden' | 'error' };
type Action = (prev: unknown, formData: FormData) => Promise<ActionResult>;
type ActionsModule = { setCustomerBlocked: Action; resetNoShows: Action };
type SearchModule = {
  searchCustomers: (
    query: string,
  ) => Promise<
    | {
        ok: true;
        matches: Array<{ id: string; fullName: string; phone: string | null; blocked: boolean | null }>;
        blockStatusUnknown: boolean;
      }
    | { ok: false }
  >;
};

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

// ---------------------------------------------------------------------------
// Ambiente finto per le server action: requireRole e client Supabase
// ---------------------------------------------------------------------------
type Call = { client: 'server' | 'admin'; target: string; action: string; values?: unknown; args?: unknown; filters: unknown[][] };
type Result = { data?: unknown; error?: { code: string; message?: string } | null; count?: number | null };

const fake = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'barber' | 'customer',
  roleCalls: [] as unknown[][],
  calls: [] as Array<{ client: 'server' | 'admin'; target: string; action: string; values?: unknown; args?: unknown; filters: unknown[][] }>,
  resolve: (() => ({ data: null, error: null })) as (call: {
    client: 'server' | 'admin';
    target: string;
    action: string;
    values?: unknown;
    args?: unknown;
    filters: unknown[][];
  }) => { data?: unknown; error?: { code: string; message?: string } | null; count?: number | null },
  makeClient: null as unknown as (kind: 'server' | 'admin') => unknown,
}));

const redirectError = (to: string): Error =>
  Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw redirectError(to);
  },
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
  },
}));
// Come il vero requireRole: chi non ha il ruolo viene rimandato via con un redirect
vi.mock('@/lib/auth/current-user', () => ({
  requireRole: async (allowed: readonly string[]) => {
    fake.roleCalls.push([...allowed]);
    if (!allowed.includes(fake.role)) {
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' });
    }
    return { id: 'a0000000-0000-4000-8000-000000000001', role: fake.role, isBlocked: false, profileComplete: true };
  },
  getCurrentUser: async () => ({ id: 'a0000000-0000-4000-8000-000000000001', role: fake.role, isBlocked: false, profileComplete: true }),
}));
vi.mock('@/lib/db/server', () => ({ createClient: async () => fake.makeClient('server') }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => fake.makeClient('admin') }));

const builder = (client: 'server' | 'admin', table: string): unknown => {
  const call: Call = { client, target: table, action: 'select', filters: [] };
  const run = (): Result => {
    fake.calls.push(call);
    return { data: null, error: null, ...fake.resolve(call) };
  };
  const self: Record<string, unknown> = {};
  const chain = (fn?: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn?.(...args);
    return self;
  };
  const filter = (name: string) => chain((...args: unknown[]) => call.filters.push([name, ...args]));
  Object.assign(self, {
    select: chain(),
    insert: chain((v: unknown) => ((call.action = 'insert'), (call.values = v))),
    update: chain((v: unknown) => ((call.action = 'update'), (call.values = v))),
    upsert: chain((v: unknown) => ((call.action = 'upsert'), (call.values = v))),
    delete: chain(() => (call.action = 'delete')),
    eq: filter('eq'),
    neq: filter('neq'),
    in: filter('in'),
    is: filter('is'),
    match: filter('match'),
    order: chain(),
    limit: chain(),
    range: chain(),
    single: async () => run(),
    maybeSingle: async () => run(),
    then: (ok: (r: Result) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
  });
  return self;
};

fake.makeClient = (kind) => ({
  from: (table: string) => builder(kind, table),
  rpc: async (name: string, args?: unknown) => {
    const call: Call = { client: kind, target: `rpc:${name}`, action: 'rpc', args, filters: [] };
    fake.calls.push(call);
    return { data: null, error: null, ...fake.resolve(call) };
  },
  auth: { getUser: async () => ({ data: { user: { id: 'a0000000-0000-4000-8000-000000000001' } }, error: null }) },
});

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

/** Esito di un'azione rifiutata: redirect di requireRole oppure { status: "forbidden" }. */
const refusal = async (run: () => Promise<ActionResult>): Promise<string> => {
  try {
    return (await run()).status;
  } catch (error) {
    return (error as { digest?: string }).digest?.startsWith('NEXT_REDIRECT') ? 'redirect' : `throw: ${String(error)}`;
  }
};

const CUSTOMER = 'c0000000-0000-4000-8000-0000000006b1';
const OTHER = 'c0000000-0000-4000-8000-0000000006b2';

beforeEach(() => {
  fake.role = 'admin';
  fake.roleCalls = [];
  fake.calls = [];
  fake.resolve = () => ({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// Stato del cliente – SPEC §3.1, §5.3, §6.7, §12; decisione 3
// ---------------------------------------------------------------------------
describe('customerBlockStatus (SPEC §6.7: attivo / bloccato dall\'admin / per no-show / entrambi)', () => {
  test.each([
    // [isBlocked, noShowCount, soglia, atteso]
    [false, 0, 3, { manual: false, noShow: false, blocked: false }],
    [false, 2, 3, { manual: false, noShow: false, blocked: false }],
    // SPEC §12: bordo incluso (3 su 3 = bloccato)
    [false, 3, 3, { manual: false, noShow: true, blocked: true }],
    [false, 5, 3, { manual: false, noShow: true, blocked: true }],
    // SPEC §3.1: soglia 0 = blocco per no-show disattivato
    [false, 7, 0, { manual: false, noShow: false, blocked: false }],
    [true, 0, 3, { manual: true, noShow: false, blocked: true }],
    [true, 4, 3, { manual: true, noShow: true, blocked: true }],
    [true, 4, 0, { manual: true, noShow: false, blocked: true }],
  ] as const)('isBlocked=%s, no-show=%s, soglia=%s', async (isBlocked, noShowCount, threshold, expected) => {
    const { customerBlockStatus } = await load<StatusModule>('@/lib/customers/status');
    expect(customerBlockStatus({ isBlocked, noShowCount }, threshold)).toEqual(expected);
  });

  test('SPEC §5.3: "bloccato" coincide sempre con il blocco della prenotazione online', async () => {
    const { customerBlockStatus } = await load<StatusModule>('@/lib/customers/status');
    const { isBlockedForBooking } = await load<{
      isBlockedForBooking: (p: { isBlocked: boolean; noShowCount: number }, t: number) => boolean;
    }>('@/lib/booking/rules');
    for (const isBlocked of [false, true]) {
      for (let noShowCount = 0; noShowCount <= 12; noShowCount += 1) {
        for (let threshold = 0; threshold <= 10; threshold += 1) {
          const profile = { isBlocked, noShowCount };
          expect(customerBlockStatus(profile, threshold).blocked, JSON.stringify({ profile, threshold })).toBe(
            isBlockedForBooking(profile, threshold),
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Schemi – CLAUDE.md Sicurezza (Zod su ogni input), decisione 7
// ---------------------------------------------------------------------------
describe('schemi dei clienti (decisione 7)', () => {
  test('elenco: q con trim e pagina di default 1', async () => {
    const { customerListQuerySchema } = await load<SchemasModule>('@/lib/customers/schemas');
    expect(customerListQuerySchema.safeParse({}).data).toEqual({ q: '', page: 1 });
    expect(customerListQuerySchema.safeParse({ q: '  Rossi  ', pagina: '3' }).data).toEqual({ q: 'Rossi', page: 3 });
  });

  test.each(['0', '-2', '1.5', 'abc', '', '2e3'])('pagina non valida "%s" → 1 (mai un errore)', async (pagina) => {
    const { customerListQuerySchema } = await load<SchemasModule>('@/lib/customers/schemas');
    const result = customerListQuerySchema.safeParse({ q: 'Rossi', pagina });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ q: 'Rossi', page: 1 });
  });

  test('q al massimo 100 caratteri', async () => {
    const { customerListQuerySchema } = await load<SchemasModule>('@/lib/customers/schemas');
    expect(customerListQuerySchema.safeParse({ q: 'x'.repeat(100) }).data).toEqual({ q: 'x'.repeat(100), page: 1 });
    const long = customerListQuerySchema.safeParse({ q: 'x'.repeat(101) });
    // Decisione 7 "max 100": un q più lungo non arriva mai alla ricerca
    expect(long.success === false || (long.data as { q: string }).q.length <= 100).toBe(true);
  });

  test('id del cliente: solo uuid', async () => {
    const { customerIdSchema } = await load<SchemasModule>('@/lib/customers/schemas');
    expect(customerIdSchema.safeParse(CUSTOMER).success).toBe(true);
    for (const value of ['', 'abc', '123', `${CUSTOMER}x`, null]) {
      expect(customerIdSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });

  test('blocco/sblocco: blocked "true" | "false" → boolean, customerId uuid', async () => {
    const { setCustomerBlockedSchema } = await load<SchemasModule>('@/lib/customers/schemas');
    expect(setCustomerBlockedSchema.safeParse({ customerId: CUSTOMER, blocked: 'true' }).data).toEqual({
      customerId: CUSTOMER,
      blocked: true,
    });
    expect(setCustomerBlockedSchema.safeParse({ customerId: CUSTOMER, blocked: 'false' }).data).toEqual({
      customerId: CUSTOMER,
      blocked: false,
    });
    for (const input of [
      { customerId: CUSTOMER, blocked: 'yes' },
      { customerId: CUSTOMER, blocked: '' },
      { customerId: CUSTOMER },
      { customerId: 'abc', blocked: 'true' },
      { blocked: 'true' },
    ]) {
      expect(setCustomerBlockedSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Percorsi – decisione 7
// ---------------------------------------------------------------------------
describe('percorsi dei clienti (decisione 7)', () => {
  test('elenco senza parametri e scheda del cliente', async () => {
    const { customersPath, customerPath } = await load<PathsModule>('@/lib/customers/paths');
    expect(customersPath()).toBe('/admin/clienti');
    expect(customersPath({ q: '', page: 1 })).toBe('/admin/clienti');
    expect(customerPath(CUSTOMER)).toBe(`/admin/clienti/${CUSTOMER}`);
  });

  test('ricerca e pagina viaggiano come q e pagina, con codifica', async () => {
    const { customersPath } = await load<PathsModule>('@/lib/customers/paths');
    const url = new URL(customersPath({ q: 'Rossi & figli 100%', page: 3 }), 'http://x');
    expect(url.pathname).toBe('/admin/clienti');
    expect(url.searchParams.get('q')).toBe('Rossi & figli 100%');
    expect(url.searchParams.get('pagina')).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Server action – SPEC §2, §6.7, CLAUDE.md Sicurezza
// ---------------------------------------------------------------------------
describe('setCustomerBlocked (SPEC §6.7: blocco/sblocco, solo admin)', () => {
  test.each(['barber', 'customer'] as const)('%s: rifiutato prima di qualsiasi accesso al database', async (role) => {
    fake.role = role;
    const { setCustomerBlocked } = await load<ActionsModule>('@/lib/customers/actions');
    const outcome = await refusal(() => setCustomerBlocked({ status: 'idle' }, form({ customerId: CUSTOMER, blocked: 'true' })));
    expect(['redirect', 'forbidden']).toContain(outcome);
    expect(fake.roleCalls[0]).toEqual(['admin']);
    expect(fake.calls).toEqual([]);
  });

  test.each([
    { customerId: 'non-un-uuid', blocked: 'true' },
    { customerId: CUSTOMER, blocked: 'forse' },
    { customerId: CUSTOMER },
  ])('input non valido %j → invalid, nessuna scrittura', async (values) => {
    const { setCustomerBlocked } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await setCustomerBlocked({ status: 'idle' }, form(values as Record<string, string>))).toEqual({ status: 'invalid' });
    expect(fake.calls.filter((call) => call.action !== 'select')).toEqual([]);
  });

  test.each([
    ['true', true],
    ['false', false],
  ] as const)('admin, blocked=%s → aggiorna solo is_blocked del cliente con il client della sessione', async (raw, value) => {
    fake.resolve = (call) =>
      call.action === 'update'
        ? { data: [{ id: CUSTOMER }], error: null, count: 1 }
        : { data: { id: CUSTOMER, role: 'customer' }, error: null };
    const { setCustomerBlocked } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await setCustomerBlocked({ status: 'idle' }, form({ customerId: CUSTOMER, blocked: raw }))).toEqual({ status: 'saved' });
    const writes = fake.calls.filter((call) => call.action !== 'select');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ client: 'server', target: 'profiles', action: 'update', values: { is_blocked: value } });
    expect(writes[0]?.filters).toContainEqual(['eq', 'id', CUSTOMER]);
    expect(fake.calls.some((call) => call.client === 'admin')).toBe(false);
  });

  // Punto 4 (approvato dopo la prima consegna): il blocco dalla sezione Clienti non tocca lo staff.
  // Asserzione scelta: l'update stesso porta il filtro role = 'customer' (vale anche se la riga cambia
  // ruolo fra una lettura e la scrittura), e "0 righe aggiornate" si riconosce sia da data vuoto
  // (.select('id')) sia da count 0 ({ count: 'exact' }): il finto client restituisce entrambi.
  test("l'update è filtrato su role = customer", async () => {
    fake.resolve = (call) =>
      call.action === 'update'
        ? { data: [{ id: CUSTOMER }], error: null, count: 1 }
        : { data: { id: CUSTOMER, role: 'customer' }, error: null };
    const { setCustomerBlocked } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await setCustomerBlocked({ status: 'idle' }, form({ customerId: CUSTOMER, blocked: 'true' }))).toEqual({ status: 'saved' });
    const update = fake.calls.find((call) => call.action === 'update');
    expect(update?.filters).toContainEqual(['eq', 'role', 'customer']);
  });

  test('target non customer (barbiere/admin): 0 righe aggiornate → error, mai saved', async () => {
    fake.resolve = (call) =>
      call.action === 'update' ? { data: [], error: null, count: 0 } : { data: { id: CUSTOMER, role: 'barber' }, error: null };
    const { setCustomerBlocked } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await setCustomerBlocked({ status: 'idle' }, form({ customerId: CUSTOMER, blocked: 'true' }))).toEqual({ status: 'error' });
  });
});

describe('resetNoShows (SPEC §6.7: contatore no-show, decisione 2)', () => {
  test.each(['barber', 'customer'] as const)('%s: rifiutato prima di qualsiasi accesso al database', async (role) => {
    fake.role = role;
    const { resetNoShows } = await load<ActionsModule>('@/lib/customers/actions');
    const outcome = await refusal(() => resetNoShows({ status: 'idle' }, form({ customerId: CUSTOMER })));
    expect(['redirect', 'forbidden']).toContain(outcome);
    expect(fake.roleCalls[0]).toEqual(['admin']);
    expect(fake.calls).toEqual([]);
  });

  test('id non valido → invalid, nessuna RPC', async () => {
    const { resetNoShows } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await resetNoShows({ status: 'idle' }, form({ customerId: 'abc' }))).toEqual({ status: 'invalid' });
    expect(fake.calls.filter((call) => call.action === 'rpc')).toEqual([]);
  });

  test('admin → reset_no_show_count con il client della sessione', async () => {
    const { resetNoShows } = await load<ActionsModule>('@/lib/customers/actions');
    expect(await resetNoShows({ status: 'idle' }, form({ customerId: CUSTOMER }))).toEqual({ status: 'saved' });
    const rpcs = fake.calls.filter((call) => call.action === 'rpc');
    expect(rpcs).toEqual([
      { client: 'server', target: 'rpc:reset_no_show_count', action: 'rpc', args: { p_customer_id: CUSTOMER }, filters: [] },
    ]);
    expect(fake.calls.some((call) => call.client === 'admin')).toBe(false);
  });

  test('cliente inesistente (P0002 dal database) → non "saved"', async () => {
    fake.resolve = (call) => (call.action === 'rpc' ? { data: null, error: { code: 'P0002', message: 'not found' } } : {});
    const { resetNoShows } = await load<ActionsModule>('@/lib/customers/actions');
    const { status } = await resetNoShows({ status: 'idle' }, form({ customerId: CUSTOMER }));
    expect(['error', 'invalid']).toContain(status);
  });
});

describe('searchCustomers con etichetta "Bloccato" (SPEC §6.2, decisione 8)', () => {
  test.each(['barber', 'admin'] as const)('%s: i risultati portano blocked da blocked_customer_ids', async (role) => {
    fake.role = role;
    fake.resolve = (call) => {
      if (call.target === 'rpc:search_customers') {
        return {
          data: [
            { id: CUSTOMER, full_name: 'Mario Rossi', phone: '+393331112222' },
            { id: OTHER, full_name: 'Mario Rossini', phone: null },
          ],
          error: null,
        };
      }
      if (call.target === 'rpc:blocked_customer_ids') return { data: [CUSTOMER], error: null };
      return { data: null, error: null };
    };
    const { searchCustomers } = await load<SearchModule>('@/lib/calendar/actions');
    expect(await searchCustomers('Mario')).toEqual({
      ok: true,
      matches: [
        { id: CUSTOMER, fullName: 'Mario Rossi', phone: '+393331112222', blocked: true },
        { id: OTHER, fullName: 'Mario Rossini', phone: null, blocked: false },
      ],
      blockStatusUnknown: false,
    });
    const blockedCall = fake.calls.find((call) => call.target === 'rpc:blocked_customer_ids');
    expect(blockedCall?.client).toBe('server');
    expect(new Set((blockedCall?.args as { p_ids?: string[] } | undefined)?.p_ids)).toEqual(new Set([CUSTOMER, OTHER]));
  });

  // Punto 7 (versione modificata dall'utente): stato del blocco sconosciuto, non "non bloccato"
  test('blocked_customer_ids fallisce → risultati comunque, blocked null, blockStatusUnknown e log', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.role = 'barber';
    fake.resolve = (call) => {
      if (call.target === 'rpc:search_customers') {
        return { data: [{ id: CUSTOMER, full_name: 'Mario Rossi', phone: '+393331112222' }], error: null };
      }
      if (call.target === 'rpc:blocked_customer_ids') return { data: null, error: { code: '42501', message: 'denied' } };
      return { data: null, error: null };
    };
    try {
      const { searchCustomers } = await load<SearchModule>('@/lib/calendar/actions');
      expect(await searchCustomers('Mario')).toEqual({
        ok: true,
        matches: [{ id: CUSTOMER, fullName: 'Mario Rossi', phone: '+393331112222', blocked: null }],
        blockStatusUnknown: true,
      });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Pagine e testi – CLAUDE.md Sicurezza, SPEC §9
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

describe('pagine dei clienti (CLAUDE.md – Sicurezza, SPEC §2)', () => {
  test.each([
    ['/admin/clienti', /^src\/app\/admin\/(?:\([^/]+\)\/)?clienti\/page\.tsx$/],
    ['/admin/clienti/[id]', /^src\/app\/admin\/(?:\([^/]+\)\/)?clienti\/\[id\]\/page\.tsx$/],
  ])('%s esiste, chiama requireRole(["admin"]) e non usa la service role', (_label, pattern) => {
    const file = walk('src/app/admin').find((candidate) => pattern.test(candidate));
    expect(file, `pagina mancante: ${String(pattern)}`).toBeDefined();
    const code = stripComments(readFileSync(resolve(ROOT, file ?? ''), 'utf8'));
    expect(code).toMatch(ADMIN_ONLY);
    expect(code).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
  });
});

const REQUIRED_KEYS = [
  'searchLabel',
  'block',
  'unblock',
  'resetNoShows',
  'status.active',
  'status.blockedByAdmin',
  'status.blockedByNoShow',
] as const;

const text = (path: string): unknown => {
  let node: unknown = texts;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
};

describe('testi dei clienti in src/i18n/it.ts (SPEC §9)', () => {
  test.each(REQUIRED_KEYS)('it.admin.customers.%s è un testo non vuoto', (key) => {
    const value = text(`admin.customers.${key}`);
    expect(typeof value === 'string' && value.trim() !== '', `chiave mancante: it.admin.customers.${key}`).toBe(true);
  });

  test('stato per no-show con {count} e {threshold}; stati distinti', () => {
    expect(String(text('admin.customers.status.blockedByNoShow'))).toMatch(/\{count\}[\s\S]*\{threshold\}/);
    const states = ['active', 'blockedByAdmin', 'blockedByNoShow'].map((key) => text(`admin.customers.status.${key}`));
    expect(new Set(states).size).toBe(3);
  });

  test('decisione 8: etichetta "Bloccato" nella ricerca della manuale', () => {
    const value = text('admin.calendar.form.customerBlocked');
    expect(typeof value === 'string' && value.trim() !== '').toBe(true);
  });

  test('punto 7: avviso "stato dei blocchi non verificabile" nella ricerca della manuale', () => {
    const value = text('admin.calendar.form.customerBlockUnknown');
    expect(typeof value === 'string' && value.trim() !== '', 'chiave mancante: it.admin.calendar.form.customerBlockUnknown').toBe(true);
    expect(value).not.toBe(text('admin.calendar.form.customerBlocked'));
  });
});
