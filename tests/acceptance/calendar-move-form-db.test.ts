// Regressione dalla review della fetta 6c (bloccante B1): modulo "Sposta orario" del dettaglio,
// alternativa accessibile al trascinamento per il barbiere (SPEC §6.3, ADR 008).
// moveBookingFromForm contro il database locale, come calendar-move-db.test.ts: requireRole e
// createClient sono mock che usano utenti reali (RLS e trigger veri); la service role serve solo
// al test per preparare e pulire i dati.
// Richiede lo stack Supabase locale avviato.

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type FormState = { status: string; warnings?: string[] };
type ActionsModule = { moveBookingFromForm: (previous: FormState, formData: FormData) => Promise<FormState> };
type SchemasModule = { moveBookingFormSchema: { safeParse: (input: unknown) => { success: boolean } } };

const session = vi.hoisted(() => ({
  user: null as null | { id: string; role: 'barber' | 'admin' },
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

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Ora di Roma come istante ISO UTC (offset esplicito: gennaio +01:00, aprile +02:00). */
const at = (date: string, time: string, offset = '+01:00'): string => new Date(`${date}T${time}:00${offset}`).toISOString();
const ms = (value: string): number => new Date(value).getTime();

const ctx = {
  svc: null as unknown as SupabaseClient,
  serviceId: '',
  own: '', // scheda del barbiere di prova
  other: '', // altra scheda, senza account
  barber: { id: '', client: null as unknown as SupabaseClient },
  userId: '',
};
let setupError: unknown = null;

const must = <T>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: nessun dato`);
  return result.data;
};

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  ctx.svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, noSession);

  const service = must(
    await ctx.svc
      .from('services')
      .insert({ name: `RF6C Taglio ${tag}`, duration_min: 30, price_cents: 2000, is_active: true })
      .select('id')
      .single(),
    'servizio',
  ) as { id: string };
  ctx.serviceId = service.id;

  const email = `rf6c-barber-${tag}@qa.test`;
  const password = `Rf6c-${tag}-password`;
  const created = await ctx.svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  ctx.userId = created.data.user.id;
  must(
    await ctx.svc.from('profiles').update({ role: 'barber', full_name: `RF6C Barbiere ${tag}` }).eq('id', ctx.userId).select('id'),
    'profilo',
  );
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`login: ${signIn.error.message}`);
  ctx.barber = { id: ctx.userId, client };

  const barbers = must(
    await ctx.svc
      .from('barbers')
      .insert([
        { display_name: `RF6C Own ${tag}`, is_active: true, profile_id: ctx.userId },
        { display_name: `RF6C Other ${tag}`, is_active: true },
      ])
      .select('id, display_name'),
    'barbieri',
  ) as Array<{ id: string; display_name: string }>;
  ctx.own = barbers.find((b) => b.display_name.startsWith('RF6C Own'))!.id;
  ctx.other = barbers.find((b) => b.display_name.startsWith('RF6C Other'))!.id;
  must(
    await ctx.svc
      .from('barber_services')
      .insert([ctx.own, ctx.other].map((barber_id) => ({ barber_id, service_id: ctx.serviceId })))
      .select('barber_id'),
    'abilitazioni',
  );
  const hours = [ctx.own, ctx.other].flatMap((barber_id) =>
    [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { barber_id, weekday, start_time: '00:00', end_time: '13:00' },
      { barber_id, weekday, start_time: '15:00', end_time: '19:00' },
    ]),
  );
  must(await ctx.svc.from('working_hours').insert(hours).select('id'), 'orari');
}

beforeAll(async () => {
  try {
    await setup();
  } catch (error) {
    setupError = error;
  }
}, 180_000);

beforeEach(() => {
  if (setupError) throw setupError;
  session.user = { id: ctx.barber.id, role: 'barber' };
  session.client = ctx.barber.client;
});

afterAll(async () => {
  if (!ctx.svc) return;
  if (ctx.serviceId) await ctx.svc.from('bookings').delete().eq('service_id', ctx.serviceId);
  const barbers = [ctx.own, ctx.other].filter(Boolean);
  if (barbers.length > 0) await ctx.svc.from('barbers').delete().in('id', barbers);
  if (ctx.serviceId) await ctx.svc.from('services').delete().eq('id', ctx.serviceId);
  if (ctx.userId) await ctx.svc.auth.admin.deleteUser(ctx.userId);
}, 120_000);

async function book(barberId: string, startsAt: string): Promise<string> {
  const row = must(
    await ctx.svc
      .from('bookings')
      .insert({
        guest_name: `RF6C Ospite ${tag}`,
        guest_phone: '+390300006100',
        barber_id: barberId,
        service_id: ctx.serviceId,
        starts_at: startsAt,
        status: 'confirmed',
        source: 'manual',
      })
      .select('id')
      .single(),
    'prenotazione',
  ) as { id: string };
  return row.id;
}

async function startsAt(id: string): Promise<number> {
  const row = must(await ctx.svc.from('bookings').select('starts_at').eq('id', id).single(), 'lettura') as { starts_at: string };
  return ms(row.starts_at);
}

const form = (values: Record<string, string>, confirmed: string[] = []): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  if (confirmed.length > 0) {
    data.set('confirm', '1');
    for (const code of confirmed) data.append('shownWarnings', code);
  }
  return data;
};

async function submit(values: Record<string, string>, confirmed: string[] = []): Promise<FormState> {
  const { moveBookingFromForm } = (await import('@/lib/calendar/actions')) as unknown as ActionsModule;
  return moveBookingFromForm({ status: 'idle' }, form(values, confirmed));
}

describe('moveBookingFormSchema (review fetta 6c, B1)', () => {
  const valid = {
    id: 'bd000000-0000-4000-8000-00000000c611',
    date: '2046-01-10',
    time: '10:30',
    expectedBarberId: 'b0000000-0000-4000-8000-00000000c611',
    expectedStartsAt: '2046-01-10T09:00:00.000Z',
    confirmedWarnings: [],
  };

  test('input valido accettato; ora fuori dal passo di 5 minuti, data o inizio atteso non validi → rifiutati', async () => {
    const { moveBookingFormSchema } = (await import('@/lib/calendar/schemas')) as unknown as SchemasModule;
    expect(moveBookingFormSchema.safeParse(valid).success).toBe(true);
    expect(moveBookingFormSchema.safeParse({ ...valid, time: '10:32' }).success).toBe(false);
    expect(moveBookingFormSchema.safeParse({ ...valid, date: '2046-02-30' }).success).toBe(false);
    expect(moveBookingFormSchema.safeParse({ ...valid, expectedStartsAt: '2046-01-10T09:00:00' }).success).toBe(false);
  });
});

describe('moveBookingFromForm: barbiere (review fetta 6c, B1)', () => {
  test('sposta l\'orario di una propria confirmed futura con data e ora locali', async () => {
    const original = at('2046-01-10', '10:00');
    const id = await book(ctx.own, original);
    const result = await submit({ id, date: '2046-01-10', time: '11:15', expectedBarberId: ctx.own, expectedStartsAt: original });
    expect(result).toEqual({ status: 'saved' });
    expect(await startsAt(id)).toBe(ms(at('2046-01-10', '11:15')));
  });

  test('SPEC §3.7.5: fuori fascia → avvisi e nulla salvato; con "Conferma comunque" → salvato', async () => {
    const original = at('2046-01-11', '10:00');
    const id = await book(ctx.own, original);
    const values = { id, date: '2046-01-11', time: '14:00', expectedBarberId: ctx.own, expectedStartsAt: original };

    const first = await submit(values);
    expect(first.status).toBe('warnings');
    expect(first.warnings).toEqual(['outside_hours']);
    expect(await startsAt(id)).toBe(ms(original));

    expect((await submit(values, ['outside_hours'])).status).toBe('saved');
    expect(await startsAt(id)).toBe(ms(at('2046-01-11', '14:00')));
  });

  test('prenotazione di un altro barbiere → forbidden, nulla salvato', async () => {
    const original = at('2046-01-12', '10:00');
    const id = await book(ctx.other, original);
    const result = await submit({ id, date: '2046-01-12', time: '11:00', expectedBarberId: ctx.other, expectedStartsAt: original });
    expect(result.status).toBe('forbidden');
    expect(await startsAt(id)).toBe(ms(original));
  });

  test('SPEC §12: ora inesistente nel passaggio all\'ora legale (25/03/2046, 02:30) → invalid_time', async () => {
    const original = at('2046-03-24', '10:00');
    const id = await book(ctx.own, original);
    const result = await submit({ id, date: '2046-03-25', time: '02:30', expectedBarberId: ctx.own, expectedStartsAt: original });
    expect(result.status).toBe('invalid_time');
    expect(await startsAt(id)).toBe(ms(original));
  });

  test('review fetta 6c (decisione dell\'utente): destinazione nel passato → past_target, anche confermando', async () => {
    const original = at('2046-01-14', '10:00');
    const id = await book(ctx.own, original);
    const values = { id, date: '2020-01-15', time: '10:00', expectedBarberId: ctx.own, expectedStartsAt: original };
    expect((await submit(values)).status).toBe('past_target');
    expect((await submit(values, ['past'])).status).toBe('past_target');
    expect(await startsAt(id)).toBe(ms(original));
  });

  test('ora fuori dal passo di 5 minuti → invalid, nulla salvato', async () => {
    const original = at('2046-01-13', '10:00');
    const id = await book(ctx.own, original);
    const result = await submit({ id, date: '2046-01-13', time: '10:32', expectedBarberId: ctx.own, expectedStartsAt: original });
    expect(result.status).toBe('invalid');
    expect(await startsAt(id)).toBe(ms(original));
  });
});
