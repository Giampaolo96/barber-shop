// Test di accettazione – FETTA 6c ("Spostamento con trascinamento sul calendario"): logica pura,
// schema Zod, controlli statici su server action, UI e testi.
// Sezioni: SPEC §2 (ruoli), §3.6 (durata e prezzo copiati), §3.7.5 (avvisi), §6.1 (vista giorno),
// §6.3 (spostamento), §12 (cambio d'ora), CLAUDE.md regola 2 (timezone del negozio), regola 5
// (logica pura), Sicurezza (requireRole + Zod) + decisioni approvate per la fetta 6c (punti 1–9).
//
// Interfacce attese:
//   src/lib/calendar/move.ts (puro, senza I/O)
//     dropStart(grid: DayGrid, bookingStartsAt: Date, deltaRows: number): Date | null
//       deltaRows = 0 → bookingStartsAt invariato (anche se non allineato alla griglia);
//       altrimenti grid.rows[blockPosition(prenotazione).row + deltaRows]; null fuori dalla griglia.
//     canDrag(input: { role: 'admin' | 'barber'; status: BookingStatus; startsAt: Date; now: Date;
//                      isOwn: boolean }): boolean
//       confirmed e startsAt > now (startsAt == now → false); per il barbiere anche isOwn.
//     canDropOn(input: { role: 'admin' | 'barber'; sourceBarberId: string; targetBarberId: string;
//                        targetActive: boolean }): boolean
//       stessa colonna sempre; colonna diversa solo all'admin e solo se attiva.
//   src/lib/calendar/schemas.ts
//     moveBookingSchema: { id: uuid, barberId: uuid, startsAt: datetime ISO con offset,
//       expectedBarberId: uuid, expectedStartsAt: datetime ISO con offset,
//       confirmedWarnings?: WarningCode[] (default []) }; chiavi non previste scartate.
//   src/lib/calendar/actions.ts: export async function moveBooking(input) – requireRole(['barber','admin'])
//     prima del database, moveBookingSchema.safeParse.
//   src/i18n/it.ts: it.admin.calendar.move.{saved, undo, undone, dialogTitle, cancel, formTitle, submit}
//     (cancel = "Annulla" nel dialogo degli avvisi, AlertDialog; undo = "Annulla spostamento").
//   UI: @dnd-kit/core tra le dipendenze; schede trascinabili con -webkit-touch-callout: none e
//     user-select: none (componenti in src/components/admin/calendar/).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatInTimeZone } from 'date-fns-tz';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';

type BookingStatus = 'confirmed' | 'completed' | 'cancelled_by_customer' | 'cancelled_by_shop' | 'no_show';
type DayGrid = { startsAt: Date; endsAt: Date; granularityMin: number; rows: Date[] };
type LocalBand = { start: string; end: string };
type Interval = { startsAt: Date; endsAt: Date };
type Role = 'admin' | 'barber';

type GridModule = {
  dayGrid: (input: { date: string; tz: string; granularityMin: number; bands: LocalBand[]; bookings: Interval[] }) => DayGrid;
};
type MoveModule = {
  dropStart: (grid: DayGrid, bookingStartsAt: Date, deltaRows: number) => Date | null;
  canDrag: (input: { role: Role; status: BookingStatus; startsAt: Date; now: Date; isOwn: boolean }) => boolean;
  canDropOn: (input: { role: Role; sourceBarberId: string; targetBarberId: string; targetActive: boolean }) => boolean;
};
type SafeParse = { success: boolean; data?: Record<string, unknown> };
type SchemasModule = { moveBookingSchema: { safeParse: (input: unknown) => SafeParse } };

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;
const grid = () => load<GridModule>('@/lib/calendar/grid');
const move = () => load<MoveModule>('@/lib/calendar/move');
const schemas = () => load<SchemasModule>('@/lib/calendar/schemas');

const TZ = 'Europe/Rome';
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());
const local = (value: Date | null): string | null => (value === null ? null : formatInTimeZone(value, TZ, 'HH:mm xxx'));

// ---------------------------------------------------------------------------
// dropStart – decisioni 3 e 4
// ---------------------------------------------------------------------------
describe('dropStart (decisione 4: aggancio alle righe della griglia)', () => {
  // 2027-01-12 (ora solare, UTC+1): griglia 09:00–19:00, 40 righe da 15'
  const normalGrid = async (): Promise<DayGrid> =>
    (await grid()).dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 15, bands: [{ start: '09:00', end: '19:00' }], bookings: [] });

  test('deltaRows 0 → inizio invariato (stessa istanza di tempo)', async () => {
    const { dropStart } = await move();
    const start = new Date('2027-01-12T09:00:00Z'); // 10:00 locali
    expect(iso(dropStart(await normalGrid(), start, 0))).toBe('2027-01-12T09:00:00.000Z');
  });

  test('deltaRows 0 con inizio non allineato alla griglia → invariato (10:07 resta 10:07)', async () => {
    const { dropStart } = await move();
    expect(iso(dropStart(await normalGrid(), new Date('2027-01-12T09:07:00Z'), 0))).toBe('2027-01-12T09:07:00.000Z');
  });

  test('avanti e indietro di alcune righe: 10:00 +2 → 10:30, −4 → 09:00', async () => {
    const { dropStart } = await move();
    const g = await normalGrid();
    const start = new Date('2027-01-12T09:00:00Z');
    expect(iso(dropStart(g, start, 2))).toBe('2027-01-12T09:30:00.000Z');
    expect(iso(dropStart(g, start, -4))).toBe('2027-01-12T08:00:00.000Z');
  });

  test('inizio non allineato: si parte dalla riga di blockPosition (10:07 +1 → 10:15, −1 → 09:45)', async () => {
    const { dropStart } = await move();
    const g = await normalGrid();
    const start = new Date('2027-01-12T09:07:00Z');
    expect(iso(dropStart(g, start, 1))).toBe('2027-01-12T09:15:00.000Z');
    expect(iso(dropStart(g, start, -1))).toBe('2027-01-12T08:45:00.000Z');
  });

  test('bordi della griglia: prima e ultima riga ammesse, oltre → null', async () => {
    const { dropStart } = await move();
    const g = await normalGrid();
    expect(g.rows).toHaveLength(40);
    const start = new Date('2027-01-12T09:00:00Z'); // riga 4
    expect(iso(dropStart(g, start, -4))).toBe(iso(g.rows[0] ?? null));
    expect(dropStart(g, start, -5)).toBeNull();
    expect(iso(dropStart(g, start, 35))).toBe('2027-01-12T17:45:00.000Z'); // 18:45, ultima riga
    expect(dropStart(g, start, 36)).toBeNull();
  });

  test('SPEC §12: passaggio all\'ora solare (25/10/2026), l\'ora 02:xx ripetuta è raggiungibile', async () => {
    const { dropStart } = await move();
    const g = (await grid()).dayGrid({ date: '2026-10-25', tz: TZ, granularityMin: 15, bands: [{ start: '00:00', end: '05:00' }], bookings: [] });
    expect(g.rows).toHaveLength(24); // 5 ore locali = 6 ore reali
    const start = new Date('2026-10-24T23:45:00Z'); // 01:45 CEST
    expect(local(dropStart(g, start, 1))).toBe('02:00 +02:00');
    expect(local(dropStart(g, start, 5))).toBe('02:00 +01:00'); // seconda occorrenza
    expect(iso(dropStart(g, start, 5))).toBe('2026-10-25T01:00:00.000Z');
    expect(local(dropStart(g, start, 9))).toBe('03:00 +01:00');
  });

  test('SPEC §12: passaggio all\'ora legale (29/03/2026), dopo le 01:45 viene la riga delle 03:00', async () => {
    const { dropStart } = await move();
    const g = (await grid()).dayGrid({ date: '2026-03-29', tz: TZ, granularityMin: 15, bands: [{ start: '00:00', end: '05:00' }], bookings: [] });
    expect(g.rows).toHaveLength(16); // 5 ore locali = 4 ore reali
    const start = new Date('2026-03-29T00:45:00Z'); // 01:45 CET
    expect(local(dropStart(g, start, 1))).toBe('03:00 +02:00');
    expect(iso(dropStart(g, start, 1))).toBe('2026-03-29T01:00:00.000Z');
    expect(local(dropStart(g, start, -1))).toBe('01:30 +01:00');
  });

  test('granularità di 30 minuti: una riga = 30 minuti', async () => {
    const { dropStart } = await move();
    const g = (await grid()).dayGrid({ date: '2027-01-12', tz: TZ, granularityMin: 30, bands: [{ start: '09:00', end: '13:00' }], bookings: [] });
    expect(iso(dropStart(g, new Date('2027-01-12T08:00:00Z'), 3))).toBe('2027-01-12T09:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// canDrag – decisioni 1 e 3
// ---------------------------------------------------------------------------
describe('canDrag (decisioni 1 e 3: solo confirmed non ancora iniziate)', () => {
  const now = new Date('2027-01-12T09:00:00Z');
  const future = new Date('2027-01-12T09:15:00Z');
  const past = new Date('2027-01-12T08:45:00Z');

  test('admin: confirmed futura, anche di un altro barbiere → trascinabile', async () => {
    const { canDrag } = await move();
    expect(canDrag({ role: 'admin', status: 'confirmed', startsAt: future, now, isOwn: false })).toBe(true);
    expect(canDrag({ role: 'admin', status: 'confirmed', startsAt: future, now, isOwn: true })).toBe(true);
  });

  test('bordo: startsAt uguale a now → non trascinabile; già iniziata → non trascinabile', async () => {
    const { canDrag } = await move();
    for (const role of ['admin', 'barber'] as const) {
      expect(canDrag({ role, status: 'confirmed', startsAt: now, now, isOwn: true })).toBe(false);
      expect(canDrag({ role, status: 'confirmed', startsAt: past, now, isOwn: true })).toBe(false);
    }
    expect(canDrag({ role: 'admin', status: 'confirmed', startsAt: new Date(now.getTime() + 1), now, isOwn: false })).toBe(true);
  });

  test.each(['completed', 'cancelled_by_customer', 'cancelled_by_shop', 'no_show'] as const)(
    'stato %s → non trascinabile, nemmeno per l\'admin',
    async (status) => {
      const { canDrag } = await move();
      expect(canDrag({ role: 'admin', status, startsAt: future, now, isOwn: true })).toBe(false);
      expect(canDrag({ role: 'barber', status, startsAt: future, now, isOwn: true })).toBe(false);
    },
  );

  test('barbiere: solo le proprie', async () => {
    const { canDrag } = await move();
    expect(canDrag({ role: 'barber', status: 'confirmed', startsAt: future, now, isOwn: true })).toBe(true);
    expect(canDrag({ role: 'barber', status: 'confirmed', startsAt: future, now, isOwn: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canDropOn – decisione 4
// ---------------------------------------------------------------------------
describe('canDropOn (decisione 4: colonna di destinazione)', () => {
  const A = 'b0000000-0000-4000-8000-00000000c601';
  const B = 'b0000000-0000-4000-8000-00000000c602';

  test('stessa colonna: sempre ammessa, per entrambi i ruoli, anche se il barbiere è disattivato', async () => {
    const { canDropOn } = await move();
    for (const role of ['admin', 'barber'] as const) {
      for (const targetActive of [true, false]) {
        expect(canDropOn({ role, sourceBarberId: A, targetBarberId: A, targetActive }), `${role} ${targetActive}`).toBe(true);
      }
    }
  });

  test('colonna diversa: l\'admin solo se il barbiere è attivo', async () => {
    const { canDropOn } = await move();
    expect(canDropOn({ role: 'admin', sourceBarberId: A, targetBarberId: B, targetActive: true })).toBe(true);
    expect(canDropOn({ role: 'admin', sourceBarberId: A, targetBarberId: B, targetActive: false })).toBe(false);
  });

  test('colonna diversa: il barbiere mai', async () => {
    const { canDropOn } = await move();
    expect(canDropOn({ role: 'barber', sourceBarberId: A, targetBarberId: B, targetActive: true })).toBe(false);
    expect(canDropOn({ role: 'barber', sourceBarberId: A, targetBarberId: B, targetActive: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveBookingSchema – decisione 5, CLAUDE.md Sicurezza
// ---------------------------------------------------------------------------
describe('moveBookingSchema (decisione 5)', () => {
  const valid = {
    id: 'bd000000-0000-4000-8000-00000000c601',
    barberId: 'b0000000-0000-4000-8000-000000000001',
    startsAt: '2027-01-12T10:30:00.000Z',
    expectedBarberId: 'b0000000-0000-4000-8000-000000000002',
    expectedStartsAt: '2027-01-12T11:00:00+01:00',
  };

  test('input valido: confirmedWarnings di default []', async () => {
    const { moveBookingSchema } = await schemas();
    const parsed = moveBookingSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.confirmedWarnings).toEqual([]);
    expect(parsed.data?.id).toBe(valid.id);
    expect(parsed.data?.barberId).toBe(valid.barberId);
    expect(parsed.data?.expectedBarberId).toBe(valid.expectedBarberId);
  });

  test('avvisi confermati: solo codici di WARNING_CODES', async () => {
    const { moveBookingSchema } = await schemas();
    const all = ['outside_hours', 'time_off', 'closure', 'past'];
    expect(moveBookingSchema.safeParse({ ...valid, confirmedWarnings: all }).data?.confirmedWarnings).toEqual(all);
    expect(moveBookingSchema.safeParse({ ...valid, confirmedWarnings: ['barber_busy'] }).success).toBe(false);
    expect(moveBookingSchema.safeParse({ ...valid, confirmedWarnings: 'past' }).success).toBe(false);
  });

  test.each(['id', 'barberId', 'expectedBarberId'] as const)('%s non uuid → rifiutato', async (key) => {
    const { moveBookingSchema } = await schemas();
    expect(moveBookingSchema.safeParse({ ...valid, [key]: 'non-un-uuid' }).success).toBe(false);
  });

  test.each(['startsAt', 'expectedStartsAt'] as const)(
    '%s: datetime ISO con offset (Z o ±hh:mm); senza offset, solo data o testo → rifiutato',
    async (key) => {
      const { moveBookingSchema } = await schemas();
      expect(moveBookingSchema.safeParse({ ...valid, [key]: '2027-01-12T10:30:00Z' }).success).toBe(true);
      expect(moveBookingSchema.safeParse({ ...valid, [key]: '2027-01-12T10:30:00+01:00' }).success).toBe(true);
      expect(moveBookingSchema.safeParse({ ...valid, [key]: '2027-01-12T10:30:00' }).success).toBe(false);
      expect(moveBookingSchema.safeParse({ ...valid, [key]: '2027-01-12' }).success).toBe(false);
      expect(moveBookingSchema.safeParse({ ...valid, [key]: 'domani' }).success).toBe(false);
    },
  );

  test.each(['id', 'barberId', 'startsAt', 'expectedBarberId', 'expectedStartsAt'] as const)(
    '%s mancante → rifiutato',
    async (key) => {
      const { moveBookingSchema } = await schemas();
      const input: Record<string, unknown> = { ...valid };
      delete input[key];
      expect(moveBookingSchema.safeParse(input).success).toBe(false);
    },
  );

  test('SPEC §3.6: chiavi non previste (durata, prezzo, stato, servizio) scartate', async () => {
    const { moveBookingSchema } = await schemas();
    const parsed = moveBookingSchema.safeParse({
      ...valid,
      durationMin: 60,
      priceCents: 1,
      status: 'cancelled_by_shop',
      serviceId: '50000000-0000-4000-8000-000000000001',
    });
    expect(parsed.success).toBe(true);
    for (const key of ['durationMin', 'priceCents', 'status', 'serviceId']) {
      expect(parsed.data, key).not.toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Controlli statici – CLAUDE.md Sicurezza e regola 5, decisioni 5, 7, 9
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const readSource = (file: string): string => {
  const path = fromRoot(file);
  expect(existsSync(path), `file mancante: ${file}`).toBe(true);
  return stripComments(readFileSync(path, 'utf8'));
};
const walk = (dir: string): string[] => {
  const absolute = fromRoot(dir);
  if (!existsSync(absolute)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const rel = relative(ROOT, join(absolute, entry.name)).replace(/\\/g, '/');
    if (entry.isDirectory()) found.push(...walk(rel));
    else found.push(rel);
  }
  return found;
};
const exportedBody = (code: string, name: string): string => {
  const starts = [...code.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
  const index = starts.findIndex((m) => m[1] === name);
  if (index < 0) return '';
  return code.slice(starts[index]?.index ?? 0, starts[index + 1]?.index ?? code.length);
};

describe('moveBooking: server action (CLAUDE.md – Sicurezza)', () => {
  const STAFF_ROLES = /\brequireRole\s*\(\s*\[\s*(?:['"]barber['"]\s*,\s*['"]admin['"]|['"]admin['"]\s*,\s*['"]barber['"])\s*,?\s*\]\s*\)/;
  const DB_ACCESS = /\.(?:from|rpc)\s*\(|\bcreateClient\s*\(/;

  test('esportata da actions.ts, requireRole per lo staff prima del database e moveBookingSchema.safeParse', () => {
    const body = exportedBody(readSource('src/lib/calendar/actions.ts'), 'moveBooking');
    expect(body, 'moveBooking non esportata come async function').not.toBe('');
    const roleAt = body.search(STAFF_ROLES);
    expect(roleAt, 'requireRole(["barber", "admin"]) mancante').toBeGreaterThanOrEqual(0);
    const dbAt = body.search(DB_ACCESS);
    if (dbAt >= 0) expect(roleAt, 'requireRole dopo l\'accesso al database').toBeLessThan(dbAt);
    expect(body).toMatch(/\bmoveBookingSchema\b[\s\S]*?\.safeParse\s*\(/);
  });

  test('CLAUDE.md regola 5: move.ts è puro (niente database, rete, Next)', () => {
    const code = readSource('src/lib/calendar/move.ts');
    expect(code).not.toMatch(/@\/lib\/db|@supabase|next\/|server-only|\bfetch\s*\(|\bDate\.now\s*\(|new Date\(\s*\)/);
  });
});

describe('UI del trascinamento (decisione 7)', () => {
  test('@dnd-kit/core tra le dipendenze', () => {
    const pkg = JSON.parse(readFileSync(fromRoot('package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toHaveProperty('@dnd-kit/core');
  });

  test('schede trascinabili senza menu di iOS né selezione del testo', () => {
    const code = walk('src/components/admin/calendar')
      .filter((file) => /\.(?:tsx?|css)$/.test(file))
      .map(readSource)
      .join('\n');
    expect(code).toMatch(/touch-callout/i);
    expect(code).toMatch(/\bselect-none\b|user-select\s*:\s*none|userSelect\s*:\s*['"]none['"]/);
  });
});

describe('testi dello spostamento (decisione 9, SPEC §9)', () => {
  test.each(['saved', 'undo', 'undone', 'dialogTitle', 'cancel', 'formTitle', 'submit'])(
    'it.admin.calendar.move.%s è una stringa non vuota',
    (key) => {
      const move = (texts.admin.calendar as Record<string, unknown>).move as Record<string, unknown> | undefined;
      expect(typeof move?.[key], `it.admin.calendar.move.${key}`).toBe('string');
      expect(String(move?.[key]).trim()).not.toBe('');
    },
  );

  test('decisione dell\'utente: "Annulla" nel dialogo degli avvisi, "Annulla spostamento" dopo il salvataggio', () => {
    const move = (texts.admin.calendar as Record<string, unknown>).move as Record<string, unknown> | undefined;
    expect(move?.cancel).toBe('Annulla');
    expect(move?.undo).toBe('Annulla spostamento');
  });
});
