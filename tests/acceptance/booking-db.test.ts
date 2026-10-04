// Test di accettazione – FETTA 5 (SPEC §11: "Flusso prenotazione cliente + Le mie prenotazioni"),
// integrazione con il database locale. Sezioni: SPEC §3.7.1–3, §4, §8 (rate limiting), §12 (ora
// legale, pausa pranzo, oltre la chiusura, prenotazioni concorrenti); ADR 004 ("test di coerenza tra
// motore e validazione SQL", pickBarber) + decisioni approvate per la fetta 5.
//
// 1. Coerenza: ogni orario proposto da getAvailableSlots è accettato da online_slot_error (null) e
//    un campione di orari non proposti è rifiutato.
//    Date: il giorno del cambio d'ora non è una data fissa come nei test della fetta 4 (2026-10-25,
//    2027-03-28): online_slot_error usa now() reale, quindi una data fissa prima o poi finirebbe nel
//    passato. Il test cerca il prossimo cambio d'ora di Europe/Rome (il giorno locale che non dura
//    24 ore) e, per tutta la durata del file, porta max_horizon_days a 365 (ripristinato in afterAll,
//    anche se il setup fallisce a metà). Se nei prossimi 365 giorni non c'è un cambio d'ora, il caso
//    viene saltato con un messaggio esplicito.
//    Gli slot di oggi troppo vicini all'anticipo minimo (entro 2 minuti) sono esclusi dal controllo:
//    fra il calcolo e la verifica passa del tempo reale. Il bordo esatto è nei test del motore e nel
//    pgTAP 19.
// 2. "Nessuna preferenza": il barbiere scelto da create_online_booking(null) coincide con pickBarber
//    calcolato sugli stessi dati (conteggi letti con la service role).
// 3. Concorrenza reale (Promise.all con il client autenticato del cliente, richieste parallele a
//    PostgREST, una transazione ciascuna): il limite delle 3 prenotazioni future e il controllo di
//    sovrapposizione del cliente reggono alla gara. Il pgTAP 19 verifica solo la presa del lock.
//
// Richiede lo stack Supabase locale avviato (seed non necessario). La service role serve solo al
// test per preparare e pulire i dati e leggere i conteggi; il codice applicativo non la usa.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { pickBarber, type AvailabilityInput, type BarberAvailabilityInput } from '@/lib/availability';

type SlotsResult = { ok: true; slots: string[] } | { ok: false; error: 'invalid' | 'error' };
type BookingAvailabilityModule = {
  getAvailableSlots: (args: { serviceId: string; barberId: string; date: string }) => Promise<SlotsResult>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

// getAvailableSlots gira con il client della richiesta senza sessione (anon)
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

// ---------------------------------------------------------------------------
// Ambiente (come availability-db.test.ts)
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

const TZ = 'Europe/Rome';
const MIN = 60_000;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// ---------------------------------------------------------------------------
// Date nella timezone del negozio
// ---------------------------------------------------------------------------
const localDate = (d: Date): string => formatInTimeZone(d, TZ, 'yyyy-MM-dd');
const plusDays = (date: string, days: number): string => {
  const v = new Date(`${date}T12:00:00Z`);
  v.setUTCDate(v.getUTCDate() + days);
  return v.toISOString().slice(0, 10);
};
/** Istante dell'ora locale `time` (HH:mm) del giorno `date`, come ISO UTC. */
const rome = (date: string, time: string): string => fromZonedTime(`${date}T${time}:00`, TZ).toISOString();
const startOfDay = (date: string): string => rome(date, '00:00');
const localTime = (iso: string): string => formatInTimeZone(new Date(iso), TZ, 'HH:mm');

/** Ultima domenica di marzo (month = 3) o di ottobre (month = 10), YYYY-MM-DD. */
/**
 * Primo giorno di cambio d'ora a Roma in [from, to]: il giorno locale che non dura 24 ore. null se
 * non ce n'è (es. una zona o un anno senza ora legale): il test relativo viene saltato.
 */
const nextDstDay = (from: string, to: string): string | null => {
  for (let day = from; day <= to; day = plusDays(day, 1)) {
    if (Date.parse(startOfDay(plusDays(day, 1))) - Date.parse(startOfDay(day)) !== 24 * 60 * MIN) return day;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Dati del test
// ---------------------------------------------------------------------------
type Settings = {
  timezone: string;
  slot_granularity_min: number;
  min_advance_min: number;
  max_horizon_days: number;
  buffer_min: number;
  privacy_policy_version: string | null;
};

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ctx = {
  svc: null as unknown as SupabaseClient,
  anon: null as unknown as SupabaseClient,
  settings: null as unknown as Settings,
  originalHorizon: null as number | null,
  serviceId: '',
  barberA: '', // 09:00–13:00 e 15:00–19:00 tutti i giorni; la domenica anche 00:00–05:00
  barberB: '', // 06:00–23:00 tutti i giorni
  today: '',
  normalDay: '',
  dstDay: null as string | null,
  userIds: [] as string[],
  customers: [] as SupabaseClient[],
};
let setupError: unknown = null;

const must = <T>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: nessun dato`);
  return result.data;
};

/** Cliente con profilo completo (nome, telefono, consenso privacy alla versione corrente), autenticato. */
async function createCustomer(label: string): Promise<SupabaseClient> {
  const email = `vt5-${label}-${tag}@qa.test`;
  const password = `Vt5-${tag}-password`;
  const created = await ctx.svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const id = created.data.user.id;
  ctx.userIds.push(id);
  const phone = `+39340${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  must(
    await ctx.svc
      .from('profiles')
      .update({
        full_name: `VT5 ${label}`,
        phone,
        privacy_policy_version: ctx.settings.privacy_policy_version,
        privacy_consent_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id'),
    'profilo',
  );
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`login ${label}: ${signIn.error.message}`);
  return client;
}

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  ctx.svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, noSession);
  ctx.anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, noSession);

  const settings = must(
    await ctx.svc
      .from('shop_settings')
      .select('timezone, slot_granularity_min, min_advance_min, max_horizon_days, buffer_min, privacy_policy_version')
      .single(),
    'impostazioni',
  ) as Settings;
  if (settings.timezone !== TZ) throw new Error(`timezone del negozio inattesa: ${settings.timezone}`);
  ctx.originalHorizon = settings.max_horizon_days;
  must(await ctx.svc.from('shop_settings').update({ max_horizon_days: 365 }).eq('id', true).select('id'), 'orizzonte');
  ctx.settings = { ...settings, max_horizon_days: 365 };

  ctx.today = localDate(new Date());
  ctx.dstDay = nextDstDay(plusDays(ctx.today, 2), plusDays(ctx.today, 365));
  const closures = must(await ctx.svc.from('shop_closures').select('starts_at, ends_at'), 'chiusure') as Array<{
    starts_at: string;
    ends_at: string;
  }>;
  const closedOn = (date: string): boolean =>
    closures.some((c) => Date.parse(c.starts_at) < Date.parse(startOfDay(plusDays(date, 1))) && Date.parse(c.ends_at) > Date.parse(startOfDay(date)));
  for (let i = 2; i < 30 && !ctx.normalDay; i++) {
    const day = plusDays(ctx.today, i);
    if (day !== ctx.dstDay && !closedOn(day)) ctx.normalDay = day;
  }
  if (!ctx.normalDay) throw new Error('nessun giorno normale libero da chiusure');

  const service = must(
    await ctx.svc
      .from('services')
      .insert({ name: `VT5 Taglio ${tag}`, duration_min: 30, price_cents: 2000, is_active: true })
      .select('id')
      .single(),
    'servizio',
  ) as { id: string };
  ctx.serviceId = service.id;
  const barbers = must(
    await ctx.svc
      .from('barbers')
      .insert([
        { display_name: `VT5 A ${tag}`, is_active: true },
        { display_name: `VT5 B ${tag}`, is_active: true },
      ])
      .select('id, display_name'),
    'barbieri',
  ) as Array<{ id: string; display_name: string }>;
  ctx.barberA = barbers.find((b) => b.display_name.startsWith('VT5 A'))!.id;
  ctx.barberB = barbers.find((b) => b.display_name.startsWith('VT5 B'))!.id;
  must(
    await ctx.svc
      .from('barber_services')
      .insert([ctx.barberA, ctx.barberB].map((barber_id) => ({ barber_id, service_id: ctx.serviceId })))
      .select('barber_id'),
    'abilitazioni',
  );
  const hours: Array<{ barber_id: string; weekday: number; start_time: string; end_time: string }> = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    hours.push({ barber_id: ctx.barberA, weekday, start_time: '09:00', end_time: '13:00' });
    hours.push({ barber_id: ctx.barberA, weekday, start_time: '15:00', end_time: '19:00' });
    hours.push({ barber_id: ctx.barberB, weekday, start_time: '06:00', end_time: '23:00' });
  }
  hours.push({ barber_id: ctx.barberA, weekday: 7, start_time: '00:00', end_time: '05:00' });
  must(await ctx.svc.from('working_hours').insert(hours).select('id'), 'orari');

  // A occupato alle 10:00 del giorno normale (ospite, manuale)
  must(
    await ctx.svc
      .from('bookings')
      .insert({
        guest_name: 'VT5 Ospite',
        guest_phone: '+390300005000',
        barber_id: ctx.barberA,
        service_id: ctx.serviceId,
        starts_at: rome(ctx.normalDay, '10:00'),
        status: 'confirmed',
        source: 'manual',
      })
      .select('id'),
    'prenotazione di A',
  );

  ctx.customers = [await createCustomer('pick'), await createCustomer('future'), await createCustomer('overlap')];
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
});

afterAll(async () => {
  if (!ctx.svc) return;
  try {
    if (ctx.serviceId) {
      await ctx.svc.from('bookings').delete().eq('service_id', ctx.serviceId);
      await ctx.svc.from('barbers').delete().in('id', [ctx.barberA, ctx.barberB].filter(Boolean));
      await ctx.svc.from('services').delete().eq('id', ctx.serviceId);
    }
    for (const id of ctx.userIds) await ctx.svc.auth.admin.deleteUser(id);
  } finally {
    // L'orizzonte torna al valore originale anche se la pulizia fallisce.
    if (ctx.originalHorizon !== null) {
      await ctx.svc.from('shop_settings').update({ max_horizon_days: ctx.originalHorizon }).eq('id', true);
    }
  }
}, 120_000);

// ---------------------------------------------------------------------------
// Chiamate
// ---------------------------------------------------------------------------
async function slots(barberId: string, date: string): Promise<string[]> {
  const { getAvailableSlots } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
  const result = await getAvailableSlots({ serviceId: ctx.serviceId, barberId, date });
  if (!result.ok) throw new Error(`getAvailableSlots(${date}): ${result.error}`);
  return result.slots;
}

async function slotError(barberId: string, startsAt: string): Promise<string | null> {
  const { data, error } = await ctx.customers[0]!.rpc('online_slot_error', {
    p_service_id: ctx.serviceId,
    p_barber_id: barberId,
    p_starts_at: startsAt,
  });
  if (error) throw new Error(`online_slot_error: ${error.code} ${error.message}`);
  return (data ?? null) as string | null;
}

type CreateResult = { id: string | null; code: string | null; message: string | null };
async function create(client: SupabaseClient, barberId: string | null, startsAt: string): Promise<CreateResult> {
  const { data, error } = await client.rpc('create_online_booking', {
    p_service_id: ctx.serviceId,
    p_barber_id: barberId,
    p_starts_at: startsAt,
    p_notes: null,
  });
  return error ? { id: null, code: error.code, message: error.message } : { id: data as string, code: null, message: null };
}

/** Ogni slot proposto deve essere accettato da online_slot_error (null). */
async function expectAllAccepted(barberId: string, proposed: string[]): Promise<void> {
  const errors = await Promise.all(proposed.map(async (s) => [s, await slotError(barberId, s)] as const));
  const rejected = errors.filter(([, e]) => e !== null).map(([s, e]) => `${s} (${localTime(s)}): ${e}`);
  expect(rejected, 'slot proposti dal motore ma rifiutati dal database').toEqual([]);
}

/** Orario non proposto dal motore e rifiutato dal database con il codice atteso. */
async function expectRejected(barberId: string, proposed: string[], startsAt: string, code: string): Promise<void> {
  expect(proposed, `${startsAt} (${localTime(startsAt)}) non deve essere proposto`).not.toContain(startsAt);
  expect(await slotError(barberId, startsAt), `${startsAt} (${localTime(startsAt)})`).toBe(code);
}

// ---------------------------------------------------------------------------
// 1. Coerenza motore ↔ online_slot_error (ADR 004)
// ---------------------------------------------------------------------------
describe('ADR 004 – coerenza fra getAvailableSlots e online_slot_error', () => {
  test('giorno normale (barbiere A): ogni slot proposto è accettato', async () => {
    const proposed = await slots(ctx.barberA, ctx.normalDay);
    expect(proposed.length).toBeGreaterThan(0);
    await expectAllAccepted(ctx.barberA, proposed);
  }, 60_000);

  test('giorno normale (barbiere A): orari non proposti rifiutati (griglia, pausa pranzo, chiusura, prenotazione)', async () => {
    const proposed = await slots(ctx.barberA, ctx.normalDay);
    const day = ctx.normalDay;
    await expectRejected(ctx.barberA, proposed, rome(day, '15:07'), 'not_aligned');
    await expectRejected(ctx.barberA, proposed, rome(day, '12:45'), 'outside_hours'); // SPEC §12 pausa pranzo
    await expectRejected(ctx.barberA, proposed, rome(day, '14:00'), 'outside_hours');
    await expectRejected(ctx.barberA, proposed, rome(day, '18:45'), 'outside_hours'); // SPEC §12 oltre la chiusura
    await expectRejected(ctx.barberA, proposed, rome(day, '10:00'), 'unavailable');
    await expectRejected(ctx.barberA, proposed, rome(day, '09:45'), 'unavailable');
  }, 60_000);

  test('SPEC §12 – giorno del cambio d\'ora (barbiere A, anche la fascia 00:00–05:00): slot accettati, altri rifiutati', async (t) => {
    const dstDay = ctx.dstDay;
    if (!dstDay) {
      t.skip("nessun cambio d'ora a Europe/Rome nei prossimi 365 giorni: caso dell'ora legale saltato");
      return;
    }
    const proposed = await slots(ctx.barberA, dstDay);
    expect(proposed.some((s) => localTime(s) < '05:00'), 'slot nella fascia notturna').toBe(true);
    await expectAllAccepted(ctx.barberA, proposed);
    await expectRejected(ctx.barberA, proposed, rome(dstDay, '04:45'), 'outside_hours');
    await expectRejected(ctx.barberA, proposed, rome(dstDay, '14:00'), 'outside_hours');
    await expectRejected(ctx.barberA, proposed, rome(dstDay, '01:07'), 'not_aligned');
  }, 60_000);

  test('oggi (barbiere B): slot accettati; un orario prima dell\'anticipo minimo non è proposto ed è rifiutato', async () => {
    const proposed = await slots(ctx.barberB, ctx.today);
    const margin = Date.now() + (ctx.settings.min_advance_min + 2) * MIN;
    await expectAllAccepted(ctx.barberB, proposed.filter((s) => Date.parse(s) >= margin));

    const step = ctx.settings.slot_granularity_min * MIN;
    const early = new Date(Math.ceil((Date.now() + 2 * MIN) / step) * step).toISOString();
    if (Date.parse(early) < Date.now() + (ctx.settings.min_advance_min - 1) * MIN) {
      expect(proposed).not.toContain(early);
      const error = await slotError(ctx.barberB, early);
      const t = localTime(early);
      // Dentro la fascia 06:00–23:00 l'unica regola violata è l'anticipo
      if (t >= '06:00' && t <= '22:30') expect(error).toBe('too_soon');
      else expect(error).not.toBeNull();
    }
  }, 60_000);

  test('orizzonte (barbiere B): ultimo giorno accettato per intero, il giorno dopo nessuno slot e too_far', async () => {
    const lastDay = plusDays(ctx.today, ctx.settings.max_horizon_days);
    const proposed = await slots(ctx.barberB, lastDay);
    expect(proposed.length).toBeGreaterThan(0);
    await expectAllAccepted(ctx.barberB, proposed);

    const beyond = plusDays(lastDay, 1);
    const none = await slots(ctx.barberB, beyond);
    expect(none).toEqual([]);
    expect(await slotError(ctx.barberB, rome(beyond, '10:00'))).toBe('too_far');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. "Nessuna preferenza": create_online_booking(null) = pickBarber (SPEC §4, ADR 004)
// ---------------------------------------------------------------------------
async function engineInput(date: string): Promise<AvailabilityInput> {
  const rows = must(
    await ctx.anon.rpc('availability_inputs', {
      p_service_id: ctx.serviceId,
      p_barber_id: null,
      p_from: startOfDay(date),
      p_to: startOfDay(plusDays(date, 1)),
    }),
    'availability_inputs',
  ) as Array<{ kind: string; barber_id: string | null; starts_at: string; ends_at: string }>;
  const barbers = new Map<string, BarberAvailabilityInput>();
  const closures: AvailabilityInput['closures'] = [];
  for (const row of rows) {
    const interval = { start: new Date(row.starts_at), end: new Date(row.ends_at) };
    if (row.kind === 'closure') {
      closures.push(interval);
      continue;
    }
    if (!row.barber_id) continue;
    const b = barbers.get(row.barber_id) ?? { barberId: row.barber_id, work: [], timeOff: [], busy: [] };
    barbers.set(row.barber_id, b);
    if (row.kind === 'work') b.work.push(interval);
    else if (row.kind === 'time_off') b.timeOff.push(interval);
    else if (row.kind === 'busy') b.busy.push(interval);
  }
  return {
    timezone: TZ,
    now: new Date(),
    settings: {
      slotGranularityMin: ctx.settings.slot_granularity_min,
      minAdvanceMin: ctx.settings.min_advance_min,
      maxHorizonDays: ctx.settings.max_horizon_days,
      bufferMin: ctx.settings.buffer_min,
    },
    serviceDurationMin: 30,
    closures,
    barbers: [...barbers.values()],
  };
}

/** Prenotazioni non cancellate (confirmed, completed, no_show) per barbiere nel giorno locale. */
async function dayCounts(date: string): Promise<Record<string, number>> {
  const rows = must(
    await ctx.svc
      .from('bookings')
      .select('barber_id')
      .in('barber_id', [ctx.barberA, ctx.barberB])
      .in('status', ['confirmed', 'completed', 'no_show'])
      .gte('starts_at', startOfDay(date))
      .lt('starts_at', startOfDay(plusDays(date, 1))),
    'conteggi',
  ) as Array<{ barber_id: string }>;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.barber_id] = (counts[r.barber_id] ?? 0) + 1;
  return counts;
}

describe('SPEC §4 – "Nessuna preferenza": il database sceglie come pickBarber', () => {
  test('conteggi diversi e poi a parità: il barbiere assegnato coincide con pickBarber', async () => {
    const client = ctx.customers[0]!;
    for (const time of ['15:00', '15:30']) {
      const start = rome(ctx.normalDay, time);
      const expected = pickBarber(await engineInput(ctx.normalDay), new Date(start), await dayCounts(ctx.normalDay));
      expect(expected, `nessun barbiere libero alle ${time} secondo il motore`).not.toBeNull();

      const result = await create(client, null, start);
      expect(result.code, `${time}: ${result.message}`).toBeNull();
      const row = must(
        await ctx.svc.from('bookings').select('barber_id').eq('id', result.id ?? '').single(),
        'prenotazione creata',
      ) as { barber_id: string };
      expect(row.barber_id, `barbiere assegnato alle ${time}`).toBe(expected);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Concorrenza reale (SPEC §8 rate limiting, §12 prenotazioni concorrenti)
// ---------------------------------------------------------------------------
describe('SPEC §8 / §12 – richieste parallele dello stesso cliente', () => {
  test('5 creazioni valide in parallelo su slot diversi: ne riescono esattamente 3, le altre too_many_future', async () => {
    const client = ctx.customers[1]!;
    const times = ['06:00', '06:30', '07:00', '07:30', '08:00'];
    const results = await Promise.all(times.map((t) => create(client, ctx.barberB, rome(ctx.normalDay, t))));

    const ok = results.filter((r) => r.code === null);
    const failed = results.filter((r) => r.code !== null);
    expect(ok, JSON.stringify(results)).toHaveLength(3);
    for (const r of failed) {
      expect(r.code).toBe('P0001');
      expect(r.message).toBe('too_many_future');
    }
  }, 60_000);

  test('due creazioni parallele sovrapposte con barbieri diversi: ne riesce una sola (customer_overlap)', async () => {
    const client = ctx.customers[2]!;
    const start = rome(ctx.normalDay, '12:00');
    const results = await Promise.all([create(client, ctx.barberA, start), create(client, ctx.barberB, start)]);

    const ok = results.filter((r) => r.code === null);
    const failed = results.filter((r) => r.code !== null);
    expect(ok, JSON.stringify(results)).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.code).toBe('P0001');
    expect(failed[0]?.message).toBe('customer_overlap');
  }, 60_000);
});
