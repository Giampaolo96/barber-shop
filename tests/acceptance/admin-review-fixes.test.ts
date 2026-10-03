// Regressioni della review della FETTA 3 (scritte durante l'implementazione, non da spec-qa;
// decisioni dell'utente dopo la review).
// 1. Account staff: se l'eliminazione compensativa fallisce, il log riporta l'id dell'utente orfano.
// 2. Collegamento scheda → account: se la scheda è stata collegata nel frattempo → "stale".
// 3. Conteggio delle prenotazioni coinvolte non riuscito → avviso generico, non "zero".
// 4. Tetti massimi delle impostazioni.
// 5. Avvisi al singolare e al plurale.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Client Supabase finto: ogni chiamata è risolta da `fake.resolve`
// ---------------------------------------------------------------------------
type Call = { client: 'server' | 'admin'; table: string; action: string; values?: unknown };
type Result = { data?: unknown; error?: { code: string; message?: string } | null; count?: number | null };

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ client: 'server' | 'admin'; table: string; action: string; values?: unknown }>,
  resolve: (() => ({ data: [], error: null })) as (call: {
    client: 'server' | 'admin';
    table: string;
    action: string;
    values?: unknown;
  }) => { data?: unknown; error?: { code: string; message?: string } | null; count?: number | null },
  deleteUserError: null as null | { code: string; message: string },
  createUserError: null as null | { code: string; message: string },
  deletedUsers: [] as string[],
  makeClient: null as unknown as (kind: 'server' | 'admin') => unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));
vi.mock('@/lib/auth/current-user', () => ({
  requireRole: async () => ({ id: 'a0000000-0000-4000-8000-000000000001', role: 'admin', isBlocked: false, profileComplete: true }),
}));
vi.mock('@/lib/db/server', () => ({ createClient: async () => fake.makeClient('server') }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => fake.makeClient('admin') }));

const builder = (client: 'server' | 'admin', table: string): unknown => {
  let action = 'select';
  let values: unknown;
  const run = (): Result => {
    const call = { client, table, action, values };
    fake.calls.push(call);
    return { data: null, error: null, ...fake.resolve(call) };
  };
  const self: Record<string, unknown> = {};
  const chain = (fn?: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn?.(...args);
    return self;
  };
  Object.assign(self, {
    select: chain((_columns: unknown, options?: unknown) => {
      if (action === 'select' && (options as { head?: boolean } | undefined)?.head) action = 'count';
    }),
    insert: chain((v: unknown) => ((action = 'insert'), (values = v))),
    update: chain((v: unknown) => ((action = 'update'), (values = v))),
    delete: chain(() => (action = 'delete')),
    eq: chain(),
    neq: chain(),
    in: chain(),
    is: chain(),
    lt: chain(),
    gt: chain(),
    order: chain(),
    limit: chain(),
    single: async () => run(),
    maybeSingle: async () => run(),
    then: (ok: (r: Result) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
  });
  return self;
};

fake.makeClient = (kind) => ({
  from: (table: string) => builder(kind, table),
  rpc: async (name: string) => {
    const call = { client: kind, table: `rpc:${name}`, action: 'rpc' };
    fake.calls.push(call);
    return { data: null, error: null, ...fake.resolve(call) };
  },
  auth: {
    admin: {
      createUser: async () =>
        fake.createUserError
          ? { data: { user: null }, error: fake.createUserError }
          : { data: { user: { id: '0e000000-0000-4000-8000-0000000000aa' } }, error: null },
      deleteUser: async (id: string) => {
        fake.deletedUsers.push(id);
        return { data: null, error: fake.deleteUserError };
      },
    },
  },
});

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

const BARBER = 'b0000000-0000-4000-8000-000000000004';
const LOOSE_STAFF = 'a0000000-0000-4000-8000-000000000004';
const ACCOUNT_ALREADY_LINKED = { code: '55000', message: 'barber already linked to another account' };

beforeEach(() => {
  fake.calls = [];
  fake.deleteUserError = null;
  fake.createUserError = null;
  fake.deletedUsers = [];
  fake.resolve = () => ({ data: [], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1 e 2 – Account staff
// ---------------------------------------------------------------------------
describe('linkStaffAccount – scheda modificata nel frattempo (review fetta 3, punto 2)', () => {
  const staffAndFreeCard = (call: Call): Result => {
    if (call.table === 'profiles') return { data: { role: 'barber' } };
    if (call.table === 'rpc:barber_accounts') return { data: [{ barber_id: BARBER, profile_id: null }] };
    return { data: [] };
  };

  test('la guardia del database rifiuta il collegamento → stale', async () => {
    fake.resolve = (call) =>
      call.table === 'barbers' && call.action === 'update' ? { data: null, error: ACCOUNT_ALREADY_LINKED } : staffAndFreeCard(call);
    const { linkStaffAccount } = await import('@/lib/admin/staff-accounts');
    expect(await linkStaffAccount({ status: 'idle' }, form({ barberId: BARBER, profileId: LOOSE_STAFF }))).toEqual({
      status: 'stale',
    });
  });

  test('l\'update non tocca righe → stale', async () => {
    fake.resolve = (call) => (call.table === 'barbers' && call.action === 'update' ? { data: [] } : staffAndFreeCard(call));
    const { linkStaffAccount } = await import('@/lib/admin/staff-accounts');
    expect(await linkStaffAccount({ status: 'idle' }, form({ barberId: BARBER, profileId: LOOSE_STAFF }))).toEqual({
      status: 'stale',
    });
  });

  test('il testo "stale" chiede di ricaricare la pagina', async () => {
    const { it: strings } = await import('@/i18n/it');
    expect(strings.admin.staff.stale).toBe('La scheda è stata modificata, ricarica la pagina.');
  });
});

describe('createStaffAccount – rollback dell\'account (review fetta 3, punti 1 e 2)', () => {
  const freeCard = (call: Call): Result => {
    if (call.table === 'barbers' && call.action === 'select') return { data: { id: BARBER } };
    if (call.table === 'rpc:barber_accounts') return { data: [{ barber_id: BARBER, profile_id: null }] };
    if (call.table === 'profiles' && call.action === 'update') return { data: [{ id: 'x' }] };
    if (call.table === 'barbers' && call.action === 'update') return { data: null, error: ACCOUNT_ALREADY_LINKED };
    return { data: [] };
  };
  const validForm = () =>
    form({ email: 'nuovo@qa.test', password: 'Password-2026', displayName: 'Nuovo', barberId: BARBER });

  test('scheda collegata nel frattempo: l\'utente creato si elimina e lo stato è stale', async () => {
    fake.resolve = freeCard;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createStaffAccount } = await import('@/lib/admin/staff-accounts');
    expect(await createStaffAccount({ status: 'idle' }, validForm())).toEqual({ status: 'stale' });
    expect(fake.deletedUsers).toEqual(['0e000000-0000-4000-8000-0000000000aa']);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/orfano/);
  });

  test('se anche l\'eliminazione fallisce, il log riporta l\'id dell\'utente Auth orfano', async () => {
    fake.resolve = freeCard;
    fake.deleteUserError = { code: 'unexpected_failure', message: 'boom' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createStaffAccount } = await import('@/lib/admin/staff-accounts');
    await createStaffAccount({ status: 'idle' }, validForm());
    const logged = errors.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toMatch(/orfano/);
    expect(logged).toContain('0e000000-0000-4000-8000-0000000000aa');
    expect(logged).not.toMatch(/utente eliminato/);
  });
});

// ---------------------------------------------------------------------------
// 3 – Conteggio non riuscito
// ---------------------------------------------------------------------------
describe('conteggio delle prenotazioni non riuscito (review fetta 3, punto 3)', () => {
  const countFails = (call: Call): Result => {
    if (call.table === 'shop_settings') return { data: { timezone: 'Europe/Rome' } };
    if (call.table === 'bookings') return { data: null, count: null, error: { code: '57014', message: 'timeout' } };
    if (call.action === 'update') return { data: [{ id: 'x', barber_id: BARBER }] };
    return { data: [] };
  };

  test('countFutureConfirmed e countConfirmedOverlapping restituiscono null, non 0', async () => {
    fake.resolve = countFails;
    const { countConfirmedOverlapping, countFutureConfirmed } = await import('@/lib/admin/queries');
    const client = fake.makeClient('server') as Parameters<typeof countFutureConfirmed>[0];
    expect(await countFutureConfirmed(client, 'service_id', BARBER)).toBeNull();
    expect(await countConfirmedOverlapping(client, new Date('2040-01-01'), new Date('2040-01-02'))).toBeNull();
  });

  test('con un conteggio riuscito restituiscono il numero, anche 0', async () => {
    fake.resolve = (call) => (call.table === 'bookings' ? { data: null, count: 0 } : { data: [] });
    const { countFutureConfirmed } = await import('@/lib/admin/queries');
    const client = fake.makeClient('server') as Parameters<typeof countFutureConfirmed>[0];
    expect(await countFutureConfirmed(client, 'barber_id', BARBER)).toBe(0);
  });

  test('saveClosure salva e segnala il conteggio non verificato (overlapping: null)', async () => {
    fake.resolve = countFails;
    const { saveClosure } = await import('@/lib/admin/period-actions');
    const state = await saveClosure(
      { status: 'idle' },
      form({ mode: 'allDay', fromDate: '2040-01-10', toDate: '2040-01-10', reason: 'Inventario' }),
    );
    expect(state).toEqual({ status: 'saved', overlapping: null });
  });

  test('saveService di un servizio disattivato segnala il conteggio non verificato', async () => {
    fake.resolve = countFails;
    const { saveService } = await import('@/lib/admin/service-actions');
    const state = await saveService(
      { status: 'idle' },
      form({ id: '50000000-0000-4000-8000-000000000001', name: 'Taglio', durationMin: '30', price: '20' }),
    );
    expect(state).toEqual({ status: 'saved', futureBookings: null });
  });
});

// ---------------------------------------------------------------------------
// 3 e 5 – Testo degli avvisi
// ---------------------------------------------------------------------------
describe('avviso sulle prenotazioni coinvolte (review fetta 3, punti 3 e 5)', () => {
  const render = async (count: number | null | undefined, status = 'saved'): Promise<string> => {
    const { BookingsWarning } = await import('@/components/admin/form-status');
    const { it: strings } = await import('@/i18n/it');
    return renderToStaticMarkup(
      createElement(BookingsWarning, {
        status,
        count,
        one: strings.admin.period.overlapsBookingsOne,
        other: strings.admin.period.overlapsBookings,
      }),
    );
  };

  test('1 → singolare', async () => {
    const html = await render(1);
    expect(html).toContain('1 prenotazione confermata');
    expect(html).not.toContain('prenotazioni');
  });

  test('3 → plurale', async () => {
    expect(await render(3)).toContain('3 prenotazioni confermate');
  });

  test('0, stato non salvato o conteggio assente → nessun avviso', async () => {
    expect(await render(0)).toBe('');
    expect(await render(2, 'invalid')).toBe('');
    expect(await render(undefined)).toBe('');
  });

  test('conteggio non riuscito → avviso che non è stato possibile verificare', async () => {
    const { it: strings } = await import('@/i18n/it');
    const html = await render(null);
    expect(html).toContain(strings.admin.common.bookingsUnverified.replace(/'/g, '&#x27;'));
    expect(strings.admin.common.bookingsUnverified).toMatch(/non è stato possibile verificare/);
  });

  test('countText sceglie la forma in base al numero', async () => {
    const { countText } = await import('@/lib/admin/text');
    expect(countText(1, '{count} prenotazione', '{count} prenotazioni')).toBe('1 prenotazione');
    expect(countText(0, '{count} prenotazione', '{count} prenotazioni')).toBe('0 prenotazioni');
    expect(countText(12, '{count} prenotazione', '{count} prenotazioni')).toBe('12 prenotazioni');
  });
});

// ---------------------------------------------------------------------------
// 4 – Tetti massimi delle impostazioni
// ---------------------------------------------------------------------------
describe('settingsSchema – tetti massimi (review fetta 3, punto 9)', () => {
  const valid = {
    name: 'Barber Shop',
    address: '',
    phone: '',
    logoUrl: '',
    timezone: 'Europe/Rome',
    slotGranularityMin: '15',
    minAdvanceMin: '60',
    maxHorizonDays: '30',
    cancelLimitMin: '120',
    bufferMin: '0',
    noShowBlockThreshold: '3',
    privacyPolicyVersion: '2026-10',
  };

  test('accetta i valori massimi', async () => {
    const { settingsSchema } = await import('@/lib/admin/schemas');
    const result = settingsSchema.safeParse({
      ...valid,
      minAdvanceMin: '10080',
      maxHorizonDays: '365',
      cancelLimitMin: '10080',
      bufferMin: '60',
      noShowBlockThreshold: '10',
    });
    expect(result.success).toBe(true);
  });

  test.each([
    ['anticipo oltre 7 giorni', { minAdvanceMin: '10081' }],
    ['orizzonte oltre 365 giorni', { maxHorizonDays: '366' }],
    ['limite di cancellazione oltre 7 giorni', { cancelLimitMin: '10081' }],
    ['buffer oltre 60 minuti', { bufferMin: '61' }],
    ['soglia no-show oltre 10', { noShowBlockThreshold: '11' }],
  ])('rifiuta: %s', async (_label, overrides) => {
    const { settingsSchema } = await import('@/lib/admin/schemas');
    expect(settingsSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });
});
