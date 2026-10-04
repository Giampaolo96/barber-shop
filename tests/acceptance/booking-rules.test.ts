// Test di accettazione – FETTA 5 (SPEC §11: "Flusso prenotazione cliente + Le mie prenotazioni"),
// logica pura e struttura delle server action.
// Sezioni: SPEC §3.1 (cancel_limit_min, no_show_block_threshold), §3.6, §4 ("Orario appena occupato,
// scegline un altro"), §5.3 (Le mie prenotazioni), §8, §12 (cancellazione al limite, cliente bloccato),
// CLAUDE.md – Sicurezza (Zod e requireRole in ogni server action) + decisioni approvate per la fetta 5.
//
// Interfacce attese:
//   src/lib/booking/rules.ts (puro)
//     canCancel(startsAt: Date, now: Date, cancelLimitMin: number): boolean        (bordo incluso)
//     splitBookings<T extends { startsAt: Date | string; status: string }>(bookings: T[], now: Date)
//       : { upcoming: T[]; past: T[] }   upcoming = confirmed con inizio >= now, crescente;
//                                        past = tutto il resto, decrescente
//     isBlockedForBooking(p: { isBlocked: boolean; noShowCount: number }, threshold: number): boolean
//   src/lib/booking/schemas.ts
//     createBookingSchema: { serviceId: uuid, barberId: uuid | "any", startsAt: ISO con offset,
//                            notes?: ≤ 500 caratteri dopo il trim }
//     cancelBookingSchema: { bookingId: uuid }
//   src/lib/booking/errors.ts (puro)
//     bookingErrorMessage(code: string): string   – testi da src/i18n/it.ts
//   src/lib/booking/actions.ts ("use server"): createBooking(prev, formData), cancelBooking(prev, formData)
//   src/lib/booking/availability-actions.ts ("use server"): fetchAvailableSlots, fetchAvailableDays
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';

type Split<T> = { upcoming: T[]; past: T[] };
type RulesModule = {
  canCancel: (startsAt: Date, now: Date, cancelLimitMin: number) => boolean;
  splitBookings: <T extends { startsAt: Date | string; status: string }>(bookings: T[], now: Date) => Split<T>;
  isBlockedForBooking: (p: { isBlocked: boolean; noShowCount: number }, threshold: number) => boolean;
};
type SafeParse = { success: boolean; data?: Record<string, unknown> };
type Schema = { safeParse: (input: unknown) => SafeParse };
type SchemasModule = { createBookingSchema: Schema; cancelBookingSchema: Schema };
type ErrorsModule = { bookingErrorMessage: (code: string) => string };

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const rules = () => load<RulesModule>('@/lib/booking/rules');
const schemas = () => load<SchemasModule>('@/lib/booking/schemas');
const errors = () => load<ErrorsModule>('@/lib/booking/errors');

const MIN = 60_000;
const NOW = new Date('2027-01-12T09:00:00.000Z');
const at = (minutesFromNow: number): Date => new Date(NOW.getTime() + minutesFromNow * MIN);

// ---------------------------------------------------------------------------
// canCancel – SPEC §5.3, §12
// ---------------------------------------------------------------------------
describe('canCancel (SPEC §5.3)', () => {
  test('SPEC §12: esattamente al limite di cancel_limit_min → si può cancellare', async () => {
    const { canCancel } = await rules();
    expect(canCancel(at(120), NOW, 120)).toBe(true);
  });

  test('SPEC §12: un minuto oltre il limite → non si può più cancellare', async () => {
    const { canCancel } = await rules();
    expect(canCancel(at(119), NOW, 120)).toBe(false);
  });

  test('ben prima del limite → sì; appuntamento già iniziato → no', async () => {
    const { canCancel } = await rules();
    expect(canCancel(at(3 * 24 * 60), NOW, 120)).toBe(true);
    expect(canCancel(at(-30), NOW, 120)).toBe(false);
  });

  test('limite 0: fino all\'inizio compreso', async () => {
    const { canCancel } = await rules();
    expect(canCancel(at(0), NOW, 0)).toBe(true);
    expect(canCancel(new Date(NOW.getTime() - 1), NOW, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// splitBookings – SPEC §5.3 "future e passate"
// ---------------------------------------------------------------------------
describe('splitBookings (SPEC §5.3)', () => {
  type B = { id: string; startsAt: Date | string; status: string };
  const list: B[] = [
    { id: 'future-late', startsAt: at(3000).toISOString(), status: 'confirmed' },
    { id: 'past-completed', startsAt: at(-3000), status: 'completed' },
    { id: 'future-cancelled', startsAt: at(500), status: 'cancelled_by_customer' },
    { id: 'now', startsAt: NOW, status: 'confirmed' },
    { id: 'future-early', startsAt: at(60), status: 'confirmed' },
    { id: 'past-confirmed', startsAt: at(-10).toISOString(), status: 'confirmed' },
    { id: 'past-no-show', startsAt: at(-500), status: 'no_show' },
    { id: 'future-shop-cancelled', startsAt: at(800).toISOString(), status: 'cancelled_by_shop' },
  ];

  test('future = confirmed con inizio ≥ now, in ordine crescente', async () => {
    const { splitBookings } = await rules();
    expect(splitBookings(list, NOW).upcoming.map((b) => b.id)).toEqual(['now', 'future-early', 'future-late']);
  });

  test('passate = tutto il resto (anche le cancellate future), in ordine decrescente', async () => {
    const { splitBookings } = await rules();
    expect(splitBookings(list, NOW).past.map((b) => b.id)).toEqual([
      'future-shop-cancelled',
      'future-cancelled',
      'past-confirmed',
      'past-no-show',
      'past-completed',
    ]);
  });

  test('restituisce gli stessi oggetti, senza modificare l\'input', async () => {
    const { splitBookings } = await rules();
    const copy = [...list];
    const { upcoming, past } = splitBookings(list, NOW);
    expect(list).toEqual(copy);
    expect(upcoming.length + past.length).toBe(list.length);
    for (const b of [...upcoming, ...past]) expect(list).toContain(b);
  });
});

// ---------------------------------------------------------------------------
// isBlockedForBooking – SPEC §3.1, §6.7, §12
// ---------------------------------------------------------------------------
describe('isBlockedForBooking (SPEC §3.1, §12)', () => {
  test('blocco manuale dell\'admin → bloccato, qualunque soglia', async () => {
    const { isBlockedForBooking } = await rules();
    expect(isBlockedForBooking({ isBlocked: true, noShowCount: 0 }, 3)).toBe(true);
    expect(isBlockedForBooking({ isBlocked: true, noShowCount: 0 }, 0)).toBe(true);
  });

  test('SPEC §12: no-show pari o oltre la soglia → bloccato', async () => {
    const { isBlockedForBooking } = await rules();
    expect(isBlockedForBooking({ isBlocked: false, noShowCount: 3 }, 3)).toBe(true);
    expect(isBlockedForBooking({ isBlocked: false, noShowCount: 4 }, 3)).toBe(true);
  });

  test('no-show sotto la soglia → non bloccato', async () => {
    const { isBlockedForBooking } = await rules();
    expect(isBlockedForBooking({ isBlocked: false, noShowCount: 2 }, 3)).toBe(false);
  });

  test('SPEC §3.1: soglia 0 = blocco per no-show disattivato', async () => {
    const { isBlockedForBooking } = await rules();
    expect(isBlockedForBooking({ isBlocked: false, noShowCount: 10 }, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schemi Zod – CLAUDE.md – Sicurezza
// ---------------------------------------------------------------------------
describe('createBookingSchema / cancelBookingSchema (CLAUDE.md – Zod)', () => {
  const SERVICE = '50000000-0000-4000-8000-000000000001';
  const BARBER = 'b0000000-0000-4000-8000-000000000002';
  const valid = { serviceId: SERVICE, barberId: BARBER, startsAt: '2027-01-12T10:00:00+01:00' };

  test('input valido con barbiere, con "any" e con offset Z', async () => {
    const { createBookingSchema } = await schemas();
    expect(createBookingSchema.safeParse(valid).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...valid, barberId: 'any' }).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...valid, startsAt: '2027-01-12T09:00:00Z' }).success).toBe(true);
  });

  test('rifiuta id non uuid, barbiere diverso da uuid/"any", data senza offset o non valida', async () => {
    const { createBookingSchema } = await schemas();
    for (const input of [
      { ...valid, serviceId: 'taglio' },
      { ...valid, barberId: 'qualsiasi' },
      { ...valid, barberId: '' },
      { ...valid, startsAt: '2027-01-12T10:00:00' },
      { ...valid, startsAt: '12/01/2027 10:00' },
      { ...valid, startsAt: '' },
      { serviceId: SERVICE, barberId: BARBER },
    ]) {
      expect(createBookingSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  test('nota: facoltativa, senza spazi ai lati, al massimo 500 caratteri dopo il trim', async () => {
    const { createBookingSchema } = await schemas();
    const trimmed = createBookingSchema.safeParse({ ...valid, notes: '  Sfumatura bassa  ' });
    expect(trimmed.success).toBe(true);
    expect(trimmed.data?.notes).toBe('Sfumatura bassa');

    expect(createBookingSchema.safeParse({ ...valid, notes: `  ${'a'.repeat(500)}  ` }).success).toBe(true);
    expect(createBookingSchema.safeParse({ ...valid, notes: 'a'.repeat(501) }).success).toBe(false);

    const blank = createBookingSchema.safeParse({ ...valid, notes: '    ' });
    expect(blank.success).toBe(true);
    expect([undefined, null, '']).toContain(blank.data?.notes);
  });

  test('cancelBookingSchema: solo uuid', async () => {
    const { cancelBookingSchema } = await schemas();
    expect(cancelBookingSchema.safeParse({ bookingId: 'bc000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(cancelBookingSchema.safeParse({ bookingId: '1' }).success).toBe(false);
    expect(cancelBookingSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Messaggi d'errore – SPEC §4, §9 (testi in it.ts)
// ---------------------------------------------------------------------------
describe('bookingErrorMessage (SPEC §4, §9)', () => {
  const TAKEN_TEXT = 'Orario appena occupato, scegline un altro';

  const allTexts = (node: unknown): string[] =>
    typeof node === 'string'
      ? [node]
      : typeof node === 'object' && node !== null
        ? Object.values(node).flatMap(allTexts)
        : [];

  // Codici per cui il cliente deve capire cosa fare: messaggio specifico, non quello generico
  const SPECIFIC = [
    'service_unavailable',
    'barber_unavailable',
    'too_soon',
    'too_far',
    'taken',
    'profile_incomplete',
    'blocked',
    'notes_too_long',
    'too_many_future',
    'too_many_recent',
    'customer_overlap',
    'not_cancellable',
    'too_late',
  ];
  const OTHERS = ['not_aligned', 'outside_hours', 'time_off', 'closed', 'not_customer', 'not_found'];

  test('SPEC §4: "taken" e la violazione del vincolo di esclusione (23P01) → stesso testo', async () => {
    const { bookingErrorMessage } = await errors();
    expect(bookingErrorMessage('taken')).toBe(TAKEN_TEXT);
    expect(bookingErrorMessage('23P01')).toBe(TAKEN_TEXT);
  });

  test('SPEC §9: ogni codice ha un testo di src/i18n/it.ts', async () => {
    const { bookingErrorMessage } = await errors();
    const known = new Set(allTexts(texts));
    for (const code of [...SPECIFIC, ...OTHERS, 'codice-sconosciuto']) {
      const message = bookingErrorMessage(code);
      expect(typeof message, code).toBe('string');
      expect(message.trim(), code).not.toBe('');
      expect(known.has(message), `${code}: "${message}" non è in it.ts`).toBe(true);
    }
  });

  test('codice sconosciuto → messaggio generico; i codici noti ne hanno uno specifico', async () => {
    const { bookingErrorMessage } = await errors();
    const generic = bookingErrorMessage('codice-sconosciuto');
    expect(bookingErrorMessage('XX000')).toBe(generic);
    expect(bookingErrorMessage('')).toBe(generic);
    for (const code of SPECIFIC) expect(bookingErrorMessage(code), code).not.toBe(generic);
    // Messaggi diversi dove l'azione richiesta al cliente è diversa
    const distinct = ['blocked', 'profile_incomplete', 'too_late', 'too_many_future', 'customer_overlap', 'taken'];
    expect(new Set(distinct.map(bookingErrorMessage)).size).toBe(distinct.length);
  });
});

// ---------------------------------------------------------------------------
// Server action – CLAUDE.md – Sicurezza (requireRole + Zod), ADR 004 (disponibilità senza login)
// ---------------------------------------------------------------------------
describe('server action della prenotazione (CLAUDE.md – Sicurezza)', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const readSource = (file: string): string => {
    const path = resolve(ROOT, file);
    expect(existsSync(path), `file mancante: ${file}`).toBe(true);
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  };
  const hasUseServer = (code: string): boolean => /^\s*['"]use server['"]/.test(code);
  /** Corpo di ogni `export async function` (fino al prossimo export). */
  const exported = (code: string): Map<string, string> => {
    const starts = [...code.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
    return new Map(
      starts.map((m, i) => [m[1] ?? '', code.slice(m.index ?? 0, starts[i + 1]?.index ?? code.length)]),
    );
  };

  test('actions.ts: "use server", createBooking e cancelBooking con requireRole(["customer"]) prima del database', () => {
    const code = readSource('src/lib/booking/actions.ts');
    expect(hasUseServer(code)).toBe(true);
    const actions = exported(code);
    for (const name of ['createBooking', 'cancelBooking']) {
      const body = actions.get(name);
      expect(body, `${name} non esportata come async function`).toBeDefined();
      const roleAt = (body ?? '').search(/\brequireRole\s*\(\s*\[\s*['"]customer['"]\s*\]\s*\)/);
      const dbAt = (body ?? '').search(/\.(?:from|rpc)\s*\(|\bcreateClient\s*\(/);
      expect(roleAt, `${name}: manca requireRole(["customer"])`).toBeGreaterThanOrEqual(0);
      if (dbAt >= 0) expect(roleAt, `${name}: requireRole dopo l'accesso al database`).toBeLessThan(dbAt);
    }
    expect(actions.get('createBooking')).toMatch(/\bcreateBookingSchema\b[\s\S]*?\.safeParse\s*\(/);
    expect(actions.get('cancelBooking')).toMatch(/\bcancelBookingSchema\b[\s\S]*?\.safeParse\s*\(/);
    expect(actions.get('createBooking')).toMatch(/\.rpc\s*\(\s*['"]create_online_booking['"]/);
    expect(actions.get('cancelBooking')).toMatch(/\.rpc\s*\(\s*['"]cancel_own_booking['"]/);
  });

  test('actions.ts: niente service_role (le regole le applica il database con l\'utente della richiesta)', () => {
    const code = readSource('src/lib/booking/actions.ts');
    expect(code).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
  });

  test('availability-actions.ts: "use server", delega a getAvailableSlots / getAvailableDays, senza requireRole', () => {
    const code = readSource('src/lib/booking/availability-actions.ts');
    expect(hasUseServer(code)).toBe(true);
    const actions = exported(code);
    expect(actions.get('fetchAvailableSlots')).toMatch(/\bgetAvailableSlots\s*\(/);
    expect(actions.get('fetchAvailableDays')).toMatch(/\bgetAvailableDays\s*\(/);
    expect(code).not.toMatch(/\brequireRole\s*\(/);
    expect(code).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
  });
});
