// Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
// Accesso alle nuove rotte di /admin, uso della service_role, controlli statici sul codice e
// testi dell'interfaccia.
// Sezioni: SPEC §2 (ruoli: il barbiere "gestisce le proprie assenze", l'admin "Tutto"), §6.4–6.6,
// §6.8, §8 (nessuna chiave privilegiata nel codice client), §9 (testi in italiano), CLAUDE.md –
// Sicurezza + decisioni approvate per la fetta 3 (punti B e C).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese
// ---------------------------------------------------------------------------
type Role = 'customer' | 'barber' | 'admin';
type AccessInput = { path: string; role: Role | null; isBlocked: boolean; profileComplete: boolean };
type AccessDecision = { type: 'allow' } | { type: 'redirect'; to: string };
type AccessModule = { decideAccess: (input: AccessInput) => AccessDecision };

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const ACCESS = '@/lib/auth/access';

// ---------------------------------------------------------------------------
// Lettura del repository
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);

const readText = (...segments: string[]): string => {
  const path = fromRoot(...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
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

const sourceFiles = (): string[] =>
  walk('src').filter((file) => /\.(?:ts|tsx|js|jsx|mjs)$/.test(file) && !/\.test\.tsx?$/.test(file));

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const readSource = (file: string): string => stripComments(readFileSync(fromRoot(file), 'utf8'));

const hasDirective = (code: string, directive: 'use client' | 'use server'): boolean =>
  new RegExp(`^\\s*['"]${directive}['"]`, 'm').test(code);

/** Specifier di tutti gli import/export/require/import() di un file. */
const importSpecifiers = (code: string): string[] => {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1] ?? '');
  }
  return found;
};

/** Risolve uno specifier relativo o con alias `@/` in un percorso `src/...` senza estensione. */
const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`.replace(/\.(?:ts|tsx|js)$/, '');
  if (!specifier.startsWith('.')) return null;
  const absolute = resolve(dirname(fromRoot(fromFile)), specifier);
  return relative(ROOT, absolute).replace(/\\/g, '/').replace(/\.(?:ts|tsx|js)$/, '');
};

const ADMIN_CLIENT_MODULE = 'src/lib/db/admin';
const ADMIN_CLIENT_FILE = 'src/lib/db/admin.ts';
/** Decisione fetta 3: l'unico modulo che usa il client service_role (server action degli account staff). */
const STAFF_ACCOUNTS_FILE = 'src/lib/admin/staff-accounts.ts';
/**
 * Eccezione approvata dall'utente (fetta 8, login con codice): il contatore dei tentativi
 * (funzioni eseguibili solo dal service_role) si legge e si aggiorna da questo modulo server-only.
 * L'elenco dei file ammessi resta chiuso.
 */
const LOGIN_CODE_FILE = 'src/lib/auth/login-code.ts';

const importsAdminClient = (file: string): boolean =>
  importSpecifiers(readSource(file)).some((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return target === ADMIN_CLIENT_MODULE || target === `${ADMIN_CLIENT_MODULE}/index`;
  });

// ---------------------------------------------------------------------------
// decideAccess – nuove rotte della fetta 3 (decisione fetta 3, punto B)
// ---------------------------------------------------------------------------
const anonymous = { role: null, isBlocked: false, profileComplete: false } as const;
const customer = { role: 'customer', isBlocked: false, profileComplete: true } as const;
const barber = { role: 'barber', isBlocked: false, profileComplete: true } as const;
const barberBlocked = { role: 'barber', isBlocked: true, profileComplete: true } as const;
const admin = { role: 'admin', isBlocked: false, profileComplete: true } as const;
const adminBlocked = { role: 'admin', isBlocked: true, profileComplete: true } as const;

const ALLOW: AccessDecision = { type: 'allow' };
const redirectTo = (to: string): AccessDecision => ({ type: 'redirect', to });

const BARBER_ID = 'b0000000-0000-4000-8000-000000000002';

/** SPEC §2: "gestisce le proprie assenze" → nuova rotta dello staff. */
const OWN_TIME_OFF_PATHS = ['/admin/assenze', '/admin/assenze/', '/admin/assenze/70ff0000-0000-4000-8000-000000000001'];

/** SPEC §2 / §6.4–6.8: restano solo-admin, anche le sottopagine dei barbieri. */
const ADMIN_ONLY_PATHS = [
  '/admin/servizi',
  '/admin/servizi/nuovo',
  '/admin/barbieri',
  '/admin/barbieri/nuovo',
  `/admin/barbieri/${BARBER_ID}`,
  `/admin/barbieri/${BARBER_ID}/orari`,
  `/admin/barbieri/${BARBER_ID}/assenze`,
  '/admin/chiusure',
  '/admin/impostazioni',
];

const decide = async (who: Omit<AccessInput, 'path'>, path: string): Promise<AccessDecision> => {
  const { decideAccess } = await load<AccessModule>(ACCESS);
  return decideAccess({ path, ...who });
};

describe('decideAccess – /admin/assenze (SPEC §2: il barbiere gestisce le proprie assenze)', () => {
  test.each(OWN_TIME_OFF_PATHS)('barbiere su %s → consentito', async (path) => {
    expect(await decide(barber, path)).toEqual(ALLOW);
  });

  test.each(OWN_TIME_OFF_PATHS)('admin su %s → consentito', async (path) => {
    expect(await decide(admin, path)).toEqual(ALLOW);
  });

  test.each(OWN_TIME_OFF_PATHS)('anonimo su %s → /admin/login', async (path) => {
    expect(await decide(anonymous, path)).toEqual(redirectTo('/admin/login'));
  });

  test.each(OWN_TIME_OFF_PATHS)('cliente su %s → /', async (path) => {
    expect(await decide(customer, path)).toEqual(redirectTo('/'));
  });

  // Decisione fetta 2: lo staff bloccato non entra in /admin
  test.each([
    ['barbiere bloccato', barberBlocked],
    ['admin bloccato', adminBlocked],
  ] as const)('%s su /admin/assenze → /admin/login', async (_label, who) => {
    expect(await decide(who, '/admin/assenze')).toEqual(redirectTo('/admin/login'));
  });

  // CLAUDE.md – Sicurezza: il confronto è per segmenti di percorso, non per prefisso di stringa
  test.each(['/admin/assenze-altrui', '/admin/assenzeX', '/admin/assenze.json'])(
    'barbiere su %s (non è la rotta delle proprie assenze) → /admin',
    async (path) => {
      expect(await decide(barber, path)).toEqual(redirectTo('/admin'));
    },
  );
});

describe('decideAccess – pagine solo-admin della fetta 3 (SPEC §2, §6.4–6.8)', () => {
  test.each(ADMIN_ONLY_PATHS)('barbiere su %s → /admin', async (path) => {
    expect(await decide(barber, path)).toEqual(redirectTo('/admin'));
  });

  test.each(ADMIN_ONLY_PATHS)('admin su %s → consentito', async (path) => {
    expect(await decide(admin, path)).toEqual(ALLOW);
  });

  test.each(ADMIN_ONLY_PATHS)('anonimo su %s → /admin/login', async (path) => {
    expect(await decide(anonymous, path)).toEqual(redirectTo('/admin/login'));
  });

  // Le regole della fetta 2 restano: il barbiere vede /admin e il calendario
  test.each(['/admin', '/admin/calendario'])('barbiere su %s → consentito', async (path) => {
    expect(await decide(barber, path)).toEqual(ALLOW);
  });
});

// ---------------------------------------------------------------------------
// Service role – decisione fetta 3 (punto C), SPEC §8, CLAUDE.md – Sicurezza
// ---------------------------------------------------------------------------
describe('Client service_role in src/lib/db/admin.ts (SPEC §8, CLAUDE.md – Sicurezza)', () => {
  test('src/lib/db/admin.ts esiste e importa "server-only"', () => {
    const source = stripComments(readText('src', 'lib', 'db', 'admin.ts'));
    expect(source).toMatch(/^\s*import\s+['"]server-only['"]/m);
  });

  test('legge la chiave da SUPABASE_SERVICE_ROLE_KEY ed esporta createAdminClient', () => {
    const source = stripComments(readText('src', 'lib', 'db', 'admin.ts'));
    expect(source).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY|process\.env\[\s*['"]SUPABASE_SERVICE_ROLE_KEY['"]\s*\]/);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+createAdminClient\b|export\s+const\s+createAdminClient\b/);
  });

  test('src/lib/db/admin.ts non è un modulo client e non usa variabili NEXT_PUBLIC_ per la chiave', () => {
    const source = stripComments(readText('src', 'lib', 'db', 'admin.ts'));
    expect(hasDirective(source, 'use client')).toBe(false);
    expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE|SECRET)/);
  });

  // La sessione del client privilegiato non va mai salvata nei cookie dell'utente
  test('il client service_role non usa i cookie della richiesta', () => {
    const source = stripComments(readText('src', 'lib', 'db', 'admin.ts'));
    expect(source).not.toMatch(/from\s+['"]next\/headers['"]/);
    expect(source).not.toMatch(/\bcreateServerClient\b|\bcreateBrowserClient\b/);
  });

  // Decisione fetta 3: il service role serve solo agli account staff.
  // Fetta 8 (eccezione approvata): anche al contatore dei tentativi del login con codice.
  test(`solo ${STAFF_ACCOUNTS_FILE} e ${LOGIN_CODE_FILE} importano il client service_role`, () => {
    expect(existsSync(fromRoot(ADMIN_CLIENT_FILE)), `file mancante: ${ADMIN_CLIENT_FILE}`).toBe(true);
    const importers = sourceFiles()
      .filter((file) => file !== ADMIN_CLIENT_FILE)
      .filter((file) => importsAdminClient(file))
      .sort();
    expect(importers).toEqual([LOGIN_CODE_FILE, STAFF_ACCOUNTS_FILE].sort());
  });

  // Fetta 8: il modulo del contatore è solo lato server e non espone server action (le sue
  // funzioni, ad esempio l'azzeramento, non devono essere invocabili dal browser)
  test(`${LOGIN_CODE_FILE} importa "server-only" e non è né "use server" né "use client"`, () => {
    const source = stripComments(readText(...LOGIN_CODE_FILE.split('/')));
    expect(source).toMatch(/^\s*import\s+['"]server-only['"]/m);
    expect(hasDirective(source, 'use server')).toBe(false);
    expect(hasDirective(source, 'use client')).toBe(false);
  });

  test('nessun file "use client" importa il client service_role', () => {
    const offending = sourceFiles().filter((file) => {
      const code = readSource(file);
      return hasDirective(code, 'use client') && importsAdminClient(file);
    });
    expect(offending).toEqual([]);
  });

  test(`${STAFF_ACCOUNTS_FILE} è un modulo di server action ("use server")`, () => {
    const source = stripComments(readText(...STAFF_ACCOUNTS_FILE.split('/')));
    expect(hasDirective(source, 'use server')).toBe(true);
  });

  // SUPABASE_SERVICE_ROLE_KEY solo in moduli che non possono finire nel bundle del browser
  test('SUPABASE_SERVICE_ROLE_KEY compare solo in moduli server-only, mai in file "use client"', () => {
    const mentioning = sourceFiles().filter((file) => /SUPABASE_SERVICE_ROLE_KEY/.test(readSource(file)));
    expect(mentioning.length).toBeGreaterThan(0);
    const offending = mentioning.filter((file) => {
      const code = readSource(file);
      return hasDirective(code, 'use client') || !/^\s*import\s+['"]server-only['"]/m.test(code);
    });
    expect(offending).toEqual([]);
  });

  test('nessun riferimento alla chiave privilegiata con prefisso NEXT_PUBLIC_ in src/ e .env.example', () => {
    const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET)/;
    const offending = sourceFiles().filter((file) => pattern.test(readSource(file)));
    expect(offending).toEqual([]);
    expect(readText('.env.example')).not.toMatch(pattern);
  });

  test('.env.example documenta SUPABASE_SERVICE_ROLE_KEY senza valore', () => {
    const line = readText('.env.example')
      .split(/\r?\n/)
      .find((candidate) => candidate.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY='));
    expect(line, '.env.example deve elencare SUPABASE_SERVICE_ROLE_KEY').toBeDefined();
    expect(line?.trim()).toBe('SUPABASE_SERVICE_ROLE_KEY=');
  });

  // In CI la chiave si ricava dallo stack locale appena avviato (SERVICE_ROLE_KEY di
  // `supabase status -o env`), mai scritta nel workflow
  test('la CI esporta SUPABASE_SERVICE_ROLE_KEY da `supabase status -o env`, prima degli e2e', () => {
    const workflow = readText('.github', 'workflows', 'ci.yml')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    const statusAt = workflow.search(/\bsupabase\s+status\s+(?:-o|--output)[=\s]+env\b/);
    const exportAt = workflow.search(/SUPABASE_SERVICE_ROLE_KEY=\$\{?SERVICE_ROLE_KEY\b/);
    const e2eAt = workflow.search(/\bnpm run test:e2e\b/);
    expect(statusAt).toBeGreaterThanOrEqual(0);
    expect(exportAt, 'manca SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY nel workflow').toBeGreaterThan(statusAt);
    expect(e2eAt).toBeGreaterThan(exportAt);
    expect(workflow).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?(?:eyJ|sb_secret_)/);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md – Sicurezza: requireRole su ogni pagina di /admin e in ogni server action
// ---------------------------------------------------------------------------
describe('requireRole in pagine e server action dell\'area admin (CLAUDE.md – Sicurezza)', () => {
  const adminPages = (): string[] =>
    walk('src/app/admin').filter(
      (file) => /\/page\.(?:tsx|ts|jsx|js)$/.test(file) && !file.startsWith('src/app/admin/login/'),
    );

  // Le pagine della fetta 3 esistono (con route dedicate o con il segmento dinamico [section])
  test('esistono pagine sotto src/app/admin oltre al login', () => {
    expect(adminPages().length).toBeGreaterThan(0);
  });

  test('ogni pagina di /admin (tranne il login) chiama requireRole', () => {
    const offending = adminPages().filter((file) => !/\brequireRole\s*\(/.test(readSource(file)));
    expect(offending).toEqual([]);
  });

  test('ogni route handler sotto src/app/admin chiama requireRole', () => {
    const offending = walk('src/app/admin')
      .filter((file) => /\/route\.(?:ts|js)$/.test(file))
      .filter((file) => !/\brequireRole\s*\(/.test(readSource(file)));
    expect(offending).toEqual([]);
  });

  /** Corpo di ogni `export async function` di un file "use server" (fino al prossimo export). */
  const exportedActions = (code: string): Array<{ name: string; body: string }> => {
    const starts = [...code.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
    return starts.map((match, index) => ({
      name: match[1] ?? '',
      body: code.slice(match.index ?? 0, starts[index + 1]?.index ?? code.length),
    }));
  };

  const adminActionFiles = (): string[] =>
    sourceFiles()
      .filter((file) => file.startsWith('src/lib/admin/') || file.startsWith('src/app/admin/'))
      .filter((file) => hasDirective(readSource(file), 'use server'));

  test('esistono server action dell\'area admin', () => {
    expect(adminActionFiles()).toContain(STAFF_ACCOUNTS_FILE);
    expect(adminActionFiles().length).toBeGreaterThan(1);
  });

  // CLAUDE.md: "Ogni server action valida l'input con Zod e ricontrolla il ruolo dell'utente"
  test('ogni server action esportata chiama requireRole prima di toccare il database', () => {
    const offending: string[] = [];
    for (const file of adminActionFiles()) {
      for (const { name, body } of exportedActions(readSource(file))) {
        const roleAt = body.search(/\brequireRole\s*\(/);
        const dbAt = body.search(/\.(?:from|rpc)\s*\(|\bcreateAdminClient\s*\(|\bcreateClient\s*\(/);
        if (roleAt < 0 || (dbAt >= 0 && dbAt < roleAt)) offending.push(`${file}#${name}`);
      }
    }
    expect(offending).toEqual([]);
  });

  test('le server action dell\'area admin usano gli schemi di src/lib/admin/schemas.ts', () => {
    const files = adminActionFiles();
    expect(files.length).toBeGreaterThan(0);
    const offending = files.filter((file) => {
      const code = readSource(file);
      return !/\.(?:safeParse|parse)\s*\(/.test(code);
    });
    expect(offending).toEqual([]);
  });
});

// CLAUDE.md – Sicurezza: niente select * su barbers (grant di colonna)
describe('Query su barbers con colonne esplicite (CLAUDE.md – Sicurezza, ADR 001)', () => {
  test('nessun .from("barbers") seguito da .select() senza colonne o con "*"', () => {
    const offending: string[] = [];
    for (const file of sourceFiles().filter((candidate) => candidate !== 'src/lib/db/types.ts')) {
      const code = readSource(file);
      for (const match of code.matchAll(/\.from\(\s*['"`]barbers['"`]\s*\)/g)) {
        const chain = code.slice(match.index ?? 0).split(';')[0] ?? '';
        if (/\.select\(\s*\)|\.select\(\s*['"`]\s*\*/.test(chain)) offending.push(file);
      }
    }
    expect(offending).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Testi dell'interfaccia (SPEC §9: italiano, centralizzato in src/i18n/it.ts)
// Chiavi usate dagli e2e della fetta 3 (tests/e2e/admin-*.spec.ts)
// ---------------------------------------------------------------------------
const string = async (path: string): Promise<unknown> => {
  const { it: strings } = await load<{ it: unknown }>('@/i18n/it');
  let node: unknown = strings;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

const FETTA3_I18N_KEYS = [
  'admin.nav.timeOff',
  'admin.common.save',
  'admin.common.saved',
  'admin.common.invalid',
  'admin.common.edit',
  'admin.common.delete',
  'admin.common.moveUp',
  'admin.common.moveDown',
  'admin.common.inactive',
  'admin.services.new',
  'admin.services.nameLabel',
  'admin.services.descriptionLabel',
  'admin.services.durationLabel',
  'admin.services.priceLabel',
  'admin.services.activeLabel',
  'admin.services.deleteHasBookings',
  'admin.services.deactivatedWithBookings',
  'admin.services.deactivatedWithBookingsOne',
  'admin.barbers.new',
  'admin.barbers.displayNameLabel',
  // Fetta 8d: il campo URL della foto è sostituito dalla sezione "Ritratto"
  'admin.barbers.portraitTitle',
  'admin.barbers.portraitLabel',
  'admin.barbers.portraitUpload',
  'admin.barbers.portraitRemove',
  'admin.barbers.bioLabel',
  'admin.barbers.activeLabel',
  'admin.barbers.servicesLabel',
  'admin.barbers.hours',
  'admin.barbers.timeOff',
  'admin.barbers.deactivatedWithBookings',
  'admin.barbers.deactivatedWithBookingsOne',
  'admin.hours.weekdays.1',
  'admin.hours.weekdays.2',
  'admin.hours.weekdays.3',
  'admin.hours.weekdays.4',
  'admin.hours.weekdays.5',
  'admin.hours.weekdays.6',
  'admin.hours.weekdays.7',
  'admin.hours.addSlot',
  'admin.hours.removeSlot',
  'admin.hours.startLabel',
  'admin.hours.endLabel',
  'admin.hours.overlap',
  'admin.period.allDay',
  'admin.period.timed',
  'admin.period.fromDateLabel',
  'admin.period.toDateLabel',
  'admin.period.startLabel',
  'admin.period.endLabel',
  'admin.period.reasonLabel',
  'admin.period.overlapsBookings',
  'admin.period.overlapsBookingsOne',
  'admin.staff.title',
  'admin.staff.emailLabel',
  'admin.staff.passwordLabel',
  'admin.staff.displayNameLabel',
  'admin.staff.create',
  'admin.staff.created',
  'admin.staff.emailTaken',
  'admin.staff.block',
  'admin.staff.unblock',
  'admin.settings.nameLabel',
  'admin.settings.addressLabel',
  'admin.settings.phoneLabel',
  'admin.settings.logoUrlLabel',
  'admin.settings.timezoneLabel',
  'admin.settings.slotGranularityLabel',
  'admin.settings.minAdvanceLabel',
  'admin.settings.maxHorizonLabel',
  'admin.settings.cancelLimitLabel',
  'admin.settings.bufferLabel',
  'admin.settings.noShowThresholdLabel',
  'admin.settings.privacyPolicyVersionLabel',
] as const;

describe('Testi della fetta 3 – SPEC §9 (src/i18n/it.ts)', () => {
  test.each(FETTA3_I18N_KEYS)('it.%s è una stringa non vuota', async (path) => {
    const value = await string(path);
    expect(value, `chiave i18n mancante: it.${path}`).toBeTypeOf('string');
    expect(String(value).trim()).not.toBe('');
  });

  // Decisione fetta 3: avvisi con il numero di prenotazioni coinvolte (segnaposto {count})
  test.each([
    'admin.services.deactivatedWithBookings',
    'admin.services.deactivatedWithBookingsOne',
    'admin.barbers.deactivatedWithBookings',
    'admin.barbers.deactivatedWithBookingsOne',
    'admin.period.overlapsBookings',
    'admin.period.overlapsBookingsOne',
  ])('it.%s contiene il segnaposto {count}', async (path) => {
    expect(String(await string(path))).toContain('{count}');
  });

  // Decisione fetta 3 (utente, dopo la review): "1 prenotazione", "N prenotazioni"
  test.each([
    'admin.services.deactivatedWithBookings',
    'admin.barbers.deactivatedWithBookings',
    'admin.period.overlapsBookings',
  ])('it.%s ha la forma plurale, la variante One quella singolare', async (path) => {
    const other = String(await string(path)).split('{count}').join('3');
    const one = String(await string(`${path}One`)).split('{count}').join('1');
    expect(other).toMatch(/\b3 prenotazioni\b/);
    expect(one).toMatch(/\b1 prenotazione\b/);
    expect(one).not.toMatch(/prenotazioni/);
  });

  // SPEC §3.2 / ADR 001: servizi con prenotazioni "si disattivano, non si eliminano"
  test('it.admin.services.deleteHasBookings suggerisce di disattivare il servizio', async () => {
    expect(String(await string('admin.services.deleteHasBookings'))).toMatch(/disattiv/i);
  });

  // Decisione fetta 3: email già registrata → messaggio chiaro, distinto dall'errore generico
  test('it.admin.staff.emailTaken è diverso da it.admin.common.invalid', async () => {
    expect(await string('admin.staff.emailTaken')).not.toBe(await string('admin.common.invalid'));
  });

  // Gli e2e distinguono le voci del menu con exact: true
  test('it.admin.nav.timeOff è diversa dalle altre voci del menu', async () => {
    const others = ['calendar', 'services', 'barbers', 'closures', 'customers', 'settings', 'stats'];
    const labels = await Promise.all(others.map((key) => string(`admin.nav.${key}`)));
    expect(labels).not.toContain(await string('admin.nav.timeOff'));
  });

  // Etichette dei campi che compaiono nella stessa pagina: devono essere distinte
  test.each([
    [
      'scheda del barbiere con account staff',
      [
        'admin.barbers.displayNameLabel',
        'admin.barbers.portraitLabel',
        'admin.barbers.portraitUpload',
        'admin.barbers.portraitRemove',
        'admin.barbers.bioLabel',
        'admin.barbers.activeLabel',
        'admin.staff.emailLabel',
        'admin.staff.passwordLabel',
        'admin.staff.displayNameLabel',
      ],
    ],
    [
      'modulo dei periodi',
      [
        'admin.period.fromDateLabel',
        'admin.period.toDateLabel',
        'admin.period.startLabel',
        'admin.period.endLabel',
        'admin.period.reasonLabel',
      ],
    ],
    ['fasce orarie', ['admin.hours.startLabel', 'admin.hours.endLabel']],
    ['spostamento', ['admin.common.moveUp', 'admin.common.moveDown', 'admin.common.edit', 'admin.common.delete']],
    ['account', ['admin.staff.block', 'admin.staff.unblock', 'admin.staff.create']],
    [
      'servizi',
      [
        'admin.services.nameLabel',
        'admin.services.descriptionLabel',
        'admin.services.durationLabel',
        'admin.services.priceLabel',
        'admin.services.activeLabel',
      ],
    ],
    [
      'impostazioni',
      [
        'admin.settings.nameLabel',
        'admin.settings.addressLabel',
        'admin.settings.phoneLabel',
        'admin.settings.logoUrlLabel',
        'admin.settings.timezoneLabel',
        'admin.settings.slotGranularityLabel',
        'admin.settings.minAdvanceLabel',
        'admin.settings.maxHorizonLabel',
        'admin.settings.cancelLimitLabel',
        'admin.settings.bufferLabel',
        'admin.settings.noShowThresholdLabel',
        'admin.settings.privacyPolicyVersionLabel',
      ],
    ],
  ])('etichette distinte: %s', async (_label, keys) => {
    const values = await Promise.all(keys.map((key) => string(key)));
    expect(values.every((value) => typeof value === 'string')).toBe(true);
    expect(new Set(values).size).toBe(keys.length);
  });

  test('i giorni della settimana sono 7 nomi diversi, dal lunedì (1) alla domenica (7)', async () => {
    const days = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((day) => string(`admin.hours.weekdays.${day}`)));
    expect(new Set(days).size).toBe(7);
    expect(String(days[0])).toMatch(/^luned/i);
    expect(String(days[6])).toMatch(/^domenic/i);
  });
});
