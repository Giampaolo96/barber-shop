// Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità"), integrazione minima con il
// database locale e il seed (`npx supabase db reset`). getAvailableSlots gira con il client della
// richiesta senza sessione (anon): SPEC §4 "restituisce solo orari", CLAUDE.md – regola 6.
//
// Richiede lo stack Supabase locale avviato. La chiave service_role serve solo al test, per leggere
// le prenotazioni del seed: il codice applicativo non la usa.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { formatInTimeZone } from 'date-fns-tz';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type SlotsResult = { ok: true; slots: string[] } | { ok: false; error: 'invalid' | 'error' };
type BookingAvailabilityModule = {
  getAvailableSlots: (args: { serviceId: string; barberId: string; date: string }) => Promise<SlotsResult>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

// Nessuna sessione: il client della richiesta è anon
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));

// ---------------------------------------------------------------------------
// Ambiente: in CI le variabili arrivano dallo step "Export Supabase env"; in locale, se mancano,
// si leggono tutte e tre da `npx supabase status -o env` (stesso stack, valori coerenti).
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

// Seed: Luca e il servizio Taglio (30')
const LUCA = 'b0000000-0000-4000-8000-000000000002';
const TAGLIO = '50000000-0000-4000-8000-000000000001';
const TZ = 'Europe/Rome';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

type Busy = { starts_at: string; blocked_until: string };
let day = '';
let busyThatDay: Busy[] = [];
let setupError: unknown = null;

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  // Prenotazioni confirmed future di Luca nel seed, con almeno un giorno di margine
  const { data, error } = await service
    .from('bookings')
    .select('starts_at, blocked_until')
    .eq('barber_id', LUCA)
    .eq('status', 'confirmed')
    .gt('starts_at', new Date(Date.now() + 24 * 3600_000).toISOString())
    .order('starts_at');
  if (error) throw new Error(`lettura del seed fallita: ${error.message}`);
  if (!data?.length) throw new Error('nessuna prenotazione futura di Luca nel seed: esegui `npx supabase db reset`');
  day = formatInTimeZone(new Date(data[0].starts_at), TZ, 'yyyy-MM-dd');
  busyThatDay = data.filter((b) => formatInTimeZone(new Date(b.starts_at), TZ, 'yyyy-MM-dd') === day);
}

beforeAll(async () => {
  try {
    await setup();
  } catch (error) {
    setupError = error;
  }
}, 120_000);
// Ambiente mancante: ogni test fallisce (non viene saltato)
beforeEach(() => {
  if (setupError) throw setupError;
});

describe('SPEC §4 – getAvailableSlots sul DB locale (seed, anon)', () => {
  test('solo istanti ISO UTC, ordinati, e nessuno slot sovrapposto alle prenotazioni confirmed di Luca', async () => {
    const { getAvailableSlots } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
    const result = await getAvailableSlots({ serviceId: TAGLIO, barberId: LUCA, date: day });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(['ok', 'slots']);
    expect(result.slots.length).toBeGreaterThan(0);
    for (const s of result.slots) {
      expect(typeof s).toBe('string');
      expect(s).toMatch(ISO_UTC);
      expect(formatInTimeZone(new Date(s), TZ, 'yyyy-MM-dd')).toBe(day);
    }
    expect([...new Set(result.slots)].sort()).toEqual(result.slots);

    for (const s of result.slots) {
      const start = Date.parse(s);
      const end = start + 30 * 60_000;
      for (const b of busyThatDay) {
        const overlaps = start < Date.parse(b.blocked_until) && Date.parse(b.starts_at) < end;
        expect(overlaps, `${s} si sovrappone alla prenotazione delle ${b.starts_at}`).toBe(false);
      }
    }
  });

  test('"qualsiasi": l\'orario occupato da Luca resta disponibile con un altro barbiere', async () => {
    const { getAvailableSlots } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
    const result = await getAvailableSlots({ serviceId: TAGLIO, barberId: 'any', date: day });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots).toContain(new Date(busyThatDay[0].starts_at).toISOString());
  });

  test('CLAUDE.md – Zod: input non valido rifiutato', async () => {
    const { getAvailableSlots } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
    expect(await getAvailableSlots({ serviceId: TAGLIO, barberId: LUCA, date: 'domani' })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
