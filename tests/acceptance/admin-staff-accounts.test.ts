// Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
// Server action degli account staff (src/lib/admin/staff-accounts.ts), le uniche che usano il
// client service_role (src/lib/db/admin.ts).
// Sezioni: SPEC §2 (un utente ha un solo ruolo; l'admin può essere anche barbiere), §3.3
// ("collegamento opzionale a un account staff"), §5.5 (lo staff non si auto-registra), §8,
// CLAUDE.md – Sicurezza + decisioni approvate per la fetta 3 (punto C).
//
// Il database e Supabase Auth sono sostituiti da un finto in memoria:
// - `@/lib/auth/current-user`: requireRole con il ruolo scelto dal test;
// - `@/lib/db/server`: client dell'utente (admin) con le regole di colonna di `barbers`
//   (profile_id non leggibile: si legge con l'RPC barber_accounts);
// - `@/lib/db/admin`: client service_role con auth.admin.* e l'RPC revoke_user_sessions
//   (eseguibile solo dal service_role).
// Interfaccia attesa per i dati: tabelle `profiles` e `barbers` con `.from(...)`, RPC
// `barber_accounts` e `revoke_user_sessions`, `auth.admin.createUser` / `listUsers`.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese
// ---------------------------------------------------------------------------
type StaffAccountState = {
  status: 'idle' | 'created' | 'invalid' | 'email_taken' | 'barber_has_account' | 'error';
};
type StaffActionState = {
  status: 'idle' | 'ok' | 'invalid' | 'not_staff' | 'self' | 'barber_has_account' | 'error' | string;
};
type StaffAccountsModule = {
  createStaffAccount: (previous: StaffAccountState, formData: FormData) => Promise<StaffAccountState>;
  /** formData: profileId, blocked ('true' | 'false') */
  setStaffBlocked: (previous: StaffActionState, formData: FormData) => Promise<StaffActionState>;
  /** formData: barberId, profileId */
  linkStaffAccount: (previous: StaffActionState, formData: FormData) => Promise<StaffActionState>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const STAFF_ACCOUNTS = '@/lib/admin/staff-accounts';

// ---------------------------------------------------------------------------
// Database finto
// ---------------------------------------------------------------------------
type Role = 'customer' | 'barber' | 'admin';
type Row = Record<string, unknown>;
type ProfileRow = { id: string; role: Role; is_blocked: boolean; full_name: string | null; phone: string | null };
type BarberRow = {
  id: string;
  display_name: string;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  profile_id: string | null;
};
type UserRow = { id: string; email: string };
type ClientKind = 'server' | 'admin';
type Op = { client: ClientKind; kind: 'from' | 'rpc' | 'auth'; name: string; action?: string; payload?: unknown };
type DbError = { code: string; message: string };
type DbResult = { data: unknown; error: DbError | null; count?: number | null };

const fake = vi.hoisted(() => ({
  currentRole: 'admin' as 'customer' | 'barber' | 'admin' | null,
  currentUserId: '',
  /** Sequenza degli eventi: requireRole, createAdminClient, chiamate a Supabase. */
  log: [] as string[],
  ops: [] as Array<{ client: 'server' | 'admin'; kind: 'from' | 'rpc' | 'auth'; name: string; action?: string; payload?: unknown }>,
  users: [] as Array<{ id: string; email: string }>,
  profiles: [] as Array<{
    id: string;
    role: 'customer' | 'barber' | 'admin';
    is_blocked: boolean;
    full_name: string | null;
    phone: string | null;
  }>,
  barbers: [] as Array<{
    id: string;
    display_name: string;
    photo_url: string | null;
    bio: string | null;
    is_active: boolean;
    profile_id: string | null;
  }>,
  revokedSessions: [] as string[],
  nextId: 1,
  // Popolati più sotto (vi.hoisted gira prima delle dichiarazioni del modulo)
  makeClient: null as unknown as (kind: 'server' | 'admin') => unknown,
}));

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
    has: () => false,
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => {
  const leave = (kind: string) => (to?: string) => {
    fake.log.push(`redirect:${to ?? kind}`);
    throw Object.assign(new Error(`NEXT_${kind}`), { digest: `NEXT_${kind};replace;${to ?? ''};307;` });
  };
  return {
    redirect: leave('REDIRECT'),
    permanentRedirect: leave('REDIRECT'),
    notFound: leave('NOT_FOUND'),
    forbidden: leave('FORBIDDEN'),
    unauthorized: leave('UNAUTHORIZED'),
  };
});

vi.mock('@/lib/auth/current-user', () => {
  const user = () =>
    fake.currentRole === null
      ? null
      : { id: fake.currentUserId, role: fake.currentRole, isBlocked: false, profileComplete: true };
  const leave = (to: string): never => {
    fake.log.push(`redirect:${to}`);
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  };
  return {
    getCurrentUser: async () => user(),
    loadCurrentUser: async () => user(),
    requireRole: async (allowed: readonly string[]) => {
      fake.log.push(`requireRole:${[...allowed].sort().join(',')}`);
      const current = user();
      if (current === null) return leave('/admin/login');
      if (!allowed.includes(current.role)) return leave(current.role === 'customer' ? '/' : '/admin');
      return current;
    },
  };
});

vi.mock('@/lib/db/server', () => ({
  createClient: async () => {
    fake.log.push('createClient:server');
    return fake.makeClient('server');
  },
}));

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => {
    fake.log.push('createAdminClient');
    return fake.makeClient('admin');
  },
}));

// --- Implementazione del finto -------------------------------------------------
const tableRows = (name: string): Row[] => {
  if (name === 'profiles') return fake.profiles as unknown as Row[];
  if (name === 'barbers') return fake.barbers as unknown as Row[];
  return [];
};

type Filter = (row: Row) => boolean;

/** Query builder minimo, "thenable" come quello di supabase-js. */
const queryBuilder = (client: ClientKind, table: string): unknown => {
  const filters: Filter[] = [];
  let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let payload: unknown;
  let selected: string | null = null;
  let selectCalled = false;

  const run = (): DbResult => {
    fake.ops.push({ client, kind: 'from', name: table, action, payload });
    fake.log.push(`${client}:from:${table}:${action}`);
    // Grant di colonna su barbers (ADR 001): authenticated non legge profile_id né "*"
    if (client === 'server' && table === 'barbers' && selectCalled) {
      const columns = (selected ?? '').replace(/\s/g, '');
      if (columns === '' || columns.includes('*') || /\bprofile_id\b/.test(columns)) {
        return { data: null, error: { code: '42501', message: 'permission denied for table barbers' } };
      }
    }
    const rows = tableRows(table);
    const matching = rows.filter((row) => filters.every((filter) => filter(row)));

    if (action === 'select') return { data: matching.map((row) => ({ ...row })), error: null, count: matching.length };

    if (action === 'update') {
      const values = payload as Row;
      if (table === 'barbers' && typeof values.profile_id === 'string') {
        const clash = fake.barbers.find(
          (barber) => barber.profile_id === values.profile_id && !matching.includes(barber as unknown as Row),
        );
        if (clash) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      for (const row of matching) Object.assign(row, values);
      return { data: matching.map((row) => ({ ...row })), error: null, count: matching.length };
    }

    if (action === 'delete') {
      for (const row of matching) rows.splice(rows.indexOf(row), 1);
      return { data: matching.map((row) => ({ ...row })), error: null, count: matching.length };
    }

    // insert / upsert
    const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
    const inserted = incoming.map((row) => ({ id: `00000000-0000-4000-8000-${String(fake.nextId++).padStart(12, '0')}`, ...row }));
    rows.push(...inserted);
    return { data: inserted.map((row) => ({ ...row })), error: null, count: inserted.length };
  };

  const builder: Record<string, unknown> = {};
  const chain = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn(...args);
    return builder;
  };
  Object.assign(builder, {
    select: chain((columns?: unknown) => {
      selectCalled = true;
      selected = typeof columns === 'string' ? columns : '';
    }),
    insert: chain((values: unknown) => {
      action = 'insert';
      payload = values;
    }),
    upsert: chain((values: unknown) => {
      action = 'upsert';
      payload = values;
    }),
    update: chain((values: unknown) => {
      action = 'update';
      payload = values;
    }),
    delete: chain(() => {
      action = 'delete';
    }),
    eq: chain((column: unknown, value: unknown) => filters.push((row) => row[String(column)] === value)),
    neq: chain((column: unknown, value: unknown) => filters.push((row) => row[String(column)] !== value)),
    is: chain((column: unknown, value: unknown) => filters.push((row) => (row[String(column)] ?? null) === value)),
    in: chain((column: unknown, values: unknown) =>
      filters.push((row) => (values as unknown[]).includes(row[String(column)])),
    ),
    match: chain((query: unknown) =>
      filters.push((row) => Object.entries(query as Row).every(([key, value]) => row[key] === value)),
    ),
    order: chain(() => undefined),
    limit: chain(() => undefined),
    range: chain(() => undefined),
    returns: chain(() => undefined),
    abortSignal: chain(() => undefined),
    single: async () => {
      const result = run();
      if (result.error) return result;
      const list = result.data as Row[];
      return list.length === 1
        ? { data: list[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    },
    maybeSingle: async () => {
      const result = run();
      if (result.error) return result;
      const list = result.data as Row[];
      return { data: list[0] ?? null, error: null };
    },
    then: (onFulfilled: (value: DbResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(run)
        .then(onFulfilled, onRejected),
  });
  return builder;
};

const rpc = (client: ClientKind, name: string, args?: Row) => {
  fake.ops.push({ client, kind: 'rpc', name, payload: args });
  fake.log.push(`${client}:rpc:${name}`);
  const done = (result: DbResult) => {
    const promise = Promise.resolve(result);
    return Object.assign(promise, {
      single: async () => result,
      maybeSingle: async () => result,
      select: () => promise,
      throwOnError: () => promise,
    });
  };
  if (name === 'barber_accounts') {
    return done({
      data: fake.barbers.map((barber) => ({ barber_id: barber.id, profile_id: barber.profile_id })),
      error: null,
    });
  }
  if (name === 'revoke_user_sessions') {
    // Decisione fetta 3: eseguibile solo dal service_role
    if (client !== 'admin') return done({ data: null, error: { code: '42501', message: 'permission denied for function revoke_user_sessions' } });
    fake.revokedSessions.push(String(args?.p_user_id));
    return done({ data: null, error: null });
  }
  return done({ data: null, error: { code: 'PGRST202', message: `function public.${name} not found` } });
};

const authAdmin = () => {
  const record = (action: string, payload?: unknown) => {
    fake.ops.push({ client: 'admin', kind: 'auth', name: 'admin', action, payload });
    fake.log.push(`admin:auth:${action}`);
  };
  const userById = (id: string) => fake.users.find((user) => user.id === id) ?? null;
  return {
    createUser: async (attributes: { email?: string; password?: string; user_metadata?: Row; app_metadata?: Row }) => {
      record('createUser', attributes);
      const email = String(attributes.email ?? '').trim().toLowerCase();
      if (fake.users.some((user) => user.email.toLowerCase() === email)) {
        return {
          data: { user: null },
          error: {
            name: 'AuthApiError',
            status: 422,
            code: 'email_exists',
            message: 'A user with this email address has already been registered',
          },
        };
      }
      const id = `0e000000-0000-4000-8000-${String(fake.nextId++).padStart(12, '0')}`;
      fake.users.push({ id, email });
      // Trigger di registrazione (ADR 001): profilo customer, nome dai metadati
      const metadata = attributes.user_metadata ?? {};
      const name = metadata.full_name ?? metadata.name ?? null;
      fake.profiles.push({ id, role: 'customer', is_blocked: false, full_name: typeof name === 'string' ? name : null, phone: null });
      return { data: { user: { id, email, aud: 'authenticated' } }, error: null };
    },
    listUsers: async (params?: unknown) => {
      record('listUsers', params);
      return {
        data: { users: fake.users.map((user) => ({ ...user, aud: 'authenticated' })), aud: 'authenticated', nextPage: null, lastPage: 1, total: fake.users.length },
        error: null,
      };
    },
    getUserById: async (id: string) => {
      record('getUserById', id);
      const user = userById(id);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
    },
    updateUserById: async (id: string, attributes: unknown) => {
      record('updateUserById', { id, attributes });
      const user = userById(id);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } };
    },
    deleteUser: async (id: string) => {
      record('deleteUser', id);
      fake.users = fake.users.filter((user) => user.id !== id);
      fake.profiles = fake.profiles.filter((profile) => profile.id !== id);
      return { data: { user: null }, error: null };
    },
    signOut: async (jwt: string) => {
      record('signOut', jwt);
      return { data: null, error: null };
    },
    inviteUserByEmail: async (email: string) => {
      record('inviteUserByEmail', email);
      return { data: { user: null }, error: { status: 400, code: 'not_supported', message: 'not supported in tests' } };
    },
  };
};

fake.makeClient = (kind: ClientKind) => ({
  from: (table: string) => queryBuilder(kind, table),
  rpc: (name: string, args?: Row) => rpc(kind, name, args),
  auth: {
    getUser: async () => ({
      data: { user: fake.currentRole === null ? null : { id: fake.currentUserId, aud: 'authenticated', role: 'authenticated' } },
      error: null,
    }),
    getClaims: async () => ({
      data: fake.currentRole === null ? null : { claims: { sub: fake.currentUserId, role: 'authenticated' } },
      error: null,
    }),
    getSession: async () => {
      throw new Error('getSession() non va usato lato server');
    },
    signOut: async () => ({ error: null }),
    ...(kind === 'admin' ? { admin: authAdmin() } : {}),
  },
});

// ---------------------------------------------------------------------------
// Dati di partenza (come il seed)
// ---------------------------------------------------------------------------
const ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';
const BARBER_USER_ID = 'a0000000-0000-4000-8000-000000000002';
const CUSTOMER_ID = 'a0000000-0000-4000-8000-000000000003';
const LOOSE_BARBER_USER_ID = 'a0000000-0000-4000-8000-000000000004';
const MARIO = 'b0000000-0000-4000-8000-000000000001';
const LUCA = 'b0000000-0000-4000-8000-000000000002';
const SARA = 'b0000000-0000-4000-8000-000000000003';
const NEW_BARBER = 'b0000000-0000-4000-8000-000000000004';

const reset = (): void => {
  fake.currentRole = 'admin';
  fake.currentUserId = ADMIN_ID;
  fake.log = [];
  fake.ops = [];
  fake.revokedSessions = [];
  fake.nextId = 1;
  fake.users = [
    { id: ADMIN_ID, email: 'admin@demo.local' },
    { id: BARBER_USER_ID, email: 'barber@demo.local' },
    { id: CUSTOMER_ID, email: 'cliente@demo.local' },
    { id: LOOSE_BARBER_USER_ID, email: 'senza-scheda@demo.local' },
  ];
  fake.profiles = [
    { id: ADMIN_ID, role: 'admin', is_blocked: false, full_name: 'Mario Rossi', phone: '+393331000001' },
    { id: BARBER_USER_ID, role: 'barber', is_blocked: false, full_name: 'Luca Bianchi', phone: '+393331000002' },
    { id: CUSTOMER_ID, role: 'customer', is_blocked: false, full_name: 'Giulia Verdi', phone: '+393331000003' },
    // Account staff esistente non ancora collegato a una scheda barbiere
    { id: LOOSE_BARBER_USER_ID, role: 'barber', is_blocked: false, full_name: 'Paolo Senza Scheda', phone: null },
  ];
  fake.barbers = [
    { id: MARIO, display_name: 'Mario', photo_url: null, bio: null, is_active: true, profile_id: null },
    { id: LUCA, display_name: 'Luca', photo_url: null, bio: null, is_active: true, profile_id: BARBER_USER_ID },
    { id: SARA, display_name: 'Sara', photo_url: null, bio: null, is_active: true, profile_id: null },
    { id: NEW_BARBER, display_name: 'Nuovo', photo_url: null, bio: null, is_active: true, profile_id: null },
  ];
};

const snapshot = () => JSON.parse(JSON.stringify({ users: fake.users, profiles: fake.profiles, barbers: fake.barbers })) as unknown;

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

const profile = (id: string): ProfileRow | undefined => fake.profiles.find((row) => row.id === id) as ProfileRow | undefined;
const barberRow = (id: string): BarberRow | undefined => fake.barbers.find((row) => row.id === id) as BarberRow | undefined;
const userByEmail = (email: string): UserRow | undefined => fake.users.find((row) => row.email === email);

const usedServiceRole = (): boolean =>
  fake.log.some((event) => event === 'createAdminClient' || event.startsWith('admin:'));

const authCalls = (action: string): Op[] =>
  (fake.ops as Op[]).filter((op) => op.kind === 'auth' && op.action === action);

/** requireRole(['admin']) chiamato, e prima di qualunque uso del service role. */
const expectAdminCheckFirst = (): void => {
  const roleAt = fake.log.indexOf('requireRole:admin');
  expect(roleAt, `requireRole(['admin']) non chiamato; eventi: ${fake.log.join(' → ')}`).toBeGreaterThanOrEqual(0);
  const firstPrivileged = fake.log.findIndex((event) => event === 'createAdminClient' || event.startsWith('admin:'));
  if (firstPrivileged >= 0) expect(roleAt).toBeLessThan(firstPrivileged);
  const firstDb = fake.log.findIndex((event) => /^(?:server|admin):(?:from|rpc|auth)/.test(event));
  if (firstDb >= 0) expect(roleAt).toBeLessThan(firstDb);
};

const staffAccounts = async (): Promise<StaffAccountsModule> => {
  const mod = await load<StaffAccountsModule>(STAFF_ACCOUNTS);
  expect(mod.createStaffAccount, 'staff-accounts.ts deve esportare createStaffAccount').toBeTypeOf('function');
  expect(mod.setStaffBlocked, 'staff-accounts.ts deve esportare setStaffBlocked').toBeTypeOf('function');
  expect(mod.linkStaffAccount, 'staff-accounts.ts deve esportare linkStaffAccount').toBeTypeOf('function');
  return mod;
};

const IDLE = { status: 'idle' } as const;

beforeEach(() => {
  reset();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// createStaffAccount
// ---------------------------------------------------------------------------
describe('createStaffAccount – account barbiere creato dall\'admin (SPEC §2, §3.3, §5.5)', () => {
  const validForm = (overrides: Record<string, string> = {}): FormData =>
    form({
      email: 'nuovo.barbiere@qa.test',
      password: 'Password-2026',
      displayName: 'Nuovo Barbiere',
      barberId: NEW_BARBER,
      ...overrides,
    });

  test('crea l\'utente, lo rende barbiere e lo collega alla scheda scelta', async () => {
    const { createStaffAccount } = await staffAccounts();
    const result = await createStaffAccount(IDLE, validForm());

    expect(result.status).toBe('created');
    expectAdminCheckFirst();
    const created = userByEmail('nuovo.barbiere@qa.test');
    expect(created, 'utente non creato con auth.admin.createUser').toBeDefined();
    expect(profile(created?.id ?? '')?.role).toBe('barber');
    expect(profile(created?.id ?? '')?.full_name).toBe('Nuovo Barbiere');
    expect(barberRow(NEW_BARBER)?.profile_id).toBe(created?.id);
    // nessun altro barbiere o profilo toccato
    expect(barberRow(SARA)?.profile_id).toBeNull();
    expect(profile(CUSTOMER_ID)?.role).toBe('customer');
  });

  // La password scelta dall'admin non va alterata
  test('passa a Supabase Auth email e password così come validate', async () => {
    const { createStaffAccount } = await staffAccounts();
    await createStaffAccount(IDLE, validForm({ password: ' Spazi-ai-bordi ' }));
    const call = authCalls('createUser')[0];
    expect(call).toBeDefined();
    expect(call?.payload).toMatchObject({ email: 'nuovo.barbiere@qa.test', password: ' Spazi-ai-bordi ' });
  });

  // SPEC §2 + decisione fetta 2: il ruolo non arriva mai dal client né dai metadati
  test('un campo role=admin nel form viene ignorato: l\'account è barber', async () => {
    const { createStaffAccount } = await staffAccounts();
    const result = await createStaffAccount(IDLE, validForm({ role: 'admin' }));
    if (result.status === 'created') {
      const created = userByEmail('nuovo.barbiere@qa.test');
      expect(profile(created?.id ?? '')?.role).toBe('barber');
    } else {
      expect(result.status).toBe('invalid');
      expect(userByEmail('nuovo.barbiere@qa.test')).toBeUndefined();
    }
    expect(fake.profiles.filter((row) => row.role === 'admin').map((row) => row.id)).toEqual([ADMIN_ID]);
    for (const call of authCalls('createUser')) {
      expect(JSON.stringify(call.payload)).not.toMatch(/"role"\s*:\s*"admin"/);
    }
  });

  // Decisione fetta 3: email già registrata → stato distinto, il cliente resta cliente
  test.each(['cliente@demo.local', 'CLIENTE@demo.local'])(
    'email già registrata (%s) → email_taken, nessuna modifica',
    async (email) => {
      const { createStaffAccount } = await staffAccounts();
      const before = snapshot();
      const result = await createStaffAccount(IDLE, validForm({ email }));

      expect(result.status).toBe('email_taken');
      expectAdminCheckFirst();
      expect(snapshot()).toEqual(before);
      expect(profile(CUSTOMER_ID)?.role).toBe('customer');
      expect(barberRow(NEW_BARBER)?.profile_id).toBeNull();
      expect(authCalls('updateUserById')).toEqual([]);
      expect(authCalls('deleteUser')).toEqual([]);
    },
  );

  test('email di uno staff già registrato → email_taken, nessuna modifica', async () => {
    const { createStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await createStaffAccount(IDLE, validForm({ email: 'barber@demo.local' }));
    expect(result.status).toBe('email_taken');
    expect(snapshot()).toEqual(before);
  });

  // Decisione fetta 3: collega solo se la scheda non ha già un account
  test('scheda barbiere che ha già un account → barber_has_account, nessun utente creato', async () => {
    const { createStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await createStaffAccount(IDLE, validForm({ barberId: LUCA }));
    expect(result.status).toBe('barber_has_account');
    expect(authCalls('createUser')).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  test('scheda barbiere inesistente → nessun utente creato', async () => {
    const { createStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await createStaffAccount(IDLE, validForm({ barberId: 'b0000000-0000-4000-8000-000000000999' }));
    expect(result.status).not.toBe('created');
    expect(authCalls('createUser')).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // CLAUDE.md – Sicurezza: input validato con Zod prima di qualsiasi scrittura
  test.each([
    ['password di 9 caratteri', { password: 'a'.repeat(9) }],
    ['email non valida', { email: 'non-una-email' }],
    ['barbiere non valido', { barberId: 'non-un-uuid' }],
  ])('input non valido (%s) → invalid, nessuna chiamata ad Auth', async (_label, overrides) => {
    const { createStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await createStaffAccount(IDLE, validForm(overrides));
    expect(result.status).toBe('invalid');
    expect(authCalls('createUser')).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // Decisione fetta 3: requireRole(['admin']) prima di qualsiasi uso del service role
  test.each([
    ['barbiere', 'barber' as const, BARBER_USER_ID],
    ['cliente', 'customer' as const, CUSTOMER_ID],
    ['anonimo', null, ''],
  ])('%s: respinto, il service role non viene nemmeno creato', async (_label, role, id) => {
    fake.currentRole = role;
    fake.currentUserId = id;
    const { createStaffAccount } = await staffAccounts();
    const before = snapshot();
    await expect(createStaffAccount(IDLE, validForm())).rejects.toBeDefined();
    expect(fake.log).toContain('requireRole:admin');
    expect(usedServiceRole()).toBe(false);
    expect(snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// setStaffBlocked
// ---------------------------------------------------------------------------
describe('setStaffBlocked – blocco degli account staff (decisione fetta 2 e fetta 3)', () => {
  test('blocca un barbiere e revoca le sue sessioni lato server con il service role', async () => {
    const { setStaffBlocked } = await staffAccounts();
    const result = await setStaffBlocked(IDLE, form({ profileId: BARBER_USER_ID, blocked: 'true' }));

    expect(result.status).toBe('ok');
    expectAdminCheckFirst();
    expect(profile(BARBER_USER_ID)?.is_blocked).toBe(true);
    expect(fake.revokedSessions).toEqual([BARBER_USER_ID]);
    const revoke = (fake.ops as Op[]).filter((op) => op.kind === 'rpc' && op.name === 'revoke_user_sessions');
    expect(revoke.every((op) => op.client === 'admin')).toBe(true);
    // il ruolo non cambia e nessun altro profilo è toccato
    expect(profile(BARBER_USER_ID)?.role).toBe('barber');
    expect(profile(CUSTOMER_ID)?.is_blocked).toBe(false);
  });

  test('sblocca un barbiere', async () => {
    fake.profiles.find((row) => row.id === BARBER_USER_ID)!.is_blocked = true;
    const { setStaffBlocked } = await staffAccounts();
    const result = await setStaffBlocked(IDLE, form({ profileId: BARBER_USER_ID, blocked: 'false' }));
    expect(result.status).toBe('ok');
    expect(profile(BARBER_USER_ID)?.is_blocked).toBe(false);
  });

  // Decisione fetta 3: solo profili staff; il blocco dei clienti è un'altra funzione (SPEC §6.7)
  test('un cliente non si blocca da qui → not_staff, nessuna modifica', async () => {
    const { setStaffBlocked } = await staffAccounts();
    const before = snapshot();
    const result = await setStaffBlocked(IDLE, form({ profileId: CUSTOMER_ID, blocked: 'true' }));
    expect(result.status).toBe('not_staff');
    expect(snapshot()).toEqual(before);
    expect(fake.revokedSessions).toEqual([]);
  });

  // Decisione fetta 3: l'admin non può bloccare se stesso
  test('l\'admin non può bloccare se stesso → self, nessuna modifica', async () => {
    const { setStaffBlocked } = await staffAccounts();
    const before = snapshot();
    const result = await setStaffBlocked(IDLE, form({ profileId: ADMIN_ID, blocked: 'true' }));
    expect(result.status).toBe('self');
    expect(snapshot()).toEqual(before);
    expect(fake.revokedSessions).toEqual([]);
  });

  test.each([
    ['profilo non valido', { profileId: 'non-un-uuid', blocked: 'true' }],
    ['valore di blocco non valido', { profileId: BARBER_USER_ID, blocked: 'forse' }],
  ])('input non valido (%s) → invalid, nessuna modifica', async (_label, values) => {
    const { setStaffBlocked } = await staffAccounts();
    const before = snapshot();
    const result = await setStaffBlocked(IDLE, form(values));
    expect(result.status).toBe('invalid');
    expect(snapshot()).toEqual(before);
    expect(fake.revokedSessions).toEqual([]);
  });

  test.each([
    ['barbiere', 'barber' as const, BARBER_USER_ID],
    ['cliente', 'customer' as const, CUSTOMER_ID],
    ['anonimo', null, ''],
  ])('%s: respinto prima di qualsiasi uso del service role', async (_label, role, id) => {
    fake.currentRole = role;
    fake.currentUserId = id;
    const { setStaffBlocked } = await staffAccounts();
    const before = snapshot();
    await expect(setStaffBlocked(IDLE, form({ profileId: LOOSE_BARBER_USER_ID, blocked: 'true' }))).rejects.toBeDefined();
    expect(fake.log).toContain('requireRole:admin');
    expect(usedServiceRole()).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(fake.revokedSessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// linkStaffAccount
// ---------------------------------------------------------------------------
describe('linkStaffAccount – collegamento di un account staff esistente a una scheda (SPEC §2, §3.3)', () => {
  test('collega un account barbiere senza scheda a un barbiere senza account', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const result = await linkStaffAccount(IDLE, form({ barberId: SARA, profileId: LOOSE_BARBER_USER_ID }));
    expect(result.status).toBe('ok');
    expectAdminCheckFirst();
    expect(barberRow(SARA)?.profile_id).toBe(LOOSE_BARBER_USER_ID);
    expect(profile(LOOSE_BARBER_USER_ID)?.role).toBe('barber');
  });

  // SPEC §2: "Un admin può essere anche barbiere ... riga barbers collegata al suo profilo"
  test('l\'admin può collegare se stesso a una scheda barbiere, restando admin', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const result = await linkStaffAccount(IDLE, form({ barberId: MARIO, profileId: ADMIN_ID }));
    expect(result.status).toBe('ok');
    expect(barberRow(MARIO)?.profile_id).toBe(ADMIN_ID);
    expect(profile(ADMIN_ID)?.role).toBe('admin');
  });

  // SPEC §2: un utente ha un solo ruolo; il collegamento non promuove un cliente
  test('un cliente non si collega a una scheda → not_staff, nessuna modifica', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await linkStaffAccount(IDLE, form({ barberId: SARA, profileId: CUSTOMER_ID }));
    expect(result.status).toBe('not_staff');
    expect(snapshot()).toEqual(before);
  });

  test('scheda che ha già un account → barber_has_account, nessuna modifica', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await linkStaffAccount(IDLE, form({ barberId: LUCA, profileId: LOOSE_BARBER_USER_ID }));
    expect(result.status).toBe('barber_has_account');
    expect(snapshot()).toEqual(before);
  });

  // barbers.profile_id è unique: un account è collegato al massimo a una scheda
  test('account già collegato a un\'altra scheda → rifiutato, nessuna modifica', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await linkStaffAccount(IDLE, form({ barberId: SARA, profileId: BARBER_USER_ID }));
    expect(result.status).not.toBe('ok');
    expect(snapshot()).toEqual(before);
  });

  test('input non valido → invalid, nessuna modifica', async () => {
    const { linkStaffAccount } = await staffAccounts();
    const before = snapshot();
    const result = await linkStaffAccount(IDLE, form({ barberId: 'x', profileId: LOOSE_BARBER_USER_ID }));
    expect(result.status).toBe('invalid');
    expect(snapshot()).toEqual(before);
  });

  test.each([
    ['barbiere', 'barber' as const, BARBER_USER_ID],
    ['cliente', 'customer' as const, CUSTOMER_ID],
  ])('%s: respinto, nessuna modifica', async (_label, role, id) => {
    fake.currentRole = role;
    fake.currentUserId = id;
    const { linkStaffAccount } = await staffAccounts();
    const before = snapshot();
    await expect(linkStaffAccount(IDLE, form({ barberId: SARA, profileId: LOOSE_BARBER_USER_ID }))).rejects.toBeDefined();
    expect(fake.log).toContain('requireRole:admin');
    expect(usedServiceRole()).toBe(false);
    expect(snapshot()).toEqual(before);
  });
});
