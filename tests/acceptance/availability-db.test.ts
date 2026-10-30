// modificato in fetta 8g con l'approvazione dell'utente (2026-10-30, audit punto 6): stesse verifiche su getWhenDays, al posto
// di getAvailableSlots (la funzione è stata tolta).
// Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità"), integrazione minima con il
// database locale (barbieri, servizi e orari del seed). getWhenDays gira con il client della
// richiesta senza sessione (anon): SPEC §4 "restituisce solo orari", CLAUDE.md – regola 6.
//
// Richiede lo stack Supabase locale avviato. La chiave service_role serve solo al test, per creare
// e leggere le prenotazioni: il codice applicativo non la usa.
// La prenotazione futura di Luca la crea il test (e la cancella alla fine) invece di leggerla dal
// seed: le prenotazioni del seed hanno date fissate al momento del `db reset` e dopo qualche giorno
// passano (modifica approvata dall'utente il 2026-10-19).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type DaysResult =
  | { ok: true; days: Array<{ date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> }> }
  | { ok: false; error: 'invalid' | 'error' };
type BookingAvailabilityModule = {
  getWhenDays: (args: { serviceId: string; from: string; to: string }) => Promise<DaysResult>;
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

// Seed: Luca e Mario, il servizio Taglio (30')
const LUCA = 'b0000000-0000-4000-8000-000000000002';
const MARIO = 'b0000000-0000-4000-8000-000000000001';
const TAGLIO = '50000000-0000-4000-8000-000000000001';
const TZ = 'Europe/Rome';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

type Busy = { starts_at: string; blocked_until: string };
let day = '';
let busyThatDay: Busy[] = [];
let setupError: unknown = null;
let service: SupabaseClient | null = null;
let createdId: string | null = null;
/** Nome dell'ospite della prenotazione creata: univoco per esecuzione, per riconoscere eventuali avanzi. */
const GUEST_NAME = `Test disponibilità ${randomUUID().slice(0, 8)}`;

/** Esito di una lettura: quante righe; errore se la lettura fallisce. */
const countOf = ({ data, error }: { data: unknown[] | null; error: { message: string } | null }): number => {
  if (error) throw new Error(`lettura fallita: ${error.message}`);
  return data?.length ?? 0;
};

/**
 * Prenotazione confirmed di Luca alle 15:30 del primo giorno lavorativo (mar–sab, orari del seed)
 * fra 2 e 20 giorni (dentro l'orizzonte di 30), senza chiusure né assenze di Luca quel giorno e con
 * Luca e Mario liberi a quell'ora ("qualsiasi" ha bisogno di un altro barbiere libero).
 */
async function createFutureBooking(client: SupabaseClient): Promise<void> {
  const noon = fromZonedTime(`${formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')}T12:00:00`, TZ);
  for (let offset = 2; offset <= 20; offset++) {
    const candidate = addDays(noon, offset);
    const isoWeekday = Number(formatInTimeZone(candidate, TZ, 'i'));
    if (isoWeekday < 2 || isoWeekday > 6) continue;
    const date = formatInTimeZone(candidate, TZ, 'yyyy-MM-dd');
    const dayStart = fromZonedTime(`${date}T00:00:00`, TZ).toISOString();
    const dayEnd = fromZonedTime(`${date}T23:59:59`, TZ).toISOString();
    const start = fromZonedTime(`${date}T15:30:00`, TZ).toISOString();
    const end = fromZonedTime(`${date}T16:30:00`, TZ).toISOString();
    const closures = countOf(
      await client.from('shop_closures').select('id').lt('starts_at', dayEnd).gt('ends_at', dayStart),
    );
    const timeOff = countOf(
      await client.from('time_off').select('id').eq('barber_id', LUCA).lt('starts_at', dayEnd).gt('ends_at', dayStart),
    );
    const busy = countOf(
      await client
        .from('bookings')
        .select('id')
        .in('barber_id', [LUCA, MARIO])
        .eq('status', 'confirmed')
        .lt('starts_at', end)
        .gt('blocked_until', start),
    );
    if (closures || timeOff || busy) continue;
    const { data, error } = await client
      .from('bookings')
      .insert({
        guest_name: GUEST_NAME,
        guest_phone: '+39 333 0000000',
        barber_id: LUCA,
        service_id: TAGLIO,
        starts_at: start,
        status: 'confirmed',
        source: 'manual',
      })
      .select('id')
      .single();
    if (error) throw new Error(`creazione della prenotazione fallita: ${error.message}`);
    createdId = data.id;
    day = date;
    return;
  }
  throw new Error('nessun giorno libero per Luca e Mario nei prossimi 20 giorni');
}

async function setup(): Promise<void> {
  loadEnv();
  for (const k of Object.keys(KEYS)) {
    if (!process.env[k]) throw new Error(`${k} mancante: avvia Supabase (npx supabase start)`);
  }
  service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await createFutureBooking(service);
  // Tutte le prenotazioni confirmed di Luca quel giorno, prima quella creata dal test
  const { data, error } = await service
    .from('bookings')
    .select('id, starts_at, blocked_until')
    .eq('barber_id', LUCA)
    .eq('status', 'confirmed')
    .gte('starts_at', fromZonedTime(`${day}T00:00:00`, TZ).toISOString())
    .lte('starts_at', fromZonedTime(`${day}T23:59:59`, TZ).toISOString());
  if (error) throw new Error(`lettura delle prenotazioni fallita: ${error.message}`);
  busyThatDay = [...(data ?? [])].sort((a, b) => Number(b.id === createdId) - Number(a.id === createdId));
}

beforeAll(async () => {
  try {
    await setup();
  } catch (error) {
    setupError = error;
  }
}, 120_000);
// Gira anche se un test o il setup (dopo l'inserimento) falliscono; si cancella per id.
afterAll(async () => {
  if (!service || !createdId) return;
  const { error } = await service.from('bookings').delete().eq('id', createdId);
  if (error) throw new Error(`cancellazione di "${GUEST_NAME}" (${createdId}) fallita: ${error.message}`);
});
// Ambiente mancante: ogni test fallisce (non viene saltato)
beforeEach(() => {
  if (setupError) throw setupError;
});

/** Orari del barbiere nel giorno del test, dalla lettura anon. */
async function slotsOf(barberId: string): Promise<string[]> {
  const { getWhenDays } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
  const result = await getWhenDays({ serviceId: TAGLIO, from: day, to: day });
  if (!result.ok) throw new Error(`getWhenDays(${day}): ${result.error}`);
  const entry = result.days[0]?.barbers.find((b) => b.barberId === barberId);
  if (entry) expect(Object.keys(entry).sort()).toEqual(['barberId', 'next', 'slots']);
  return entry?.slots ?? [];
}

describe('SPEC §4 – orari sul DB locale (seed, anon)', () => {
  test('solo istanti ISO UTC, ordinati, e nessuno slot sovrapposto alle prenotazioni confirmed di Luca', async () => {
    const slots = await slotsOf(LUCA);

    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(typeof s).toBe('string');
      expect(s).toMatch(ISO_UTC);
      expect(formatInTimeZone(new Date(s), TZ, 'yyyy-MM-dd')).toBe(day);
    }
    expect([...new Set(slots)].sort()).toEqual(slots);

    for (const s of slots) {
      const start = Date.parse(s);
      const end = start + 30 * 60_000;
      for (const b of busyThatDay) {
        const overlaps = start < Date.parse(b.blocked_until) && Date.parse(b.starts_at) < end;
        expect(overlaps, `${s} si sovrappone alla prenotazione delle ${b.starts_at}`).toBe(false);
      }
    }
  });

  test('l\'orario occupato da Luca resta disponibile con un altro barbiere', async () => {
    expect(await slotsOf(MARIO)).toContain(new Date(busyThatDay[0].starts_at).toISOString());
  });

  test('CLAUDE.md – Zod: input non valido rifiutato', async () => {
    const { getWhenDays } = await load<BookingAvailabilityModule>('@/lib/booking/availability');
    expect(await getWhenDays({ serviceId: TAGLIO, from: 'domani', to: 'domani' })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
