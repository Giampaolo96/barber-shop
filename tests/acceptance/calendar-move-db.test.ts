// Test di accettazione – FETTA 6c ("Spostamento con trascinamento sul calendario"), server action
// moveBooking contro il database locale.
// Sezioni: SPEC §2 (ruoli), §3.6 (durata e prezzo non cambiano spostando), §3.7.1, §3.7.3, §3.7.5
// (avvisi ricalcolati dal server, conferma esplicita), §3.7.6, §6.3 + decisioni approvate per la
// fetta 6c (punti 1, 2, 5, 6).
//
// Interfaccia attesa: src/lib/calendar/actions.ts ("use server")
//   moveBooking(input: { id: string; barberId: string; startsAt: string; expectedBarberId: string;
//                        expectedStartsAt: string; confirmedWarnings?: WarningCode[] }): Promise<MoveResult>
//   MoveResult =
//     | { status: 'saved'; previousWarnings: WarningCode[] }
//     | { status: 'warnings'; warnings: WarningCode[] }
//     | { status: 'invalid' | 'stale' | 'inactive' | 'past_target' | 'barber_busy' | 'customer_busy' | 'not_enabled' | 'forbidden' | 'error' }
//   past_target: destinazione nel passato, mai ammessa (review fetta 6c, decisione dell'utente).
//   previousWarnings: avvisi della posizione ORIGINALE (barbiere e intervallo prima dello
//   spostamento), calcolati dal server al momento dello spostamento; servono all'"Annulla", che
//   richiama moveBooking all'indietro con expected* = posizione nuova e confirmedWarnings =
//   previousWarnings.
//
// Meccanismo: requireRole e createClient sono sostituiti da mock che usano utenti reali, autenticati
// con email e password sul Supabase locale (RLS e trigger veri). La service role serve solo al test
// per preparare e pulire i dati; il codice applicativo non la usa.
// L'utente admin è collegato anche alla scheda X2: un admin che è anche barbiere conta come admin
// (decisione 1).
// Richiede lo stack Supabase locale avviato. Non modificare durante l'implementazione.

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type WarningCode = 'outside_hours' | 'time_off' | 'closure' | 'past';
type MoveInput = {
  id: string;
  barberId: string;
  startsAt: string;
  expectedBarberId: string;
  expectedStartsAt: string;
  confirmedWarnings?: WarningCode[];
};
type MoveResult =
  | { status: 'saved'; previousWarnings: WarningCode[] }
  | { status: 'warnings'; warnings: WarningCode[] }
  | { status: 'invalid' | 'stale' | 'inactive' | 'past_target' | 'barber_busy' | 'customer_busy' | 'not_enabled' | 'forbidden' | 'error' };
type ActionsModule = { moveBooking: (input: MoveInput) => Promise<MoveResult> };

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

// ---------------------------------------------------------------------------
// Utente corrente della "richiesta" (impostato dai test)
// ---------------------------------------------------------------------------
type Role = 'customer' | 'barber' | 'admin';
const session = vi.hoisted(() => ({
  user: null as null | { id: string; role: Role },
  client: null as unknown,
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
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
  },
}));
// Come il vero requireRole: chi non ha il ruolo viene rimandato via con un redirect
vi.mock('@/lib/auth/current-user', () => {
  const current = () =>
    session.user && { id: session.user.id, role: session.user.role, isBlocked: false, profileComplete: true };
  return {
    getCurrentUser: async () => current(),
    loadCurrentUser: async () => current(),
    requireRole: async (allowed: readonly string[]) => {
      const user = current();
      if (!user || !allowed.includes(user.role)) {
        throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' });
      }
      return user;
    },
  };
});
vi.mock('@/lib/db/server', () => ({ createClient: async () => session.client }));

// ---------------------------------------------------------------------------
// Ambiente (come booking-db.test.ts)
// ---------------------------------------------------------------------------
const KEYS = {
  NEXT_PUBLIC_SUPABASE_URL: 'API_URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY',
} as const;
function loadEnv(): void {
  if (Object.keys(KEYS).every((k) => process.env[k])) return;
  const status = execSync('npx supabase status -o env', { encoding: 'utf8', timeout: 90_000 });
  const vars = new Map<string, string>();
  for (const line of status.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) vars.set(m[1], m[2]);
  }
  for (const [target, source] of Object.entries(KEYS)) {
    const value = vars.get(source);
    if (value) process.env[target] = value;
  }
}
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// ---------------------------------------------------------------------------
// Dati del test. Date fisse future in gennaio (ora solare, UTC+1), un giorno per test.
// ---------------------------------------------------------------------------
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const YEAR = 2046;
const day = (n: number): string => `${YEAR}-01-${String(n).padStart(2, '0')}`;
/** Ora di Roma in gennaio come istante ISO UTC. */
const at = (date: string, time: string): string => new Date(`${date}T${time}:00+01:00`).toISOString();
const ms = (value: string): number => new Date(value).getTime();

const ctx = {
  svc: null as unknown as SupabaseClient,
  serviceId: '',
  x1: '', // barbiere Uno (account barber1), attivo
  x2: '', // attivo, collegato all'admin
  x3: '', // disattivato
  x4: '', // attivo, NON abilitato al servizio
  userIds: [] as string[],
  clients: {} as Record<'admin' | 'barber1' | 'customer', { id: string; client: SupabaseClient }>,
  customerId: '',
};
let setupError: unknown = null;

const must = <T>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: nessun dato`);
  return result.data;
};

async function createUser(label: string, role: Role): Promise<{ id: string; client: SupabaseClient }> {
  const email = `vt6c-${label}-${tag}@qa.test`;
  const password = `Vt6c-${tag}-password`;
  const created = await ctx.svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const id = created.data.user.id;
  ctx.userIds.push(id);
  must(
    await ctx.svc
      .from('profiles')
      .update({ role, full_name: `VT6C ${label}`, phone: `+39340${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` })
      .eq('id', id)
      .select('id'),
    `profilo ${label}`,
  );
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`login ${label}: ${signIn.error.message}`);
  return { id, client };
}

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  ctx.svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, noSession);

  const settings = must(await ctx.svc.from('shop_settings').select('timezone').single(), 'impostazioni') as { timezone: string };
  if (settings.timezone !== 'Europe/Rome') throw new Error(`timezone del negozio inattesa: ${settings.timezone}`);

  const service = must(
    await ctx.svc
      .from('services')
      .insert({ name: `VT6C Taglio ${tag}`, duration_min: 30, price_cents: 2000, is_active: true })
      .select('id')
      .single(),
    'servizio',
  ) as { id: string };
  ctx.serviceId = service.id;

  ctx.clients.admin = await createUser('admin', 'admin');
  ctx.clients.barber1 = await createUser('barber1', 'barber');
  ctx.clients.customer = await createUser('customer', 'customer');
  ctx.customerId = ctx.clients.customer.id;

  const barbers = must(
    await ctx.svc
      .from('barbers')
      .insert([
        { display_name: `VT6C X1 ${tag}`, is_active: true, profile_id: ctx.clients.barber1.id },
        { display_name: `VT6C X2 ${tag}`, is_active: true, profile_id: ctx.clients.admin.id },
        { display_name: `VT6C X3 ${tag}`, is_active: false },
        { display_name: `VT6C X4 ${tag}`, is_active: true },
      ])
      .select('id, display_name'),
    'barbieri',
  ) as Array<{ id: string; display_name: string }>;
  const byName = (prefix: string): string => barbers.find((b) => b.display_name.startsWith(prefix))!.id;
  ctx.x1 = byName('VT6C X1');
  ctx.x2 = byName('VT6C X2');
  ctx.x3 = byName('VT6C X3');
  ctx.x4 = byName('VT6C X4');
  must(
    await ctx.svc
      .from('barber_services')
      .insert([ctx.x1, ctx.x2, ctx.x3].map((barber_id) => ({ barber_id, service_id: ctx.serviceId })))
      .select('barber_id'),
    'abilitazioni',
  );
  // Tutti i barbieri lavorano 09:00–13:00 e 15:00–19:00 ogni giorno (anche X3 e X4, così il loro
  // unico difetto è lo stato o l'abilitazione).
  const hours: Array<{ barber_id: string; weekday: number; start_time: string; end_time: string }> = [];
  for (const barber_id of [ctx.x1, ctx.x2, ctx.x3, ctx.x4]) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      hours.push({ barber_id, weekday, start_time: '09:00', end_time: '13:00' });
      hours.push({ barber_id, weekday, start_time: '15:00', end_time: '19:00' });
    }
  }
  must(await ctx.svc.from('working_hours').insert(hours).select('id'), 'orari');
}

beforeAll(async () => {
  try {
    await setup();
  } catch (error) {
    setupError = error;
  }
}, 180_000);

// Ambiente mancante: ogni test fallisce (non viene saltato)
beforeEach(() => {
  if (setupError) throw setupError;
  session.user = null;
  session.client = null;
});

afterAll(async () => {
  if (!ctx.svc) return;
  const barbers = [ctx.x1, ctx.x2, ctx.x3, ctx.x4].filter(Boolean);
  if (ctx.serviceId) await ctx.svc.from('bookings').delete().eq('service_id', ctx.serviceId);
  if (barbers.length > 0) {
    await ctx.svc.from('time_off').delete().in('barber_id', barbers);
    await ctx.svc.from('barbers').delete().in('id', barbers);
  }
  if (ctx.serviceId) await ctx.svc.from('services').delete().eq('id', ctx.serviceId);
  for (const id of ctx.userIds) await ctx.svc.auth.admin.deleteUser(id);
}, 120_000);

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------
const actAs = (who: 'admin' | 'barber1' | 'customer'): void => {
  const role: Role = who === 'barber1' ? 'barber' : who;
  session.user = { id: ctx.clients[who].id, role };
  session.client = ctx.clients[who].client;
};

type Row = {
  barber_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  duration_min: number;
  price_cents: number;
  service_id: string;
};

/** Prenotazione creata dalla service role (ospite salvo customer). */
async function book(values: {
  barberId: string;
  startsAt: string;
  status?: string;
  customerId?: string;
}): Promise<string> {
  const row = must(
    await ctx.svc
      .from('bookings')
      .insert({
        ...(values.customerId
          ? { customer_id: values.customerId }
          : { guest_name: `VT6C Ospite ${tag}`, guest_phone: '+390300006000' }),
        barber_id: values.barberId,
        service_id: ctx.serviceId,
        starts_at: values.startsAt,
        status: values.status ?? 'confirmed',
        source: 'manual',
      })
      .select('id')
      .single(),
    'prenotazione',
  ) as { id: string };
  return row.id;
}

async function read(id: string): Promise<Row> {
  return must(
    await ctx.svc
      .from('bookings')
      .select('barber_id, starts_at, ends_at, status, duration_min, price_cents, service_id')
      .eq('id', id)
      .single(),
    'lettura prenotazione',
  ) as Row;
}

const position = (row: Row): [string, number] => [row.barber_id, ms(row.starts_at)];

async function moveBooking(input: MoveInput): Promise<MoveResult> {
  const { moveBooking: action } = await load<ActionsModule>('@/lib/calendar/actions');
  return action(input);
}

/** Spostamento di una prenotazione dalla posizione attuale (letta dal database). */
async function moveFrom(id: string, to: { barberId: string; startsAt: string }, confirmedWarnings?: WarningCode[]): Promise<MoveResult> {
  const row = await read(id);
  return moveBooking({
    id,
    barberId: to.barberId,
    startsAt: to.startsAt,
    expectedBarberId: row.barber_id,
    expectedStartsAt: new Date(row.starts_at).toISOString(),
    ...(confirmedWarnings === undefined ? {} : { confirmedWarnings }),
  });
}

// ===========================================================================
// Admin
// ===========================================================================
describe('moveBooking: admin (decisioni 1 e 5)', () => {
  test('SPEC §6.3 / §3.6: sposta su un\'altra colonna; durata e prezzo restano quelli della prenotazione', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(2), '10:00') });
    // Durata e prezzo della prenotazione diversi dal servizio (modifica precedente dell'admin)
    must(await ctx.svc.from('bookings').update({ duration_min: 40, price_cents: 1234 }).eq('id', id).select('id'), 'durata');
    actAs('admin');

    const result = await moveFrom(id, { barberId: ctx.x2, startsAt: at(day(2), '11:00') });
    expect(result).toEqual({ status: 'saved', previousWarnings: [] });
    const row = await read(id);
    expect(position(row)).toEqual([ctx.x2, ms(at(day(2), '11:00'))]);
    expect(ms(row.ends_at)).toBe(ms(at(day(2), '11:40')));
    expect(row).toMatchObject({ status: 'confirmed', duration_min: 40, price_cents: 1234, service_id: ctx.serviceId });
  });

  test('SPEC §3.7.5: fuori fascia → warnings e nulla salvato; reinviando con l\'avviso confermato → saved', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(3), '10:00') });
    actAs('admin');

    const first = await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(3), '20:00') });
    expect(first).toEqual({ status: 'warnings', warnings: ['outside_hours'] });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(3), '10:00'))]);

    const second = await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(3), '20:00') }, ['outside_hours']);
    expect(second).toEqual({ status: 'saved', previousWarnings: [] });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(3), '20:00'))]);
  });

  test('review fetta 6c (decisione dell\'utente): destinazione nel passato → past_target, anche con l\'avviso confermato', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(4), '10:00') });
    actAs('admin');
    const pastStart = '2020-01-15T09:00:00.000Z'; // 10:00 a Roma, dentro la fascia

    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: pastStart })).toEqual({ status: 'past_target' });
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: pastStart }, ['past'])).toEqual({ status: 'past_target' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(4), '10:00'))]);
  });

  test('decisione 6: posizione originale fuori fascia → previousWarnings; l\'Annulla con quegli avvisi torna indietro', async () => {
    const original = at(day(5), '20:00');
    const id = await book({ barberId: ctx.x1, startsAt: original });
    actAs('admin');

    const moved = await moveFrom(id, { barberId: ctx.x2, startsAt: at(day(5), '10:00') });
    expect(moved).toEqual({ status: 'saved', previousWarnings: ['outside_hours'] });
    if (moved.status !== 'saved') return;

    const undo = await moveBooking({
      id,
      barberId: ctx.x1,
      startsAt: original,
      expectedBarberId: ctx.x2,
      expectedStartsAt: at(day(5), '10:00'),
      confirmedWarnings: moved.previousWarnings,
    });
    expect(undo.status).toBe('saved');
    expect(position(await read(id))).toEqual([ctx.x1, ms(original)]);
  });

  test('decisione 6: tra spostamento e Annulla compare un\'assenza sull\'orario originale → warnings con time_off, nulla salvato', async () => {
    const original = at(day(6), '10:00');
    const id = await book({ barberId: ctx.x1, startsAt: original });
    actAs('admin');

    const moved = await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(6), '11:00') });
    expect(moved).toEqual({ status: 'saved', previousWarnings: [] });
    if (moved.status !== 'saved') return;

    must(
      await ctx.svc
        .from('time_off')
        .insert({ barber_id: ctx.x1, starts_at: at(day(6), '09:45'), ends_at: at(day(6), '10:45'), reason: `VT6C ${tag}` })
        .select('id'),
      'assenza',
    );
    const undo = await moveBooking({
      id,
      barberId: ctx.x1,
      startsAt: original,
      expectedBarberId: ctx.x1,
      expectedStartsAt: at(day(6), '11:00'),
      confirmedWarnings: moved.previousWarnings,
    });
    expect(undo.status).toBe('warnings');
    if (undo.status === 'warnings') expect(undo.warnings).toContain('time_off');
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(6), '11:00'))]);
  });

  test('decisione 5: posizione attesa diversa da quella attuale → stale, nulla salvato', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(7), '10:00') });
    actAs('admin');
    const base = { id, barberId: ctx.x1, startsAt: at(day(7), '11:00') };

    expect(await moveBooking({ ...base, expectedBarberId: ctx.x1, expectedStartsAt: at(day(7), '10:15') })).toEqual({ status: 'stale' });
    expect(await moveBooking({ ...base, expectedBarberId: ctx.x2, expectedStartsAt: at(day(7), '10:00') })).toEqual({ status: 'stale' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(7), '10:00'))]);
  });

  test('decisione 5 (scelta dell\'utente):prenotazione non più confirmed → stale, nulla salvato', async () => {
    // Decisione dell'utente: una prenotazione non più confirmed restituisce stale, non forbidden.
    const id = await book({ barberId: ctx.x1, startsAt: at(day(8), '10:00'), status: 'cancelled_by_shop' });
    actAs('admin');
    const result = await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(8), '11:00') });
    expect(result).toEqual({ status: 'stale' });
    expect(await read(id)).toMatchObject({ status: 'cancelled_by_shop', starts_at: expect.any(String) });
    expect(ms((await read(id)).starts_at)).toBe(ms(at(day(8), '10:00')));
  });

  test('decisione 5: prenotazione già iniziata → forbidden', async () => {
    const startedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const id = await book({ barberId: ctx.x2, startsAt: startedAt });
    actAs('admin');
    const result = await moveFrom(id, { barberId: ctx.x2, startsAt: at(day(9), '10:00') }, ['outside_hours', 'time_off', 'closure', 'past']);
    expect(result).toEqual({ status: 'forbidden' });
    expect(ms((await read(id)).starts_at)).toBe(ms(startedAt));
  });

  test('SPEC §3.7.1: sovrapposizione con un altro appuntamento del barbiere → barber_busy', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(10), '10:00') });
    await book({ barberId: ctx.x2, startsAt: at(day(10), '11:00') });
    actAs('admin');
    expect(await moveFrom(id, { barberId: ctx.x2, startsAt: at(day(10), '11:15') })).toEqual({ status: 'barber_busy' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(10), '10:00'))]);
  });

  test('SPEC §3.7.6: sovrapposizione con un altro appuntamento dello stesso cliente → customer_busy', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(11), '10:00'), customerId: ctx.customerId });
    await book({ barberId: ctx.x2, startsAt: at(day(11), '11:00'), customerId: ctx.customerId });
    actAs('admin');
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(11), '11:15') })).toEqual({ status: 'customer_busy' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(11), '10:00'))]);
  });

  test('SPEC §3.7.3: barbiere di destinazione non abilitato al servizio → not_enabled', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(12), '10:00') });
    actAs('admin');
    expect(await moveFrom(id, { barberId: ctx.x4, startsAt: at(day(12), '10:00') })).toEqual({ status: 'not_enabled' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(12), '10:00'))]);
  });

  test('SPEC §3.3 / decisione 5: barbiere di destinazione disattivato (cambio colonna) → inactive', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(13), '10:00') });
    actAs('admin');
    expect(await moveFrom(id, { barberId: ctx.x3, startsAt: at(day(13), '10:00') })).toEqual({ status: 'inactive' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(13), '10:00'))]);
  });

  test('decisione 4: nella propria colonna di un barbiere disattivato l\'orario si sposta ancora', async () => {
    const id = await book({ barberId: ctx.x3, startsAt: at(day(14), '10:00') });
    actAs('admin');
    expect(await moveFrom(id, { barberId: ctx.x3, startsAt: at(day(14), '11:00') })).toEqual({ status: 'saved', previousWarnings: [] });
    expect(position(await read(id))).toEqual([ctx.x3, ms(at(day(14), '11:00'))]);
  });

  test('CLAUDE.md Sicurezza: input non valido → invalid', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(15), '10:00') });
    actAs('admin');
    const valid = {
      id,
      barberId: ctx.x1,
      startsAt: at(day(15), '11:00'),
      expectedBarberId: ctx.x1,
      expectedStartsAt: at(day(15), '10:00'),
    };
    expect(await moveBooking({ ...valid, id: 'non-un-uuid' })).toEqual({ status: 'invalid' });
    expect(await moveBooking({ ...valid, startsAt: `${day(15)}T11:00:00` })).toEqual({ status: 'invalid' });
    expect(await moveBooking({ ...valid, confirmedWarnings: ['barber_busy' as WarningCode] })).toEqual({ status: 'invalid' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(15), '10:00'))]);
  });
});

// ===========================================================================
// Barbiere (non admin)
// ===========================================================================
describe('moveBooking: barbiere (decisioni 1 e 5)', () => {
  test('decisione 1: sposta l\'orario di una propria confirmed futura; durata e prezzo invariati', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(16), '10:00') });
    actAs('barber1');
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(16), '12:00') })).toEqual({ status: 'saved', previousWarnings: [] });
    const row = await read(id);
    expect(position(row)).toEqual([ctx.x1, ms(at(day(16), '12:00'))]);
    expect(ms(row.ends_at)).toBe(ms(at(day(16), '12:30')));
    expect(row).toMatchObject({ duration_min: 30, price_cents: 2000 });
  });

  test('SPEC §3.7.5: anche per il barbiere gli avvisi chiedono conferma', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(17), '10:00') });
    actAs('barber1');
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(17), '14:00') })).toEqual({
      status: 'warnings',
      warnings: ['outside_hours'],
    });
    expect((await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(17), '14:00') }, ['outside_hours'])).status).toBe('saved');
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(17), '14:00'))]);
  });

  test('decisione 1: verso un\'altra colonna → forbidden', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(18), '10:00') });
    actAs('barber1');
    expect(await moveFrom(id, { barberId: ctx.x2, startsAt: at(day(18), '11:00') })).toEqual({ status: 'forbidden' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(18), '10:00'))]);
  });

  test('SPEC §2: prenotazione di un altro barbiere → forbidden', async () => {
    const id = await book({ barberId: ctx.x2, startsAt: at(day(19), '10:00') });
    actAs('barber1');
    const result = await moveBooking({
      id,
      barberId: ctx.x2,
      startsAt: at(day(19), '11:00'),
      expectedBarberId: ctx.x2,
      expectedStartsAt: at(day(19), '10:00'),
    });
    expect(result).toEqual({ status: 'forbidden' });
    expect(position(await read(id))).toEqual([ctx.x2, ms(at(day(19), '10:00'))]);
  });

  test('decisione 1: propria prenotazione già iniziata → forbidden', async () => {
    const startedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const id = await book({ barberId: ctx.x1, startsAt: startedAt });
    actAs('barber1');
    const result = await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(20), '10:00') }, ['outside_hours', 'time_off', 'closure', 'past']);
    expect(result).toEqual({ status: 'forbidden' });
    expect(ms((await read(id)).starts_at)).toBe(ms(startedAt));
  });

  test('review fetta 6c (decisione dell\'utente): destinazione nel passato → past_target', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(23), '10:00') });
    actAs('barber1');
    const pastStart = '2020-01-15T09:00:00.000Z';
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: pastStart }, ['past'])).toEqual({ status: 'past_target' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(23), '10:00'))]);
  });

  test('SPEC §3.7.1: sovrapposizione nella propria colonna → barber_busy', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(21), '10:00') });
    await book({ barberId: ctx.x1, startsAt: at(day(21), '11:00') });
    actAs('barber1');
    expect(await moveFrom(id, { barberId: ctx.x1, startsAt: at(day(21), '10:45') })).toEqual({ status: 'barber_busy' });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(21), '10:00'))]);
  });
});

describe('moveBooking: cliente (SPEC §2)', () => {
  test('il cliente viene respinto da requireRole, nulla salvato', async () => {
    const id = await book({ barberId: ctx.x1, startsAt: at(day(22), '10:00'), customerId: ctx.customerId });
    actAs('customer');
    await expect(moveFrom(id, { barberId: ctx.x1, startsAt: at(day(22), '11:00') })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT/),
    });
    expect(position(await read(id))).toEqual([ctx.x1, ms(at(day(22), '10:00'))]);
  });
});
