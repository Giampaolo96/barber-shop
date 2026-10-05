// Test di accettazione – FETTA 6 (SPEC §11: "Calendario admin + prenotazioni manuali + cambi stato"),
// accesso, controlli statici sul codice e testi dell'interfaccia.
// Sezioni: SPEC §2 (il barbiere vede il proprio calendario, crea manuali per sé, segna completata /
// no-show; l'admin tutto), §6.1–6.3, §8 (nessuna chiave privilegiata), §9 (testi in it.ts),
// CLAUDE.md – Sicurezza (requireRole e Zod in ogni server action e pagina di /admin; regola 5:
// logica pura senza I/O) + decisioni approvate per la fetta 6.
//
// Interfacce attese:
//   pagine (tutte con requireRole):
//     src/app/admin/(panel)/page.tsx               /admin – calendario (?data=YYYY-MM-DD&vista=giorno|settimana&barbiere=<uuid>)
//     src/app/admin/**/calendario/nuova/page.tsx   /admin/calendario/nuova?barbiere=&data=&ora=
//     src/app/admin/**/calendario/[id]/page.tsx    /admin/calendario/<id> – dettaglio, stato, nota, modifica (admin)
//   src/lib/calendar/actions.ts ("use server"), firma (prev, formData) per le azioni dei moduli:
//     createManualBooking, updateBooking, changeBookingStatus, saveStaffNote; searchCustomers(query)
//     updateBooking: requireRole(['admin']); le altre: requireRole(['barber', 'admin']).
//   Testi in src/i18n/it.ts sotto admin.calendar (elenco in REQUIRED_KEYS).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';

type Role = 'customer' | 'barber' | 'admin';
type AccessModule = {
  decideAccess: (input: { path: string; role: Role | null; isBlocked: boolean; profileComplete: boolean }) =>
    | { type: 'allow' }
    | { type: 'redirect'; to: string };
};
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);

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

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const readSource = (file: string): string => {
  const path = fromRoot(file);
  expect(existsSync(path), `file mancante: ${file}`).toBe(true);
  return stripComments(readFileSync(path, 'utf8'));
};

/** Corpo di ogni `export async function` (fino al prossimo export). */
const exported = (code: string): Map<string, string> => {
  const starts = [...code.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
  return new Map(starts.map((m, i) => [m[1] ?? '', code.slice(m.index ?? 0, starts[i + 1]?.index ?? code.length)]));
};

const STAFF_ROLES = /\brequireRole\s*\(\s*\[\s*(?:['"]barber['"]\s*,\s*['"]admin['"]|['"]admin['"]\s*,\s*['"]barber['"])\s*,?\s*\]\s*\)/;
const ADMIN_ONLY = /\brequireRole\s*\(\s*\[\s*['"]admin['"]\s*,?\s*\]\s*\)/;
const DB_ACCESS = /\.(?:from|rpc)\s*\(|\bcreateClient\s*\(/;

// ---------------------------------------------------------------------------
// Pagine – CLAUDE.md Sicurezza ("ogni pagina di /admin chiama requireRole")
// ---------------------------------------------------------------------------
describe('pagine del calendario (SPEC §6.1–6.3)', () => {
  const page = (pattern: RegExp): string | undefined => walk('src/app/admin').find((file) => pattern.test(file));

  test.each([
    ['/admin (calendario)', /^src\/app\/admin\/(?:\([^/]+\)\/)?page\.tsx$/],
    ['/admin/calendario/nuova', /\/calendario\/nuova\/page\.tsx$/],
    ['/admin/calendario/[id]', /\/calendario\/\[id\]\/page\.tsx$/],
  ])('%s esiste e chiama requireRole per barbiere e admin', (_label, pattern) => {
    const file = page(pattern);
    expect(file, `pagina mancante: ${String(pattern)}`).toBeDefined();
    expect(readSource(file ?? '')).toMatch(STAFF_ROLES);
  });

  test('la home di /admin non è più il segnaposto', () => {
    const file = page(/^src\/app\/admin\/(?:\([^/]+\)\/)?page\.tsx$/) ?? '';
    expect(readSource(file)).not.toMatch(/\bcomingSoon\b/);
  });
});

describe('accesso alle rotte del calendario (SPEC §2)', () => {
  test.each(['/admin/calendario/nuova', '/admin/calendario/bd000000-0000-4000-8000-000000000601'])(
    '%s: barbiere e admin ammessi, cliente alla home, anonimo al login staff',
    async (path) => {
      const { decideAccess } = await load<AccessModule>('@/lib/auth/access');
      const base = { path, isBlocked: false, profileComplete: true };
      expect(decideAccess({ ...base, role: 'barber' })).toEqual({ type: 'allow' });
      expect(decideAccess({ ...base, role: 'admin' })).toEqual({ type: 'allow' });
      expect(decideAccess({ ...base, role: 'customer' })).toEqual({ type: 'redirect', to: '/' });
      expect(decideAccess({ ...base, role: null })).toEqual({ type: 'redirect', to: '/admin/login' });
    },
  );
});

// ---------------------------------------------------------------------------
// Server action – CLAUDE.md Sicurezza (requireRole + Zod), §8 (niente service role)
// ---------------------------------------------------------------------------
describe('server action del calendario (CLAUDE.md – Sicurezza)', () => {
  const FILE = 'src/lib/calendar/actions.ts';

  test('"use server" ed export delle azioni attese', () => {
    const code = readSource(FILE);
    expect(code).toMatch(/^\s*['"]use server['"]/);
    const actions = exported(code);
    for (const name of ['createManualBooking', 'updateBooking', 'changeBookingStatus', 'saveStaffNote', 'searchCustomers']) {
      expect(actions.has(name), `${name} non esportata come async function`).toBe(true);
    }
  });

  test.each([
    ['createManualBooking', STAFF_ROLES, 'manualBookingSchema'],
    ['updateBooking', ADMIN_ONLY, 'updateBookingSchema'],
    ['changeBookingStatus', STAFF_ROLES, 'bookingStatusSchema'],
    ['saveStaffNote', STAFF_ROLES, 'staffNoteSchema'],
  ] as const)('%s: requireRole prima del database e validazione Zod', (name, role, schema) => {
    const body = exported(readSource(FILE)).get(name) ?? '';
    const roleAt = body.search(role);
    expect(roleAt, `${name}: requireRole mancante o con ruoli diversi`).toBeGreaterThanOrEqual(0);
    const dbAt = body.search(DB_ACCESS);
    if (dbAt >= 0) expect(roleAt, `${name}: requireRole dopo l'accesso al database`).toBeLessThan(dbAt);
    expect(body).toMatch(new RegExp(`\\b${schema}\\b[\\s\\S]*?\\.safeParse\\s*\\(`));
  });

  test('searchCustomers: requireRole per lo staff prima della RPC search_customers', () => {
    const body = exported(readSource(FILE)).get('searchCustomers') ?? '';
    const roleAt = body.search(STAFF_ROLES);
    expect(roleAt).toBeGreaterThanOrEqual(0);
    const rpcAt = body.search(/\.rpc\s*\(\s*['"]search_customers['"]/);
    expect(rpcAt, 'searchCustomers deve usare search_customers (ADR 001)').toBeGreaterThan(roleAt);
  });

  test('SPEC §8: nessun uso della service role nel calendario (le regole le applica il database)', () => {
    const files = walk('src/lib/calendar').filter((file) => /\.(?:ts|tsx)$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of [...files, ...walk('src/app/admin').filter((f) => /\/calendario\//.test(f))]) {
      expect(readSource(file), file).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
    }
  });

  test('CLAUDE.md regola 5: griglia, transizioni, avvisi ed errori sono moduli puri (niente I/O)', () => {
    for (const name of ['grid', 'transitions', 'warnings', 'errors']) {
      const code = readSource(`src/lib/calendar/${name}.ts`);
      expect(code, name).not.toMatch(/from\s+['"](?:next\/|@\/lib\/db|@supabase\/|server-only)/);
      expect(code, name).not.toMatch(/\bfetch\s*\(|\bnew Date\(\s*\)|\bDate\.now\s*\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// Testi – SPEC §9 (tutto da src/i18n/it.ts)
// ---------------------------------------------------------------------------
const REQUIRED_KEYS = [
  'newAt',
  'cancelledCount',
  'form.barberLabel',
  'form.serviceLabel',
  'form.dateLabel',
  'form.timeLabel',
  'form.registeredOption',
  'form.guestOption',
  'form.customerSearchLabel',
  'form.guestNameLabel',
  'form.guestPhoneLabel',
  'form.staffNoteLabel',
  'form.confirmAnyway',
  'edit.title',
  'edit.durationLabel',
  'edit.priceLabel',
  'warnings.outsideHours',
  'warnings.timeOff',
  'warnings.closure',
  'warnings.past',
  'errors.barberBusy',
  'errors.customerBusy',
  'errors.notEnabled',
  'errors.forbidden',
  'status.markCompleted',
  'status.markNoShow',
  'status.cancelByCustomer',
  'status.cancelByShop',
  'status.restore',
] as const;

const text = (path: string): unknown => {
  let node: unknown = (texts as Record<string, unknown>).admin;
  for (const key of ['calendar', ...path.split('.')]) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
};

describe('testi del calendario in src/i18n/it.ts (SPEC §9)', () => {
  test.each(REQUIRED_KEYS)('it.admin.calendar.%s è un testo non vuoto', (key) => {
    const value = text(key);
    expect(typeof value === 'string' && value.trim() !== '', `chiave mancante: it.admin.calendar.${key}`).toBe(true);
  });

  test('segnaposto: newAt con {barber} e {time}, cancelledCount con {count}', () => {
    expect(String(text('newAt'))).toMatch(/\{barber\}/);
    expect(String(text('newAt'))).toMatch(/\{time\}/);
    expect(String(text('cancelledCount'))).toMatch(/\{count\}/);
  });

  test('avvisi ed errori hanno testi distinti', () => {
    const values = REQUIRED_KEYS.filter((k) => k.startsWith('warnings.') || k.startsWith('errors.')).map(text);
    expect(new Set(values).size).toBe(values.length);
  });
});
