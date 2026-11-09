// Test di accettazione – FETTA 8h "Sicurezza dati", punto 3 dell'audit del 2026-10-30 (decisioni
// approvate dall'utente il 2026-11-08). SPEC §4 (orari liberi), §11 riga 8h ("test di
// availability_inputs oltre le 1000 righe verde"), CLAUDE.md regole 1 e 6.
//
// Problema: PostgREST taglia le risposte a 1000 righe (max_rows) senza errore; con l'orizzonte lungo
// availability_inputs supera il limite, le righe `busy` si perdono e il motore propone orari occupati.
// Interfacce attese:
//   public.availability_inputs_json(p_service_id uuid, p_barber_id uuid, p_from timestamptz, p_to timestamptz)
//     returns jsonb: array di { kind, barber_id, starts_at, ends_at }, stesse righe di availability_inputs;
//     execute ad anon e authenticated.
//   loadInput (src/lib/booking/availability.ts) chiama rpc("availability_inputs_json", stessi argomenti):
//   getWhenDays({ serviceId, from, to }) usa tutte le righe.
//
// Richiede lo stack Supabase locale. La service_role serve solo al test per preparare i dati (un
// servizio, un barbiere e più di 700 prenotazioni confirmed su un anno), poi tutto viene tolto e
// l'orizzonte torna al valore originale. Le letture passano da anon, come nell'app.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

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
/** max_rows di PostgREST (supabase/config.toml). */
const MAX_ROWS = 1000;
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

type Row = { kind: string; barber_id: string | null; starts_at: string; ends_at: string };
type Created = { id: string; starts_at: string; blocked_until: string };
type DaysResult =
  | { ok: true; days: Array<{ date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> }> }
  | { ok: false; error: 'invalid' | 'error' };
type BookingAvailabilityModule = {
  getWhenDays: (args: { serviceId: string; from: string; to: string }) => Promise<DaysResult>;
};

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ctx = {
  svc: null as unknown as SupabaseClient,
  anon: null as unknown as SupabaseClient,
  originalHorizon: null as number | null,
  serviceId: '',
  barberId: '',
  today: '',
  lastDay: '',
  created: [] as Created[],
};
let setupError: unknown = null;

const must = <T>(result: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: nessun dato`);
  return result.data;
};

const localDate = (date: Date): string => formatInTimeZone(date, TZ, 'yyyy-MM-dd');
const plusDays = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const rome = (date: string, time: string): string => fromZonedTime(`${date}T${time}:00`, TZ).toISOString();
const DURATION_MS = 30 * 60_000;

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  ctx.svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, noSession);
  ctx.anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, noSession);

  const settings = must(
    await ctx.svc.from('shop_settings').select('timezone, max_horizon_days').single(),
    'impostazioni',
  ) as { timezone: string; max_horizon_days: number };
  if (settings.timezone !== TZ) throw new Error(`timezone del negozio inattesa: ${settings.timezone}`);
  ctx.originalHorizon = settings.max_horizon_days;
  // Orizzonte massimo ammesso (SPEC §3.1): è il caso in cui l'audit ha riprodotto il problema.
  must(await ctx.svc.from('shop_settings').update({ max_horizon_days: 365 }).eq('id', true).select('id'), 'orizzonte');
  ctx.today = localDate(new Date());
  ctx.lastDay = plusDays(ctx.today, 365);

  ctx.serviceId = (
    must(
      await ctx.svc
        .from('services')
        .insert({ name: `QA 8h Taglio ${tag}`, duration_min: 30, price_cents: 2000, is_active: true })
        .select('id')
        .single(),
      'servizio',
    ) as { id: string }
  ).id;
  ctx.barberId = (
    must(
      await ctx.svc.from('barbers').insert({ display_name: `QA 8h ${tag}`, is_active: true }).select('id').single(),
      'barbiere',
    ) as { id: string }
  ).id;
  must(
    await ctx.svc.from('barber_services').insert({ barber_id: ctx.barberId, service_id: ctx.serviceId }).select('barber_id'),
    'abilitazione',
  );
  // Due fasce tutti i giorni: circa 730 righe `work` sull'anno, prima delle `busy` nella vecchia funzione
  const hours: Array<{ barber_id: string; weekday: number; start_time: string; end_time: string }> = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    hours.push({ barber_id: ctx.barberId, weekday, start_time: '09:00', end_time: '13:00' });
    hours.push({ barber_id: ctx.barberId, weekday, start_time: '15:00', end_time: '19:00' });
  }
  must(await ctx.svc.from('working_hours').insert(hours).select('barber_id'), 'orari');

  // Due prenotazioni confirmed al giorno (10:00 e 16:00) da dopodomani a fine orizzonte: oltre 700 righe `busy`
  const bookings = [];
  for (let i = 2; i < 365; i++) {
    const day = plusDays(ctx.today, i);
    for (const time of ['10:00', '16:00']) {
      bookings.push({
        guest_name: `QA 8h Ospite ${tag}`,
        guest_phone: '+390300008000',
        barber_id: ctx.barberId,
        service_id: ctx.serviceId,
        starts_at: rome(day, time),
        status: 'confirmed',
        source: 'manual',
      });
    }
  }
  ctx.created = must(
    await ctx.svc.from('bookings').insert(bookings).select('id, starts_at, blocked_until'),
    'prenotazioni',
  ) as Created[];
  if (ctx.created.length !== bookings.length) throw new Error(`prenotazioni create: ${ctx.created.length}/${bookings.length}`);
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
    if (ctx.serviceId) await ctx.svc.from('bookings').delete().eq('service_id', ctx.serviceId);
    if (ctx.barberId) await ctx.svc.from('barbers').delete().eq('id', ctx.barberId);
    if (ctx.serviceId) await ctx.svc.from('services').delete().eq('id', ctx.serviceId);
  } finally {
    // L'orizzonte torna al valore originale anche se la pulizia fallisce.
    if (ctx.originalHorizon !== null) {
      await ctx.svc.from('shop_settings').update({ max_horizon_days: ctx.originalHorizon }).eq('id', true);
    }
  }
}, 120_000);

/** Argomenti della lettura di tutto il periodo prenotabile, come loadInput. */
const wholeHorizon = () => ({
  p_service_id: ctx.serviceId,
  p_barber_id: null,
  p_from: rome(ctx.today, '00:00'),
  p_to: rome(plusDays(ctx.lastDay, 1), '00:00'),
});

// ---------------------------------------------------------------------------
// availability_inputs_json via PostgREST (anon) – nessuna riga persa oltre max_rows
// ---------------------------------------------------------------------------
describe('availability_inputs_json oltre le 1000 righe (fetta 8h, audit punto 3)', () => {
  test('anon: un solo jsonb con tutte le prenotazioni confirmed come intervalli busy, nessuna persa', async () => {
    const { data, error } = await ctx.anon.rpc('availability_inputs_json', wholeHorizon());
    expect(error, 'availability_inputs_json non disponibile per anon').toBeNull();
    expect(Array.isArray(data), 'la funzione restituisce un array jsonb').toBe(true);
    const rows = data as Row[];
    expect(rows.length, 'più righe di max_rows: la risposta non è tagliata').toBeGreaterThan(MAX_ROWS);

    const busy = new Set(
      rows
        .filter((row) => row.kind === 'busy' && row.barber_id === ctx.barberId)
        .map((row) => `${Date.parse(row.starts_at)}-${Date.parse(row.ends_at)}`),
    );
    const missing = ctx.created.filter(
      (booking) => !busy.has(`${Date.parse(booking.starts_at)}-${Date.parse(booking.blocked_until)}`),
    );
    expect(missing.length, `prenotazioni assenti dall'uscita (prima: ${missing[0]?.starts_at ?? '-'})`).toBe(0);
    expect(busy.size).toBe(ctx.created.length);
  });

  test('anon: stesse righe della vecchia funzione, che via PostgREST ne restituisce solo max_rows', async () => {
    // Il problema documentato: la vecchia funzione conta tutte le righe ma ne consegna al massimo 1000.
    const old = await ctx.anon.rpc('availability_inputs', wholeHorizon(), { count: 'exact' });
    expect(old.error).toBeNull();
    expect(old.count ?? 0).toBeGreaterThan(MAX_ROWS);
    expect(old.data?.length, 'availability_inputs via PostgREST è tagliata a max_rows').toBe(MAX_ROWS);

    const { data, error } = await ctx.anon.rpc('availability_inputs_json', wholeHorizon());
    expect(error).toBeNull();
    expect((data as Row[] | null)?.length, 'la nuova funzione consegna tutte le righe').toBe(old.count);
  });
});

// ---------------------------------------------------------------------------
// Dal database al motore: getWhenDays non propone orari occupati (SPEC §4, CLAUDE.md regola 1)
// ---------------------------------------------------------------------------
describe('getWhenDays con l\'orizzonte a 365 giorni e più di 1000 righe (fetta 8h)', () => {
  test('nessun orario proposto si sovrappone a una prenotazione confirmed, nemmeno nei giorni lontani', async () => {
    const { getWhenDays } = (await import('@/lib/booking/availability')) as BookingAvailabilityModule;
    const result = await getWhenDays({ serviceId: ctx.serviceId, from: ctx.today, to: ctx.lastDay });
    expect(result.ok, `getWhenDays non riuscita: ${result.ok ? '' : result.error}`).toBe(true);
    if (!result.ok) return;

    const slots = result.days.flatMap((day) =>
      day.barbers.filter((b) => b.barberId === ctx.barberId).flatMap((b) => b.slots.map((slot) => ({ date: day.date, slot }))),
    );
    // Il barbiere lavora tutti i giorni: i giorni lontani hanno orari (non risultano chiusi)
    const farDays = new Set(slots.filter((s) => s.date >= plusDays(ctx.today, 300)).map((s) => s.date));
    expect(farDays.size, 'giorni oltre i 300 giorni con orari').toBeGreaterThan(50);

    const overlapping = slots.filter(({ slot }) => {
      const start = Date.parse(slot);
      return ctx.created.some(
        (booking) => start < Date.parse(booking.blocked_until) && start + DURATION_MS > Date.parse(booking.starts_at),
      );
    });
    expect(overlapping.length, `orari occupati proposti (primo: ${overlapping[0]?.slot ?? '-'})`).toBe(0);
  });
});
