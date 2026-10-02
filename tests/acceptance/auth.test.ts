// Test di accettazione – FETTA 2 (SPEC §11: "Auth e ruoli").
// Fatta quando: "Cliente e admin entrano e vedono aree diverse".
// Sezioni: SPEC §2 (ruoli), §5.5 (registrazione/login, telefono obbligatorio), §8 (privacy e
// sicurezza), §3.7.4 (il cliente non deduce dati altrui) + decisioni approvate per la fetta 2.
// Le regole sul database sono in supabase/tests/10_auth_profiles.test.sql, i flussi completi in
// tests/e2e/auth.spec.ts.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese (definite qui: il codice ancora non esiste)
// ---------------------------------------------------------------------------
type Role = 'customer' | 'barber' | 'admin';
type AccessInput = {
  path: string;
  /** `null` = anonimo */
  role: Role | null;
  isBlocked: boolean;
  profileComplete: boolean;
};
type AccessDecision = { type: 'allow' } | { type: 'redirect'; to: string };

type AccessModule = { decideAccess: (input: AccessInput) => AccessDecision };
type SafeNextModule = { safeNextPath: (next: string | null | undefined) => string };
type ParseResult = { success: boolean; data?: Record<string, unknown> };
type Schema = { safeParse: (input: unknown) => ParseResult };
type SchemasModule = {
  emailLoginSchema: Schema;
  staffLoginSchema: Schema;
  completeProfileSchema: Schema;
};
type CurrentUser = { id: string; role: Role; isBlocked: boolean; profileComplete: boolean };
type CurrentUserModule = {
  getCurrentUser: () => Promise<CurrentUser | null>;
  requireRole: (allowed: readonly Role[]) => Promise<CurrentUser>;
};

// Lo specifier è una variabile: così `tsc --noEmit` resta verde finché i moduli non esistono,
// mentre a runtime il test fallisce con "modulo mancante".
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const ACCESS = '@/lib/auth/access';
const SAFE_NEXT = '@/lib/auth/safe-next-path';
const SCHEMAS = '@/lib/auth/schemas';
const CURRENT_USER = '@/lib/auth/current-user';

// ---------------------------------------------------------------------------
// Lettura del repository per i controlli statici
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);

const readText = (...segments: string[]): string => {
  const path = fromRoot(...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
};

/** Tutti i file sotto una cartella (ricorsivo), come percorsi relativi alla root con `/`. */
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

/** Sorgente senza commenti, per non farsi ingannare da codice o parole citate nei commenti. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const readSource = (file: string): string => stripComments(readFileSync(fromRoot(file), 'utf8'));

const hasDirective = (code: string, directive: 'use client' | 'use server'): boolean =>
  new RegExp(`^\\s*['"]${directive}['"]`, 'm').test(code);

/** Lettore minimo di TOML: sezioni `[a.b]` e righe `chiave = valore` (stringhe, numeri, booleani). */
const parseToml = (content: string): Map<string, Map<string, string | number | boolean>> => {
  const sections = new Map<string, Map<string, string | number | boolean>>();
  let current = '';
  sections.set(current, new Map());
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = (header[1] ?? '').trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const assignment = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!assignment) continue;
    const key = assignment[1] ?? '';
    const raw = (assignment[2] ?? '').trim();
    let value: string | number | boolean;
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
    if (quoted) value = quoted[1] ?? '';
    else {
      const bare = (raw.split('#')[0] ?? '').trim();
      if (bare === 'true') value = true;
      else if (bare === 'false') value = false;
      else if (/^-?\d+$/.test(bare)) value = Number(bare);
      else value = bare;
    }
    sections.get(current)?.set(key, value);
  }
  return sections;
};

const supabaseConfig = (section: string, key: string): string | number | boolean | undefined =>
  parseToml(readText('supabase', 'config.toml')).get(section)?.get(key);

// ---------------------------------------------------------------------------
// decideAccess – matrice ruoli × aree
// ---------------------------------------------------------------------------
const anonymous = { role: null, isBlocked: false, profileComplete: false } as const;
const customer = { role: 'customer', isBlocked: false, profileComplete: true } as const;
const customerIncomplete = { role: 'customer', isBlocked: false, profileComplete: false } as const;
const customerBlocked = { role: 'customer', isBlocked: true, profileComplete: true } as const;
const barber = { role: 'barber', isBlocked: false, profileComplete: true } as const;
const barberBlocked = { role: 'barber', isBlocked: true, profileComplete: true } as const;
const admin = { role: 'admin', isBlocked: false, profileComplete: true } as const;
const adminBlocked = { role: 'admin', isBlocked: true, profileComplete: true } as const;

const ALLOW: AccessDecision = { type: 'allow' };
const redirectTo = (to: string): AccessDecision => ({ type: 'redirect', to });

/** Rotte di /admin riservate all'admin (SPEC §6.4–6.9). Il barbiere vede solo il calendario. */
const ADMIN_ONLY_PATHS = [
  '/admin/servizi',
  '/admin/barbieri',
  '/admin/chiusure',
  '/admin/clienti',
  '/admin/impostazioni',
  '/admin/statistiche',
] as const;

/** Rotte di /admin aperte a tutto lo staff. */
const STAFF_PATHS = ['/admin', '/admin/calendario'] as const;

/**
 * Pagine private del cliente (decisione fetta 2): prenotazione, "Le mie prenotazioni", profilo.
 * Richiedono il login e il profilo completo; /profilo/completa è l'unica eccezione.
 */
const CUSTOMER_PRIVATE_PATHS = [
  '/prenota',
  '/prenota/servizio',
  '/prenota/riepilogo',
  '/prenotazioni',
  '/prenotazioni/123',
  '/profilo',
  '/profilo/modifica',
] as const;

const decide = async (who: Omit<AccessInput, 'path'>, path: string): Promise<AccessDecision> => {
  const { decideAccess } = await load<AccessModule>(ACCESS);
  expect(decideAccess, 'src/lib/auth/access.ts deve esportare decideAccess').toBeTypeOf('function');
  return decideAccess({ path, ...who });
};

describe('decideAccess – funzione pura (CLAUDE.md – regole di dominio, decisioni fetta 2)', () => {
  // Decisione fetta 2: `decideAccess` è logica pura, l'I/O (cookie, query) sta fuori.
  test('restituisce un oggetto in modo sincrono, non una Promise', async () => {
    const { decideAccess } = await load<AccessModule>(ACCESS);
    const result: unknown = decideAccess({ path: '/', ...anonymous });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual(ALLOW);
  });

  // Decisione fetta 2: nessun I/O nel modulo (né Supabase né API di Next)
  test('src/lib/auth/access.ts non importa Supabase né moduli di Next', () => {
    const source = stripComments(readText('src', 'lib', 'auth', 'access.ts'));
    expect(source).not.toMatch(/from\s+['"]@supabase\//);
    expect(source).not.toMatch(/from\s+['"]next\//);
    expect(source).not.toMatch(/from\s+['"]@\/lib\/db\//);
  });

  // Aggiunta di sicurezza 1: la firma accetta solo il ruolo letto da profiles; metadati del JWT
  // passati per errore nell'input non cambiano la decisione.
  test('SPEC §2: metadati con role admin passati nell\'input non promuovono un cliente', async () => {
    const { decideAccess } = await load<AccessModule>(ACCESS);
    const forged = {
      path: '/admin',
      ...customer,
      user_metadata: { role: 'admin' },
      app_metadata: { role: 'admin' },
      userMetadata: { role: 'admin' },
      appMetadata: { role: 'admin' },
    } as AccessInput;
    expect(decideAccess(forged)).toEqual(redirectTo('/'));
  });
});

describe('decideAccess – anonimo (SPEC §2, §5.5)', () => {
  // SPEC §5.1 / §5.5: le pagine pubbliche e quelle di login sono raggiungibili senza sessione
  test.each(['/', '/accedi', '/admin/login', '/auth/confirm'])(
    'anonimo su %s → consentito',
    async (path) => {
      expect(await decide(anonymous, path)).toEqual(ALLOW);
    },
  );

  // Decisione fetta 2: "Anonimo su /admin/** → /admin/login"
  test.each([
    ...STAFF_PATHS,
    ...ADMIN_ONLY_PATHS,
    '/admin/',
    '/admin/servizi/nuovo',
    '/admin/clienti/123/modifica',
    '/admin/rotta-non-prevista',
  ])('anonimo su %s → /admin/login', async (path) => {
    expect(await decide(anonymous, path)).toEqual(redirectTo('/admin/login'));
  });

  // SPEC §5.5: il completamento del profilo richiede una sessione
  test('anonimo su /profilo/completa → /accedi', async () => {
    expect(await decide(anonymous, '/profilo/completa')).toEqual(redirectTo('/accedi'));
  });

  // Decisione fetta 2: le pagine private del cliente richiedono il login
  test.each(CUSTOMER_PRIVATE_PATHS)('anonimo su %s (pagina privata) → /accedi', async (path) => {
    expect(await decide(anonymous, path)).toEqual(redirectTo('/accedi'));
  });
});

describe('decideAccess – cliente con profilo completo (SPEC §2, §3.7.4)', () => {
  // SPEC §2: il cliente usa l'area clienti
  test('cliente su / → consentito', async () => {
    expect(await decide(customer, '/')).toEqual(ALLOW);
  });

  // Decisione fetta 2: "Cliente su /admin/** → home /" (anche la pagina di login dello staff)
  test.each([
    ...STAFF_PATHS,
    ...ADMIN_ONLY_PATHS,
    '/admin/',
    '/admin/login',
    '/admin/clienti/123/modifica',
    '/admin/rotta-non-prevista',
  ])('cliente su %s → /', async (path) => {
    expect(await decide(customer, path)).toEqual(redirectTo('/'));
  });

  // SPEC §5.5: chi ha già una sessione non resta sulla pagina di login
  test('cliente su /accedi → /', async () => {
    expect(await decide(customer, '/accedi')).toEqual(redirectTo('/'));
  });

  // SPEC §5.5: il profilo si completa una volta sola
  test('cliente con profilo completo su /profilo/completa → /', async () => {
    expect(await decide(customer, '/profilo/completa')).toEqual(redirectTo('/'));
  });

  // SPEC §5.2–5.4: con login e profilo completo le pagine private sono accessibili
  test.each(CUSTOMER_PRIVATE_PATHS)('cliente su %s (pagina privata) → consentito', async (path) => {
    expect(await decide(customer, path)).toEqual(ALLOW);
  });
});

describe('decideAccess – cliente con profilo incompleto (SPEC §5.5, §8)', () => {
  // Decisione fetta 2: "Al primo accesso il cliente deve completare il profilo su /profilo/completa"
  test('cliente incompleto su /profilo/completa → consentito', async () => {
    expect(await decide(customerIncomplete, '/profilo/completa')).toEqual(ALLOW);
  });

  // Decisione fetta 2: il profilo incompleto NON blocca le pagine pubbliche
  test('cliente incompleto su / → consentito', async () => {
    expect(await decide(customerIncomplete, '/')).toEqual(ALLOW);
  });

  // SPEC §5.5 + §8: telefono e consenso privacy vanno dati prima di prenotare e di usare
  // le pagine private
  test.each(CUSTOMER_PRIVATE_PATHS)(
    'cliente incompleto su %s (pagina privata) → /profilo/completa',
    async (path) => {
      expect(await decide(customerIncomplete, path)).toEqual(redirectTo('/profilo/completa'));
    },
  );

  // Chi ha già una sessione non resta sulla pagina di login. Con il profilo incompleto la
  // destinazione (home o completamento) non è fissata: vedi punti ambigui.
  test('cliente incompleto su /accedi → rimandato fuori dal login', async () => {
    const decision = await decide(customerIncomplete, '/accedi');
    expect(decision.type).toBe('redirect');
    expect(['/', '/profilo/completa']).toContain((decision as { to: string }).to);
  });

  // Decisione fetta 2: un cliente non entra mai in /admin, nemmeno con il profilo incompleto.
  // La destinazione può essere la home o il completamento del profilo (vedi punti ambigui).
  test.each([...STAFF_PATHS, ...ADMIN_ONLY_PATHS, '/admin/login'])(
    'cliente incompleto su %s → rimandato fuori da /admin',
    async (path) => {
      const decision = await decide(customerIncomplete, path);
      expect(decision.type).toBe('redirect');
      expect(['/', '/profilo/completa']).toContain((decision as { to: string }).to);
    },
  );
});

describe('decideAccess – cliente bloccato (decisione fetta 2, SPEC §12)', () => {
  // Decisione fetta 2: "il cliente bloccato può comunque fare login (il blocco riguarda la
  // prenotazione, fetta 5)": stesse decisioni del cliente non bloccato.
  test.each([
    '/',
    '/accedi',
    '/profilo/completa',
    '/admin',
    '/admin/login',
    '/admin/servizi',
    ...CUSTOMER_PRIVATE_PATHS,
  ])(
    'cliente bloccato su %s → come il cliente non bloccato',
    async (path) => {
      expect(await decide(customerBlocked, path)).toEqual(await decide(customer, path));
    },
  );

  test('cliente bloccato su / → consentito', async () => {
    expect(await decide(customerBlocked, '/')).toEqual(ALLOW);
  });

  test('cliente bloccato con profilo incompleto: come il cliente incompleto non bloccato', async () => {
    const who = { role: 'customer', isBlocked: true, profileComplete: false } as const;
    expect(await decide(who, '/profilo/completa')).toEqual(ALLOW);
    expect(await decide(who, '/')).toEqual(ALLOW);
    expect(await decide(who, '/profilo')).toEqual(redirectTo('/profilo/completa'));
  });
});

describe('decideAccess – barbiere (SPEC §2)', () => {
  // Decisione fetta 2: il barbiere entra in /admin e vede solo il calendario
  test.each(STAFF_PATHS)('barbiere su %s → consentito', async (path) => {
    expect(await decide(barber, path)).toEqual(ALLOW);
  });

  // Decisione fetta 2: "voci solo-admin nascoste e relative rotte protette"
  test.each([...ADMIN_ONLY_PATHS, '/admin/servizi/nuovo', '/admin/clienti/123/modifica'])(
    'barbiere su %s (solo admin) → /admin',
    async (path) => {
      expect(await decide(barber, path)).toEqual(redirectTo('/admin'));
    },
  );

  // SPEC §2 + CLAUDE.md – Sicurezza: una rotta di /admin non elencata è solo-admin per default
  test('barbiere su una rotta di /admin non prevista → /admin', async () => {
    expect(await decide(barber, '/admin/rotta-non-prevista')).toEqual(redirectTo('/admin'));
  });

  // Decisione fetta 2: "Staff dopo il login va su /admin ma può vedere le pagine pubbliche"
  test('barbiere su / → consentito', async () => {
    expect(await decide(barber, '/')).toEqual(ALLOW);
  });

  // Decisione fetta 2: lo staff già autenticato non resta sulle pagine di login
  test.each(['/admin/login', '/accedi'])('barbiere su %s → /admin', async (path) => {
    expect(await decide(barber, path)).toEqual(redirectTo('/admin'));
  });

  // Decisione fetta 2: il completamento del profilo è "solo per i clienti"
  test('barbiere senza telefono né consensi entra comunque in /admin', async () => {
    const who = { role: 'barber', isBlocked: false, profileComplete: false } as const;
    expect(await decide(who, '/admin')).toEqual(ALLOW);
    expect(await decide(who, '/')).toEqual(ALLOW);
  });

  test('barbiere su /profilo/completa → /admin', async () => {
    const who = { role: 'barber', isBlocked: false, profileComplete: false } as const;
    expect(await decide(who, '/profilo/completa')).toEqual(redirectTo('/admin'));
  });
});

describe('decideAccess – admin (SPEC §2)', () => {
  // SPEC §2: "admin – Tutto"
  test.each([
    ...STAFF_PATHS,
    ...ADMIN_ONLY_PATHS,
    '/admin/servizi/nuovo',
    '/admin/clienti/123/modifica',
    '/admin/rotta-non-prevista',
  ])('admin su %s → consentito', async (path) => {
    expect(await decide(admin, path)).toEqual(ALLOW);
  });

  test('admin su / → consentito', async () => {
    expect(await decide(admin, '/')).toEqual(ALLOW);
  });

  test.each(['/admin/login', '/accedi'])('admin su %s → /admin', async (path) => {
    expect(await decide(admin, path)).toEqual(redirectTo('/admin'));
  });

  test('admin senza telefono né consensi entra comunque in /admin', async () => {
    const who = { role: 'admin', isBlocked: false, profileComplete: false } as const;
    expect(await decide(who, '/admin')).toEqual(ALLOW);
    expect(await decide(who, '/admin/impostazioni')).toEqual(ALLOW);
  });

  test('admin su /profilo/completa → /admin', async () => {
    const who = { role: 'admin', isBlocked: false, profileComplete: false } as const;
    expect(await decide(who, '/profilo/completa')).toEqual(redirectTo('/admin'));
  });
});

describe('decideAccess – staff bloccato (decisione fetta 2)', () => {
  const blockedStaff = [
    ['barbiere bloccato', barberBlocked],
    ['admin bloccato', adminBlocked],
  ] as const;

  // Decisione fetta 2: "lo staff bloccato NON entra in /admin": viene rimandato a /admin/login,
  // dove compare il messaggio "Account disabilitato".
  describe.each(blockedStaff)('%s', (_label, who) => {
    test.each([...STAFF_PATHS, ...ADMIN_ONLY_PATHS, '/admin/', '/admin/rotta-non-prevista'])(
      'su %s → /admin/login',
      async (path) => {
        expect(await decide(who, path)).toEqual(redirectTo('/admin/login'));
      },
    );

    // Niente ciclo di redirect: la pagina di login resta raggiungibile per mostrare il messaggio
    test('su /admin/login → consentito', async () => {
      expect(await decide(who, '/admin/login')).toEqual(ALLOW);
    });

    // Le pagine pubbliche restano visibili a chiunque
    test('su / → consentito', async () => {
      expect(await decide(who, '/')).toEqual(ALLOW);
    });
  });
});

// ---------------------------------------------------------------------------
// safeNextPath – aggiunta di sicurezza 3
// ---------------------------------------------------------------------------
describe('safeNextPath – solo percorsi relativi interni (SPEC §8)', () => {
  const ORIGIN = 'http://localhost:3000';

  const safe = async (next: string | null | undefined): Promise<string> => {
    const { safeNextPath } = await load<SafeNextModule>(SAFE_NEXT);
    expect(safeNextPath, 'src/lib/auth/safe-next-path.ts deve esportare safeNextPath').toBeTypeOf(
      'function',
    );
    return safeNextPath(next);
  };

  // Percorsi interni: restano invariati
  test.each(['/', '/profilo/completa', '/admin', '/prenotazioni?tab=future', '/a/b?c=1#d'])(
    'percorso interno %s → invariato',
    async (next) => {
      expect(await safe(next)).toBe(next);
    },
  );

  // Parametro assente o vuoto → home
  test.each([[null], [undefined], [''], ['   ']])('next assente o vuoto (%j) → /', async (next) => {
    expect(await safe(next)).toBe('/');
  });

  // URL esterni o ambigui → home
  test.each([
    ['https://evil.example'],
    ['https://evil.example/profilo'],
    ['http://evil.example'],
    ['HTTPS://EVIL.EXAMPLE'],
    ['//evil.example'],
    ['///evil.example'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['\\/evil.example'],
    ['/\\/evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    ['/\r/evil.example'],
    ['\t//evil.example'],
    [' //evil.example'],
    [' https://evil.example'],
    ['https:evil.example'],
    ['https:/evil.example'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['evil.example'],
    ['accedi'],
    ['./accedi'],
    ['../admin'],
    ['@evil.example'],
    ['?next=//evil.example'],
    ['#//evil.example'],
  ])('next non interno %j → /', async (next) => {
    expect(await safe(next)).toBe('/');
  });

  // Proprietà generale: il risultato, risolto dal browser, resta sempre sulla nostra origine
  test.each([
    '/',
    '/profilo/completa',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '/.//evil.example',
    '/..//evil.example',
    '/@evil.example',
    '/:evil.example',
  ])('il risultato per %j resta sulla stessa origine', async (next) => {
    const result = await safe(next);
    expect(result.startsWith('/')).toBe(true);
    expect(result.startsWith('//')).toBe(false);
    expect(result).not.toMatch(/[\\\s]/);
    expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Schemi Zod – CLAUDE.md – Sicurezza: "Ogni server action valida l'input con Zod"
// ---------------------------------------------------------------------------
describe('emailLoginSchema – magic link cliente (SPEC §5.5)', () => {
  const parse = async (input: unknown): Promise<ParseResult> => {
    const { emailLoginSchema } = await load<SchemasModule>(SCHEMAS);
    expect(emailLoginSchema, 'schemas.ts deve esportare emailLoginSchema').toBeDefined();
    return emailLoginSchema.safeParse(input);
  };

  test('accetta un indirizzo email valido', async () => {
    const result = await parse({ email: 'cliente@demo.local' });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe('cliente@demo.local');
  });

  // Tastiere mobili: spazi ai bordi non devono far fallire il login
  test('toglie gli spazi ai bordi', async () => {
    const result = await parse({ email: '  cliente@demo.local ' });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe('cliente@demo.local');
  });

  test.each([
    ['vuota', { email: '' }],
    ['solo spazi', { email: '   ' }],
    ['senza chiocciola', { email: 'cliente.demo.local' }],
    ['senza dominio', { email: 'cliente@' }],
    ['con spazi interni', { email: 'cli ente@demo.local' }],
    ['non stringa', { email: 42 }],
    ['null', { email: null }],
    ['campo mancante', {}],
    ['più lunga di 254 caratteri', { email: `${'a'.repeat(250)}@demo.local` }],
  ])('rifiuta un\'email %s', async (_label, input) => {
    expect((await parse(input)).success).toBe(false);
  });

  // Decisione fetta 2: login cliente senza password
  test('non lascia passare campi extra (password, ruolo)', async () => {
    const result = await parse({ email: 'cliente@demo.local', password: 'x', role: 'admin' });
    if (result.success) expect(Object.keys(result.data ?? {})).toEqual(['email']);
    else expect(result.success).toBe(false);
  });
});

describe('staffLoginSchema – email e password dello staff (SPEC §2)', () => {
  const parse = async (input: unknown): Promise<ParseResult> => {
    const { staffLoginSchema } = await load<SchemasModule>(SCHEMAS);
    expect(staffLoginSchema, 'schemas.ts deve esportare staffLoginSchema').toBeDefined();
    return staffLoginSchema.safeParse(input);
  };

  // Decisione fetta 2: utenti demo con password `demo1234` (8 caratteri). La lunghezza minima
  // di 10 vale per le password nuove (config.toml), non per il login: il modulo non deve
  // rivelare la policy né rifiutare password esistenti più corte.
  test('accetta le credenziali demo (password di 8 caratteri)', async () => {
    const result = await parse({ email: 'admin@demo.local', password: 'demo1234' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ email: 'admin@demo.local', password: 'demo1234' });
  });

  // La password non va alterata (niente trim)
  test('non modifica la password', async () => {
    const result = await parse({ email: 'admin@demo.local', password: ' con spazi ' });
    expect(result.success).toBe(true);
    expect(result.data?.password).toBe(' con spazi ');
  });

  test.each([
    ['password vuota', { email: 'admin@demo.local', password: '' }],
    ['password mancante', { email: 'admin@demo.local' }],
    ['email mancante', { password: 'demo1234' }],
    ['email non valida', { email: 'admin', password: 'demo1234' }],
    ['email vuota', { email: '', password: 'demo1234' }],
    ['password non stringa', { email: 'admin@demo.local', password: 12345678 }],
    ['input nullo', null],
  ])('rifiuta: %s', async (_label, input) => {
    expect((await parse(input)).success).toBe(false);
  });

  // Aggiunta di sicurezza 1: il ruolo non arriva mai dal modulo di login
  test('non lascia passare un ruolo inviato dal client', async () => {
    const result = await parse({ email: 'admin@demo.local', password: 'demo1234', role: 'admin' });
    if (result.success) expect(result.data).not.toHaveProperty('role');
    else expect(result.success).toBe(false);
  });
});

describe('completeProfileSchema – completamento profilo cliente (SPEC §5.5, §8)', () => {
  const valid = {
    fullName: 'Giulia Verdi',
    phone: '+39 333 1000003',
    privacyConsent: true,
    marketingConsent: false,
  };

  const parse = async (input: unknown): Promise<ParseResult> => {
    const { completeProfileSchema } = await load<SchemasModule>(SCHEMAS);
    expect(completeProfileSchema, 'schemas.ts deve esportare completeProfileSchema').toBeDefined();
    return completeProfileSchema.safeParse(input);
  };

  test('accetta nome, telefono e consenso privacy', async () => {
    const result = await parse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.fullName).toBe('Giulia Verdi');
    expect(result.data?.phone).toBe('+393331000003');
    expect(result.data?.privacyConsent).toBe(true);
    expect(result.data?.marketingConsent).toBe(false);
  });

  // Decisione fetta 2: il telefono è normalizzato in E.164 (paese predefinito IT) prima del
  // salvataggio; lo schema restituisce `phone` già normalizzato.
  test.each([
    ['333 1234567', '+393331234567'],
    ['3331234567', '+393331234567'],
    ['+39 333 123 4567', '+393331234567'],
    ['+393331234567', '+393331234567'],
    ['0039 333 1234567', '+393331234567'],
    ['333-123.4567', '+393331234567'],
    ['  333 1234567  ', '+393331234567'],
    ['06 12345678', '+390612345678'],
    ['+39 06 12345678', '+390612345678'],
    ['+44 7911 123456', '+447911123456'],
  ])('normalizza il telefono %j in %s', async (phone, expected) => {
    const result = await parse({ ...valid, phone });
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe(expected);
  });

  test('il telefono restituito è sempre in formato E.164', async () => {
    for (const phone of ['333 1234567', '06 12345678', '+44 7911 123456']) {
      const result = await parse({ ...valid, phone });
      expect(result.success).toBe(true);
      expect(String(result.data?.phone)).toMatch(/^\+[1-9][0-9]{6,14}$/);
    }
  });

  // SPEC §8: "consenso marketing separato e facoltativo"
  test('il consenso marketing è facoltativo e vale false se assente', async () => {
    const { marketingConsent: _omitted, ...withoutMarketing } = valid;
    void _omitted;
    const result = await parse(withoutMarketing);
    expect(result.success).toBe(true);
    expect(result.data?.marketingConsent).toBe(false);
  });

  test('accetta il consenso marketing dato', async () => {
    const result = await parse({ ...valid, marketingConsent: true });
    expect(result.success).toBe(true);
    expect(result.data?.marketingConsent).toBe(true);
  });

  test('toglie gli spazi ai bordi del nome', async () => {
    const result = await parse({ ...valid, fullName: '  Giulia Verdi  ' });
    expect(result.success).toBe(true);
    expect(result.data?.fullName).toBe('Giulia Verdi');
  });

  // SPEC §5.5: "Il telefono è obbligatorio in profilo per essere contattabili"
  test.each([
    ['mancante', undefined],
    ['vuoto', ''],
    ['solo spazi', '   '],
    ['null', null],
    ['di sole lettere', 'non-un-numero'],
    ['troppo corto', '12'],
    ['con lettere in mezzo', '333abc1000'],
    ['troppo lungo', '+39 333 1000003 1000003 1000003 1000003'],
    ['italiano troppo corto', '333 12'],
    ['con prefisso internazionale inesistente', '+999 123456789'],
    ['solo prefisso', '+39'],
    ['non stringa', 3331234567],
  ])('rifiuta il telefono %s', async (_label, phone) => {
    expect((await parse({ ...valid, phone })).success).toBe(false);
  });

  // SPEC §8: "consenso esplicito al trattamento in registrazione"
  test.each([
    ['false', false],
    ['mancante', undefined],
    ['null', null],
    ['stringa "false"', 'false'],
    ['stringa vuota', ''],
    ['zero', 0],
  ])('rifiuta il consenso privacy %s', async (_label, privacyConsent) => {
    expect((await parse({ ...valid, privacyConsent })).success).toBe(false);
  });

  test.each([
    ['mancante', undefined],
    ['vuoto', ''],
    ['solo spazi', '   '],
    ['più lungo di 100 caratteri', 'a'.repeat(101)],
  ])('rifiuta il nome %s', async (_label, fullName) => {
    expect((await parse({ ...valid, fullName })).success).toBe(false);
  });

  // Aggiunta di sicurezza 5: i timestamp dei consensi non arrivano mai dal client; e nemmeno
  // ruolo, blocco e contatore (SPEC §2).
  test('ignora o rifiuta timestamp dei consensi e campi riservati inviati dal client', async () => {
    const result = await parse({
      ...valid,
      privacyConsentAt: '2001-01-01T00:00:00Z',
      privacy_consent_at: '2001-01-01T00:00:00Z',
      marketingConsentAt: '2001-01-01T00:00:00Z',
      marketing_consent_at: '2001-01-01T00:00:00Z',
      role: 'admin',
      isBlocked: false,
      is_blocked: false,
      noShowCount: 0,
      no_show_count: 0,
    });
    if (result.success) {
      expect(Object.keys(result.data ?? {}).sort()).toEqual(
        ['fullName', 'marketingConsent', 'phone', 'privacyConsent'].sort(),
      );
    } else {
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getCurrentUser / requireRole – aggiunta di sicurezza 1 e 2
// Il client Supabase lato server è sostituito da un finto: l'utente autenticato ha
// `role: admin` nei metadati del JWT, ma la riga di profiles dice altro.
// ---------------------------------------------------------------------------
type FakeProfile = {
  id: string;
  role: Role;
  is_blocked: boolean;
  full_name: string | null;
  phone: string | null;
  no_show_count: number;
  privacy_consent_at: string | null;
  privacy_policy_version: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
};

const fake = vi.hoisted(() => ({
  userId: null as string | null,
  profile: null as Record<string, unknown> | null,
  tables: [] as string[],
  redirects: [] as string[],
  getSessionCalls: 0,
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
    has: () => false,
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => {
  const leave = (kind: string) => (to?: string) => {
    fake.redirects.push(to ?? kind);
    throw Object.assign(new Error(`NEXT_${kind}`), { digest: `NEXT_${kind};replace;${to ?? ''};307;` });
  };
  return {
    redirect: leave('REDIRECT'),
    permanentRedirect: leave('REDIRECT'),
    notFound: leave('NOT_FOUND'),
    forbidden: leave('FORBIDDEN'),
    unauthorized: leave('UNAUTHORIZED'),
  };
});

vi.mock('@/lib/db/server', () => {
  const forgedMetadata = { role: 'admin', is_blocked: false };

  const authUser = () =>
    fake.userId === null
      ? null
      : {
          id: fake.userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'finto-admin@qa.test',
          user_metadata: forgedMetadata,
          app_metadata: forgedMetadata,
        };

  // Query builder finto: ogni metodo restituisce il builder; `single`/`maybeSingle` risolvono
  // con la riga, l'await diretto con un array.
  const builder = (): unknown => {
    const row = fake.profile;
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'single' || property === 'maybeSingle') {
            return async () => ({ data: row, error: null });
          }
          if (property === 'then') {
            return (onFulfilled: (value: unknown) => unknown) =>
              Promise.resolve({ data: row === null ? [] : [row], error: null }).then(onFulfilled);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };

  const client = {
    auth: {
      getUser: async () => {
        const user = authUser();
        return user === null
          ? { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'no session' } }
          : { data: { user }, error: null };
      },
      getClaims: async () => {
        const user = authUser();
        return user === null
          ? { data: null, error: null }
          : {
              data: {
                claims: {
                  sub: user.id,
                  aud: user.aud,
                  role: user.role,
                  email: user.email,
                  user_metadata: user.user_metadata,
                  app_metadata: user.app_metadata,
                },
              },
              error: null,
            };
      },
      getSession: async () => {
        fake.getSessionCalls += 1;
        throw new Error('getSession() non va usato lato server');
      },
    },
    from: (table: string) => {
      fake.tables.push(table);
      return builder();
    },
  };

  return { createClient: async () => client };
});

describe('getCurrentUser / requireRole – il ruolo viene solo da profiles (SPEC §2, §8)', () => {
  const USER_ID = 'c0000000-0000-4000-8000-000000002001';

  const profile = (overrides: Partial<FakeProfile> = {}): FakeProfile => ({
    id: USER_ID,
    role: 'customer',
    is_blocked: false,
    full_name: 'Finto Admin',
    phone: '+39 333 0000001',
    no_show_count: 0,
    privacy_consent_at: '2026-10-02T10:00:00+00:00',
    privacy_policy_version: '2026-10',
    marketing_consent: false,
    marketing_consent_at: null,
    ...overrides,
  });

  const signIn = (row: FakeProfile | null): void => {
    fake.userId = USER_ID;
    fake.profile = row;
  };

  const currentUserModule = async (): Promise<CurrentUserModule> => {
    const mod = await load<CurrentUserModule>(CURRENT_USER);
    expect(mod.getCurrentUser, 'current-user.ts deve esportare getCurrentUser').toBeTypeOf('function');
    expect(mod.requireRole, 'current-user.ts deve esportare requireRole').toBeTypeOf('function');
    return mod;
  };

  beforeEach(() => {
    fake.userId = null;
    fake.profile = null;
    fake.tables = [];
    fake.redirects = [];
    fake.getSessionCalls = 0;
    vi.resetModules();
  });

  // Aggiunta di sicurezza 1
  test('utente con role admin in user_metadata e app_metadata resta customer', async () => {
    signIn(profile({ role: 'customer' }));
    const { getCurrentUser } = await currentUserModule();
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(USER_ID);
    expect(user?.role).toBe('customer');
    expect(fake.tables).toContain('profiles');
  });

  // Aggiunta di sicurezza 1
  test('requireRole([admin]) respinge chi è admin solo nei metadati e lo manda alla home', async () => {
    signIn(profile({ role: 'customer' }));
    const { requireRole } = await currentUserModule();
    await expect(requireRole(['admin'])).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/']);
  });

  test('requireRole([barber, admin]) respinge chi è admin solo nei metadati', async () => {
    signIn(profile({ role: 'customer' }));
    const { requireRole } = await currentUserModule();
    await expect(requireRole(['barber', 'admin'])).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/']);
  });

  // Aggiunta di sicurezza 2
  test('non chiama mai getSession()', async () => {
    signIn(profile({ role: 'admin' }));
    const { getCurrentUser, requireRole } = await currentUserModule();
    await getCurrentUser();
    await requireRole(['admin']);
    expect(fake.getSessionCalls).toBe(0);
  });

  // SPEC §2
  test('admin in profiles: getCurrentUser e requireRole([admin]) lo riconoscono', async () => {
    signIn(profile({ role: 'admin' }));
    const { getCurrentUser, requireRole } = await currentUserModule();
    expect((await getCurrentUser())?.role).toBe('admin');
    const user = await requireRole(['admin']);
    expect(user.role).toBe('admin');
    expect(user.id).toBe(USER_ID);
    expect(fake.redirects).toEqual([]);
  });

  // SPEC §2: il barbiere è staff ma non admin
  test('barbiere: passa requireRole([barber, admin]), respinto da requireRole([admin]) verso /admin', async () => {
    signIn(profile({ role: 'barber' }));
    const { requireRole } = await currentUserModule();
    expect((await requireRole(['barber', 'admin'])).role).toBe('barber');
    expect(fake.redirects).toEqual([]);
    await expect(requireRole(['admin'])).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/admin']);
  });

  // Decisione fetta 2: "lo staff bloccato NON entra in /admin"
  test.each(['barber', 'admin'] as const)('staff bloccato (%s): requireRole lo respinge', async (role) => {
    signIn(profile({ role, is_blocked: true }));
    const { getCurrentUser, requireRole } = await currentUserModule();
    expect((await getCurrentUser())?.isBlocked).toBe(true);
    await expect(requireRole(['barber', 'admin'])).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/admin/login']);
  });

  // Decisione fetta 2: il cliente bloccato resta un utente autenticato
  test('cliente bloccato: getCurrentUser lo restituisce con isBlocked true', async () => {
    signIn(profile({ role: 'customer', is_blocked: true }));
    const { getCurrentUser, requireRole } = await currentUserModule();
    const user = await getCurrentUser();
    expect(user?.role).toBe('customer');
    expect(user?.isBlocked).toBe(true);
    expect((await requireRole(['customer'])).role).toBe('customer');
  });

  // SPEC §2
  test('anonimo: getCurrentUser restituisce null e requireRole respinge', async () => {
    const { getCurrentUser, requireRole } = await currentUserModule();
    expect(await getCurrentUser()).toBeNull();
    await expect(requireRole(['admin'])).rejects.toBeDefined();
    await expect(requireRole(['customer'])).rejects.toBeDefined();
  });

  // SPEC §2: senza riga in profiles non c'è alcun ruolo (nessun ripiego sui metadati)
  test('utente autenticato senza profilo: nessun ruolo dai metadati', async () => {
    signIn(null);
    const { getCurrentUser, requireRole } = await currentUserModule();
    const user = await getCurrentUser();
    expect(user?.role).not.toBe('admin');
    expect(user?.role).not.toBe('barber');
    await expect(requireRole(['admin'])).rejects.toBeDefined();
    await expect(requireRole(['barber', 'admin'])).rejects.toBeDefined();
  });

  // SPEC §5.5 + §8: profilo completo = nome, telefono e consenso privacy
  test.each<[string, Partial<FakeProfile>, boolean]>([
    ['nome, telefono e consenso privacy presenti', {}, true],
    ['consenso marketing dato', { marketing_consent: true, marketing_consent_at: '2026-10-02T10:00:00+00:00' }, true],
    ['telefono mancante', { phone: null }, false],
    ['telefono vuoto', { phone: '   ' }, false],
    ['nome mancante', { full_name: null }, false],
    ['nome vuoto', { full_name: '' }, false],
    ['consenso privacy mancante', { privacy_consent_at: null, privacy_policy_version: null }, false],
  ])('profileComplete del cliente con %s', async (_label, overrides, expected) => {
    signIn(profile({ role: 'customer', ...overrides }));
    const { getCurrentUser } = await currentUserModule();
    expect((await getCurrentUser())?.profileComplete).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Controlli statici sul repository
// ---------------------------------------------------------------------------
describe('File previsti dalla fetta 2 (CLAUDE.md – Struttura)', () => {
  test.each([
    'src/proxy.ts',
    'src/lib/auth/access.ts',
    'src/lib/auth/safe-next-path.ts',
    'src/lib/auth/schemas.ts',
    'src/lib/auth/current-user.ts',
    'src/lib/db/client.ts',
    'src/lib/db/server.ts',
    'src/app/auth/confirm/route.ts',
    'src/app/(customer)/accedi/page.tsx',
    'src/app/(customer)/profilo/page.tsx',
    'src/app/(customer)/profilo/completa/page.tsx',
    'src/app/admin/login/page.tsx',
    'supabase/templates/magic_link.html',
  ])('%s esiste', (file) => {
    expect(existsSync(fromRoot(file)), `file mancante: ${file}`).toBe(true);
  });

  // AGENTS.md / Next 16: il middleware si chiama proxy
  test('non esiste src/middleware.ts (in Next 16 il file è src/proxy.ts)', () => {
    expect(existsSync(fromRoot('src', 'middleware.ts'))).toBe(false);
    expect(existsSync(fromRoot('middleware.ts'))).toBe(false);
  });

  // Next 16: `proxy.ts` esporta la funzione `proxy` (o un default) e `config.matcher`
  test('src/proxy.ts esporta la funzione proxy e config con matcher', () => {
    const source = stripComments(readText('src', 'proxy.ts'));
    expect(source).toMatch(/export\s+(?:default\s+)?(?:async\s+)?function\s+proxy\b|export\s+default\b/);
    expect(source).toMatch(/export\s+const\s+config\b/);
    expect(source).toMatch(/\bmatcher\b/);
  });
});

describe('Sessione lato server – aggiunte di sicurezza 1 e 2 (SPEC §8)', () => {
  // Aggiunta di sicurezza 2: "mai getSession()" lato server
  test('nessuna occorrenza di getSession( in src/', () => {
    const offending = sourceFiles().filter((file) => /\bgetSession\s*\(/.test(readSource(file)));
    expect(offending).toEqual([]);
  });

  // Aggiunta di sicurezza 2: l'utente si verifica con getUser() o getClaims()
  test('src/lib/auth/current-user.ts usa getUser() o getClaims()', () => {
    const source = stripComments(readText('src', 'lib', 'auth', 'current-user.ts'));
    expect(source).toMatch(/\b(?:getUser|getClaims)\s*\(/);
  });

  // Aggiunta di sicurezza 2: anche il proxy verifica l'utente (direttamente o tramite un modulo)
  test('il proxy verifica l\'utente con getUser() o getClaims()', () => {
    expect(existsSync(fromRoot('src', 'proxy.ts')), 'file mancante: src/proxy.ts').toBe(true);
    const verifying = sourceFiles()
      .filter((file) => file === 'src/proxy.ts' || file.startsWith('src/lib/'))
      .filter((file) => /\b(?:getUser|getClaims)\s*\(/.test(readSource(file)));
    expect(verifying.length).toBeGreaterThan(0);
  });

  // Aggiunta di sicurezza 1: il ruolo si legge da profiles
  test('src/lib/auth/current-user.ts legge la tabella profiles', () => {
    const source = stripComments(readText('src', 'lib', 'auth', 'current-user.ts'));
    expect(source).toMatch(/from\(\s*['"]profiles['"]\s*\)/);
  });

  // Aggiunta di sicurezza 1: "mai da user_metadata/app_metadata del JWT"
  test('nessun file di src/ legge user_metadata o app_metadata', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    const offending = sourceFiles()
      .filter((file) => file !== 'src/lib/db/types.ts')
      .filter((file) =>
        /\b(?:user_metadata|app_metadata|raw_user_meta_data|raw_app_meta_data)\b/.test(readSource(file)),
      );
    expect(offending).toEqual([]);
  });
});

describe('Chiave service_role – SPEC §8: "nessuna chiave privilegiata nel codice client"', () => {
  const mentionsServiceRole = (code: string): boolean => /service_role/i.test(code);

  test('i file "use client" non citano la service_role', () => {
    const offending = sourceFiles().filter((file) => {
      const code = readSource(file);
      return hasDirective(code, 'use client') && mentionsServiceRole(code);
    });
    expect(offending).toEqual([]);
  });

  test('src/lib/db/client.ts usa solo URL e chiave pubblica', () => {
    const source = stripComments(readText('src', 'lib', 'db', 'client.ts'));
    expect(mentionsServiceRole(source)).toBe(false);
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  test('src/proxy.ts non cita la service_role', () => {
    expect(mentionsServiceRole(stripComments(readText('src', 'proxy.ts')))).toBe(false);
  });

  // CLAUDE.md – Sicurezza: "mai in codice client o variabili NEXT_PUBLIC_*"
  test('nessuna variabile NEXT_PUBLIC_* con SERVICE_ROLE in src/, .env.example e CI', () => {
    const pattern = /NEXT_PUBLIC_[A-Z0-9_]*SERVICE[A-Z0-9_]*/i;
    const offending = sourceFiles().filter((file) => pattern.test(readSource(file)));
    expect(offending).toEqual([]);
    expect(readText('.env.example')).not.toMatch(pattern);
    expect(readText('.github', 'workflows', 'ci.yml')).not.toMatch(pattern);
    expect(readText('next.config.ts')).not.toMatch(/SERVICE_ROLE/i);
  });
});

describe('auth/confirm – magic link con token_hash (SPEC §5.5, §8)', () => {
  const route = (): string => stripComments(readText('src', 'app', 'auth', 'confirm', 'route.ts'));

  // Decisione fetta 2: GET /auth/confirm?token_hash=...&type=...&next=...
  test('la route esporta GET', () => {
    expect(route()).toMatch(/export\s+(?:async\s+)?function\s+GET\b|export\s+const\s+GET\b/);
  });

  test('la route verifica il token con verifyOtp e legge token_hash e type', () => {
    const source = route();
    expect(source).toMatch(/\bverifyOtp\s*\(/);
    expect(source).toContain('token_hash');
    expect(source).toMatch(/['"]type['"]/);
  });

  // Aggiunta di sicurezza 3
  test('la route passa `next` da safeNextPath', () => {
    const source = route();
    expect(source).toMatch(/\bsafeNextPath\s*\(/);
    expect(source).toMatch(/['"]next['"]/);
  });
});

describe('Logout – aggiunta di sicurezza 6 (SPEC §8)', () => {
  const routeHandlers = (): string[] =>
    sourceFiles().filter((file) => /^src\/app\/.*\/route\.(?:ts|tsx|js)$/.test(file));

  const exportsGet = (code: string): boolean =>
    /export\s+(?:async\s+)?function\s+GET\b|export\s+const\s+GET\b|export\s*\{[^}]*\bGET\b/.test(code);

  // "Logout tramite server action / POST, mai link GET"
  test('nessun route handler che esporta GET esegue signOut', () => {
    const offending = routeHandlers().filter((file) => {
      const code = readSource(file);
      return exportsGet(code) && /\bsignOut\s*\(/.test(code);
    });
    expect(offending).toEqual([]);
  });

  test('pagine e layout non eseguono signOut durante il rendering (richiesta GET)', () => {
    const offending = sourceFiles()
      .filter((file) => /^src\/app\/.*(?:page|layout|template|default)\.(?:tsx|ts|jsx|js)$/.test(file))
      .filter((file) => {
        const code = readSource(file);
        return /\bsignOut\s*\(/.test(code) && !hasDirective(code, 'use server');
      });
    expect(offending).toEqual([]);
  });

  test('il proxy non esegue signOut', () => {
    expect(stripComments(readText('src', 'proxy.ts'))).not.toMatch(/\bsignOut\s*\(/);
  });

  test('esiste una server action ("use server") che esegue signOut', () => {
    const actions = sourceFiles().filter((file) => {
      const code = readSource(file);
      return hasDirective(code, 'use server') && /\bsignOut\s*\(/.test(code);
    });
    expect(actions.length).toBeGreaterThan(0);
  });
});

describe('supabase/config.toml – decisioni fetta 2 (SPEC §8)', () => {
  test('[auth] minimum_password_length = 10', () => {
    expect(supabaseConfig('auth', 'minimum_password_length')).toBe(10);
  });

  test('[auth.email] enable_confirmations = true', () => {
    expect(supabaseConfig('auth.email', 'enable_confirmations')).toBe(true);
  });

  test('[auth.email] secure_password_change = true', () => {
    expect(supabaseConfig('auth.email', 'secure_password_change')).toBe(true);
  });

  // Decisione fetta 2: i link nelle email usano lo stesso host del sito in sviluppo e degli e2e
  // (i cookie di sessione sono legati all'host)
  test('[auth] site_url = "http://localhost:3000"', () => {
    expect(supabaseConfig('auth', 'site_url')).toBe('http://localhost:3000');
  });

  // Decisione fetta 2: niente SMS, niente accessi anonimi
  test('[auth.sms] enable_signup = false e accessi anonimi disattivati', () => {
    expect(supabaseConfig('auth.sms', 'enable_signup')).toBe(false);
    expect(supabaseConfig('auth', 'enable_anonymous_sign_ins')).toBe(false);
  });

  // L'e2e legge il magic link da Mailpit locale
  test('[local_smtp] è attivo sulla porta 54324', () => {
    expect(supabaseConfig('local_smtp', 'enabled')).toBe(true);
    expect(supabaseConfig('local_smtp', 'port')).toBe(54324);
  });

  // Decisione fetta 2: template del magic link in supabase/templates/magic_link.html
  test('[auth.email.template.magic_link] punta a supabase/templates/magic_link.html', () => {
    const contentPath = supabaseConfig('auth.email.template.magic_link', 'content_path');
    expect(contentPath).toBeTypeOf('string');
    expect(String(contentPath).replace(/\\/g, '/')).toMatch(/(?:^|\/)templates\/magic_link\.html$/);
    const subject = supabaseConfig('auth.email.template.magic_link', 'subject');
    expect(subject).toBeTypeOf('string');
    expect(String(subject).trim()).not.toBe('');
  });

  test('il template del magic link porta a /auth/confirm con token_hash e type', () => {
    const template = readText('supabase', 'templates', 'magic_link.html');
    expect(template).toMatch(/\/auth\/confirm\?/);
    expect(template).toMatch(/token_hash=\{\{\s*\.TokenHash\s*\}\}/);
    expect(template).toMatch(/[?&](?:amp;)?type=[a-z_]+/);
  });

  // Il link deve passare dalla nostra route (verifyOtp lato server), non dall'URL di Supabase
  test('il template del magic link non usa {{ .ConfirmationURL }}', () => {
    const template = readText('supabase', 'templates', 'magic_link.html');
    expect(template).not.toMatch(/\{\{\s*\.ConfirmationURL\s*\}\}/);
  });
});

describe('CI – aggiunta di sicurezza 7: Mailpit resta attivo', () => {
  const workflowLines = (): string[] =>
    readText('.github', 'workflows', 'ci.yml')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'));

  const startCommands = (): string[] => workflowLines().filter((line) => /\bsupabase\s+start\b/.test(line));

  const excluded = (command: string): string[] => {
    const services: string[] = [];
    for (const match of command.matchAll(/(?:-x|--exclude)[=\s]+([A-Za-z0-9_,-]+)/g)) {
      services.push(...(match[1] ?? '').split(',').map((name) => name.trim().toLowerCase()));
    }
    return services.filter((name) => name !== '');
  };

  test('il workflow avvia Supabase', () => {
    expect(startCommands().length).toBeGreaterThan(0);
  });

  // L'e2e sul magic link legge l'email da Mailpit locale (http://127.0.0.1:54324)
  test('`supabase start` non esclude mailpit / inbucket', () => {
    for (const command of startCommands()) {
      const services = excluded(command);
      expect(services).not.toContain('mailpit');
      expect(services).not.toContain('inbucket');
    }
  });

  // L'e2e ha bisogno di Auth e dell'API REST
  test('`supabase start` non esclude gotrue, postgrest e kong', () => {
    for (const command of startCommands()) {
      const services = excluded(command);
      expect(services).not.toContain('gotrue');
      expect(services).not.toContain('postgrest');
      expect(services).not.toContain('kong');
    }
  });

  // Decisione fetta 2: le variabili NEXT_PUBLIC_SUPABASE_* si ricavano da `supabase status -o env`
  test('il workflow ricava le variabili da `supabase status -o env`, dopo lo start e prima degli e2e', () => {
    const workflow = workflowLines().join('\n');
    const startAt = workflow.search(/\bsupabase\s+start\b/);
    const statusAt = workflow.search(/\bsupabase\s+status\s+(?:-o|--output)[=\s]+env\b/);
    const e2eAt = workflow.search(/\bnpm run test:e2e\b/);
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(statusAt, 'manca `supabase status -o env`').toBeGreaterThan(startAt);
    expect(e2eAt).toBeGreaterThan(statusAt);
  });

  test('il workflow nomina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY', () => {
    const workflow = workflowLines().join('\n');
    expect(workflow).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(workflow).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  // ...senza scriverne i valori in chiaro nel workflow
  test('il workflow non contiene valori letterali per URL e chiavi di Supabase', () => {
    const offending = workflowLines().filter(
      (line) =>
        /NEXT_PUBLIC_SUPABASE_(?:URL|ANON_KEY)\s*[:=]\s*["']?(?:https?:\/\/|eyJ|sb_)/.test(line) ||
        /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(line) ||
        /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/.test(line),
    );
    expect(offending).toEqual([]);
  });

  test('Supabase parte prima degli e2e', () => {
    const workflow = workflowLines().join('\n');
    const startAt = workflow.search(/\bsupabase\s+start\b/);
    const e2eAt = workflow.search(/\bnpm run test:e2e\b/);
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(e2eAt).toBeGreaterThan(startAt);
  });
});

describe('Testi in italiano – SPEC §9 (src/i18n/it.ts)', () => {
  const string = async (path: string): Promise<unknown> => {
    const { it: strings } = await load<{ it: unknown }>('@/i18n/it');
    let node: unknown = strings;
    for (const key of path.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  };

  // Chiavi usate anche dagli e2e (tests/e2e/auth.spec.ts)
  test.each([
    'nav.login',
    'auth.logout',
    'auth.customerLogin.title',
    'auth.customerLogin.emailLabel',
    'auth.customerLogin.submit',
    'auth.customerLogin.linkSent',
    'auth.staffLogin.title',
    'auth.staffLogin.emailLabel',
    'auth.staffLogin.passwordLabel',
    'auth.staffLogin.submit',
    'auth.staffLogin.invalidCredentials',
    'auth.staffLogin.accountDisabled',
    'auth.completeProfile.title',
    'auth.completeProfile.fullNameLabel',
    'auth.completeProfile.phoneLabel',
    'auth.completeProfile.privacyConsentLabel',
    'auth.completeProfile.marketingConsentLabel',
    'auth.completeProfile.submit',
    'admin.nav.calendar',
    'admin.nav.services',
    'admin.nav.barbers',
    'admin.nav.closures',
    'admin.nav.customers',
    'admin.nav.settings',
    'admin.nav.stats',
  ])('it.%s è una stringa non vuota', async (path) => {
    const value = await string(path);
    expect(value, `chiave i18n mancante: it.${path}`).toBeTypeOf('string');
    expect(String(value).trim()).not.toBe('');
  });

  // Aggiunta di sicurezza 4: errore generico su /admin/login
  test('it.auth.staffLogin.invalidCredentials è "Credenziali non valide"', async () => {
    expect(await string('auth.staffLogin.invalidCredentials')).toBe('Credenziali non valide');
  });

  // Decisione fetta 2: il messaggio per lo staff bloccato è distinto dall'errore generico
  test('it.auth.staffLogin.accountDisabled è diverso da invalidCredentials', async () => {
    const disabled = await string('auth.staffLogin.accountDisabled');
    expect(disabled).toBeTypeOf('string');
    expect(disabled).not.toBe(await string('auth.staffLogin.invalidCredentials'));
  });

  // Aggiunta di sicurezza 4: il messaggio dopo l'invio non dice se l'email esiste
  test('it.auth.customerLogin.linkSent è neutro sull\'esistenza dell\'account', async () => {
    const value = await string('auth.customerLogin.linkSent');
    expect(value).toBeTypeOf('string');
    expect(String(value)).not.toMatch(/non (?:esiste|trovat|registrat|risulta)/i);
    expect(String(value)).not.toMatch(/\b(?:nuovo account|account creato|già registrat|bentornat|benvenut)/i);
  });

  // SPEC §9: le voci del menu admin sono tutte diverse (servono a distinguere i link negli e2e)
  test('le voci di it.admin.nav sono tutte diverse', async () => {
    const keys = ['calendar', 'services', 'barbers', 'closures', 'customers', 'settings', 'stats'];
    const labels = await Promise.all(keys.map((key) => string(`admin.nav.${key}`)));
    expect(labels.every((label) => typeof label === 'string')).toBe(true);
    expect(new Set(labels).size).toBe(keys.length);
  });
});
