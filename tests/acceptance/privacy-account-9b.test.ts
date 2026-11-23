// Test di accettazione – FETTA 9b "Privacy e account del cliente" (SPEC §11 riga 9b, §3.1, §5.4, §8;
// decisioni approvate dall'utente per la fetta 9b, punti A–D).
// Logica pura e controlli leggeri: regole d'accesso con il consenso scaduto, regola "versione diversa
// dall'attuale", schema di /profilo, server action di eliminazione con client finti, testi in it.ts,
// requireRole sulle pagine nuove. Il database è in supabase/tests/31_privacy_account.test.sql, i flussi
// in tests/e2e/profile-9b.spec.ts, account-deletion.spec.ts e privacy-version.spec.ts.
//
// Interfacce attese:
//   src/lib/auth/access.ts
//     AccessInput.privacyConsentOutdated?: boolean (assente = false)
//     export const RECONSENT_PATH = "/profilo/consenso"
//     decideAccess: cliente con profilo completo e consenso scaduto → redirect RECONSENT_PATH sui
//       percorsi sotto /prenota (il parametro next lo aggiunge il proxy, come per /profilo/completa);
//       /prenotazioni, /profilo, /profilo/elimina restano aperti; /profilo/consenso senza consenso
//       scaduto → redirect "/"; /privacy è pubblica per tutti.
//   src/lib/auth/profile.ts
//     ACCESS_PROFILE_COLUMNS contiene "privacy_consent_outdated" (campo calcolato PostgREST);
//     toCurrentUser(id, row) → CurrentUser.privacyConsentOutdated (row.privacy_consent_outdated).
//   src/lib/auth/schemas.ts
//     profileUpdateSchema: fullName e phone con le regole di completeProfileSchema, marketingConsent
//       boolean; nessun campo della privacy.
//   src/lib/admin/schemas.ts
//     privacyVersionChangeSchema(current: string): schema Zod di una stringa: trim, non vuota, max 50,
//       diversa da `current` (confronto dopo il trim) con messaggio it.admin.settings.privacyVersionUnchanged.
//   src/lib/auth/account-actions.ts ("use server")
//     deleteAccount(previous: { status: "idle" | "error" }, formData: FormData)
//       requireRole(["customer"]) → rpc("delete_own_account") con il client della richiesta →
//       createAdminClient().auth.admin.deleteUser(user.id) → auth.signOut() → cookie usa e getta
//       account_deleted (httpOnly, breve) → redirect("/").
//       Errore della rpc o di deleteUser: { status: "error" }, nessun redirect, nessun signOut,
//       console.error senza email; si può ripetere.
//   Pagine: src/app/(customer)/profilo/consenso/page.tsx e profilo/elimina/page.tsx con
//     requireRole(["customer"]); src/app/(customer)/privacy/page.tsx pubblica, testo da
//     src/content/privacy-policy.tsx (non da it.ts).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).
// Aggiunta chiesta dall'utente il 2026-11-23: deleteAccount elimina solo l'utente della sessione, anche
// con un id diverso nel FormData, e il modulo importa "server-only".
// Modifica chiesta dall'utente il 2026-11-23: niente ?account=eliminato, il messaggio viaggia in un
// cookie usa e getta impostato dopo l'eliminazione riuscita (redirect a "/").

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Moduli caricati per nome (le esportazioni nuove non esistono ancora: `tsc` resta verde)
// ---------------------------------------------------------------------------
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

type Role = 'customer' | 'barber' | 'admin';
type AccessInput = {
  path: string;
  role: Role | null;
  isBlocked: boolean;
  profileComplete: boolean;
  privacyConsentOutdated?: boolean;
};
type AccessDecision = { type: 'allow' } | { type: 'redirect'; to: string };
type AccessModule = { decideAccess: (input: AccessInput) => AccessDecision; RECONSENT_PATH: string };
type ProfileModule = {
  ACCESS_PROFILE_COLUMNS: string;
  toCurrentUser: (id: string, row: Record<string, unknown>) => Record<string, unknown>;
};
type ParseResult = { success: boolean; data?: unknown; error?: { issues: Array<{ message: string }> } };
type Schema = { safeParse: (input: unknown) => ParseResult };
type AuthSchemasModule = { profileUpdateSchema: Schema };
type AdminSchemasModule = { privacyVersionChangeSchema: (current: string) => Schema };
type DeleteState = { status: string };
type AccountActionsModule = {
  deleteAccount: (previous: DeleteState, formData: FormData) => Promise<DeleteState>;
};

const ACCESS = '@/lib/auth/access';
const PROFILE = '@/lib/auth/profile';
const AUTH_SCHEMAS = '@/lib/auth/schemas';
const ADMIN_SCHEMAS = '@/lib/admin/schemas';
const ACCOUNT_ACTIONS = '@/lib/auth/account-actions';
const I18N = '@/i18n/it';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (path: string): string => {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `file mancante: ${path}`).toBe(true);
  return readFileSync(absolute, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
};

const text = async (path: string): Promise<unknown> => {
  let node: unknown = ((await load<{ it: unknown }>(I18N)) as { it: unknown }).it;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
};

// ---------------------------------------------------------------------------
// Client finti per la server action di eliminazione
// ---------------------------------------------------------------------------
const CUSTOMER_ID = 'c9b00000-0000-4000-8000-000000000001';
const CUSTOMER_EMAIL = 'cliente-9b@qa.test';

const fake = vi.hoisted(() => ({
  log: [] as string[],
  requireRoleArgs: [] as unknown[],
  denyRole: false,
  rpcError: null as null | { code: string; message: string },
  deleteUserError: null as null | { message: string; status?: number },
  cookieOptions: null as null | { httpOnly?: boolean; maxAge?: number },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: (name: string, _value: string, options?: { httpOnly?: boolean; maxAge?: number }) => {
      fake.log.push(`cookie.set:${name}`);
      fake.cookieOptions = options ?? null;
    },
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    fake.log.push(`redirect:${to}`);
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  },
}));
vi.mock('@/lib/auth/current-user', () => ({
  requireRole: async (roles: unknown) => {
    fake.requireRoleArgs.push(roles);
    if (fake.denyRole) {
      fake.log.push('redirect:/admin');
      throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin;307;' });
    }
    return {
      id: 'c9b00000-0000-4000-8000-000000000001',
      role: 'customer',
      isBlocked: false,
      profileComplete: true,
      email: 'cliente-9b@qa.test',
    };
  },
  getCurrentUser: async () => ({
    id: 'c9b00000-0000-4000-8000-000000000001',
    role: 'customer',
    isBlocked: false,
    profileComplete: true,
  }),
}));
vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      fake.log.push(`server.rpc:${name}`);
      return { data: null, error: fake.rpcError };
    },
    auth: {
      signOut: async () => {
        fake.log.push('server.signOut');
        return { error: null };
      },
      getUser: async () => ({
        data: { user: { id: 'c9b00000-0000-4000-8000-000000000001', email: 'cliente-9b@qa.test' } },
        error: null,
      }),
    },
  }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      fake.log.push(`admin.rpc:${name}`);
      return { data: null, error: null };
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          fake.log.push(`admin.deleteUser:${id}`);
          return { data: null, error: fake.deleteUserError };
        },
      },
    },
  }),
}));

beforeEach(() => {
  fake.log = [];
  fake.requireRoleArgs = [];
  fake.denyRole = false;
  fake.rpcError = null;
  fake.deleteUserError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Esito della server action: lo stato restituito oppure il redirect lanciato. */
const runDelete = async (): Promise<{ state?: DeleteState; redirect?: string }> => {
  const { deleteAccount } = await load<AccountActionsModule>(ACCOUNT_ACTIONS);
  expect(deleteAccount, 'src/lib/auth/account-actions.ts deve esportare deleteAccount').toBeTypeOf('function');
  try {
    return { state: await deleteAccount({ status: 'idle' }, new FormData()) };
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '');
    if (!digest.startsWith('NEXT_REDIRECT')) throw error;
    return { redirect: digest.split(';')[2] };
  }
};

// ---------------------------------------------------------------------------
// 1. decideAccess con il consenso scaduto (decisione A)
// ---------------------------------------------------------------------------
const ALLOW: AccessDecision = { type: 'allow' };
const redirectTo = (to: string): AccessDecision => ({ type: 'redirect', to });

const anonymous = { role: null, isBlocked: false, profileComplete: false } as const;
const outdated = { role: 'customer', isBlocked: false, profileComplete: true, privacyConsentOutdated: true } as const;
const upToDate = { role: 'customer', isBlocked: false, profileComplete: true, privacyConsentOutdated: false } as const;
const legacy = { role: 'customer', isBlocked: false, profileComplete: true } as const;
const incomplete = { role: 'customer', isBlocked: false, profileComplete: false, privacyConsentOutdated: false } as const;
const admin = { role: 'admin', isBlocked: false, profileComplete: true } as const;
const barber = { role: 'barber', isBlocked: false, profileComplete: true } as const;

const decide = async (who: Omit<AccessInput, 'path'>, path: string): Promise<AccessDecision> => {
  const { decideAccess } = await load<AccessModule>(ACCESS);
  return decideAccess({ path, ...who });
};

describe('decideAccess – consenso privacy scaduto (SPEC §11 9b, decisione A)', () => {
  test('RECONSENT_PATH è /profilo/consenso', async () => {
    const { RECONSENT_PATH } = await load<AccessModule>(ACCESS);
    expect(RECONSENT_PATH).toBe('/profilo/consenso');
  });

  // Senza il nuovo consenso il cliente non crea nuove prenotazioni
  test.each(['/prenota', '/prenota/quando', '/prenota/riepilogo', '/prenota/'])(
    'cliente con consenso scaduto su %s → /profilo/consenso',
    async (path) => {
      expect(await decide(outdated, path)).toEqual(redirectTo('/profilo/consenso'));
    },
  );

  // ...ma vede e cancella le sue prenotazioni, gestisce il profilo e può eliminarsi
  test.each(['/prenotazioni', '/prenotazioni/123', '/prenotazioni/123/confermata', '/profilo', '/profilo/elimina', '/', '/privacy'])(
    'cliente con consenso scaduto su %s → consentito',
    async (path) => {
      expect(await decide(outdated, path)).toEqual(ALLOW);
    },
  );

  test('cliente con consenso scaduto su /profilo/consenso → consentito', async () => {
    expect(await decide(outdated, '/profilo/consenso')).toEqual(ALLOW);
  });

  // Consenso valido: niente pagina del nuovo consenso; il flusso di prenotazione resta aperto
  test.each([
    ['consenso valido', upToDate],
    ['campo assente (chiamanti esistenti)', legacy],
  ] as const)('%s: /profilo/consenso → /', async (_label, who) => {
    expect(await decide(who, '/profilo/consenso')).toEqual(redirectTo('/'));
  });

  test.each([
    ['consenso valido', upToDate],
    ['campo assente (chiamanti esistenti)', legacy],
  ] as const)('%s: /prenota resta consentito', async (_label, who) => {
    expect(await decide(who, '/prenota')).toEqual(ALLOW);
    expect(await decide(who, '/prenota/quando')).toEqual(ALLOW);
  });

  test('profilo incompleto: /profilo/consenso → /profilo/completa (prima si completa il profilo)', async () => {
    expect(await decide(incomplete, '/profilo/consenso')).toEqual(redirectTo('/profilo/completa'));
  });

  test('anonimo: /profilo/consenso e /profilo/elimina → /accedi', async () => {
    expect(await decide(anonymous, '/profilo/consenso')).toEqual(redirectTo('/accedi'));
    expect(await decide(anonymous, '/profilo/elimina')).toEqual(redirectTo('/accedi'));
  });

  // Decisione B: /privacy è pubblica
  test.each([
    ['anonimo', anonymous],
    ['cliente con profilo incompleto', incomplete],
    ['cliente', upToDate],
    ['admin', admin],
    ['barbiere', barber],
  ] as const)('%s su /privacy → consentito', async (_label, who) => {
    expect(await decide(who, '/privacy')).toEqual(ALLOW);
  });

  test('lo staff non entra in /profilo/consenso né in /profilo/elimina (area clienti)', async () => {
    expect(await decide(admin, '/profilo/consenso')).toEqual(redirectTo('/admin'));
    expect(await decide(barber, '/profilo/elimina')).toEqual(redirectTo('/admin'));
  });
});

describe('profilo di accesso: campo calcolato privacy_consent_outdated (decisione A)', () => {
  const row = {
    role: 'customer',
    is_blocked: false,
    full_name: 'Mario Rossi',
    phone: '+393331234567',
    privacy_consent_at: '2026-10-01T10:00:00Z',
  };

  test('ACCESS_PROFILE_COLUMNS legge privacy_consent_outdated', async () => {
    const { ACCESS_PROFILE_COLUMNS } = await load<ProfileModule>(PROFILE);
    expect(ACCESS_PROFILE_COLUMNS.split(',').map((column) => column.trim())).toContain('privacy_consent_outdated');
  });

  test('toCurrentUser riporta il consenso scaduto senza cambiare profileComplete', async () => {
    const { toCurrentUser } = await load<ProfileModule>(PROFILE);
    expect(toCurrentUser(CUSTOMER_ID, { ...row, privacy_consent_outdated: true })).toMatchObject({
      profileComplete: true,
      privacyConsentOutdated: true,
    });
    expect(toCurrentUser(CUSTOMER_ID, { ...row, privacy_consent_outdated: false })).toMatchObject({
      profileComplete: true,
      privacyConsentOutdated: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Impostazioni: la nuova versione deve essere diversa da quella attuale (decisione A)
// ---------------------------------------------------------------------------
describe('privacyVersionChangeSchema (SPEC §3.1, decisione A)', () => {
  const schema = async (current: string): Promise<Schema> => {
    const { privacyVersionChangeSchema } = await load<AdminSchemasModule>(ADMIN_SCHEMAS);
    expect(privacyVersionChangeSchema, 'src/lib/admin/schemas.ts deve esportare privacyVersionChangeSchema').toBeTypeOf('function');
    return privacyVersionChangeSchema(current);
  };

  test('accetta una versione diversa, senza spazi ai bordi', async () => {
    const result = (await schema('2026-10')).safeParse('  2026-12  ');
    expect(result.success).toBe(true);
    expect(result.data).toBe('2026-12');
  });

  test.each([
    ['uguale', '2026-10'],
    ['uguale dopo il trim', ' 2026-10 '],
  ])('rifiuta la versione %s a quella attuale, con il messaggio di it.ts', async (_label, value) => {
    const result = (await schema('2026-10')).safeParse(value);
    expect(result.success).toBe(false);
    const message = await text('admin.settings.privacyVersionUnchanged');
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message);
  });

  test.each([
    ['vuota', ''],
    ['di soli spazi', '   '],
    ['oltre 50 caratteri', 'v'.repeat(51)],
  ])('rifiuta una versione %s', async (_label, value) => {
    expect((await schema('2026-10')).safeParse(value).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. /profilo: nome e telefono con le regole di /profilo/completa (decisione C)
// ---------------------------------------------------------------------------
describe('profileUpdateSchema (SPEC §5.4, decisione C)', () => {
  const parse = async (input: unknown): Promise<ParseResult> => {
    const { profileUpdateSchema } = await load<AuthSchemasModule>(AUTH_SCHEMAS);
    expect(profileUpdateSchema, 'src/lib/auth/schemas.ts deve esportare profileUpdateSchema').toBeDefined();
    return profileUpdateSchema.safeParse(input);
  };

  test('nome senza spazi ai bordi, telefono in E.164, marketing come scelto', async () => {
    const result = await parse({ fullName: '  Mario Rossi ', phone: '333 123 4567', marketingConsent: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ fullName: 'Mario Rossi', phone: '+393331234567', marketingConsent: true });
  });

  test('i campi della privacy non passano mai dallo schema (il consenso privacy non si tocca da /profilo)', async () => {
    const result = await parse({
      fullName: 'Mario Rossi',
      phone: '+39 333 1234567',
      marketingConsent: false,
      privacyConsent: false,
      privacy_policy_version: 'forged',
      privacy_consent_at: '2001-01-01T00:00:00Z',
      marketing_consent_at: '2001-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
    expect(Object.keys(result.data as object).sort()).toEqual(['fullName', 'marketingConsent', 'phone']);
  });

  test.each([
    ['nome vuoto', { fullName: '   ', phone: '+393331234567' }],
    ['nome oltre 100 caratteri', { fullName: 'x'.repeat(101), phone: '+393331234567' }],
    ['telefono vuoto', { fullName: 'Mario', phone: '' }],
    ['telefono non valido', { fullName: 'Mario', phone: '12' }],
    ['telefono con lettere', { fullName: 'Mario', phone: '333abc4567' }],
  ])('rifiuta: %s', async (_label, values) => {
    expect((await parse({ marketingConsent: false, ...values })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Eliminazione dell'account (decisione D)
// ---------------------------------------------------------------------------
describe('deleteAccount – server action (SPEC §8, decisione D)', () => {
  test('cliente: anonimizzazione con la sua sessione, poi utente auth eliminato, logout e home con il messaggio', async () => {
    const result = await runDelete();
    expect(fake.requireRoleArgs).toEqual([['customer']]);
    expect(result.redirect).toBe('/');
    expect(fake.log).toEqual([
      'server.rpc:delete_own_account',
      `admin.deleteUser:${CUSTOMER_ID}`,
      'server.signOut',
      'cookie.set:account_deleted',
      'redirect:/',
    ]);
    expect(fake.cookieOptions?.httpOnly).toBe(true);
    expect(fake.cookieOptions?.maxAge).toBeGreaterThan(0);
    expect(fake.cookieOptions?.maxAge).toBeLessThanOrEqual(300);
  });

  test('ruolo non ammesso (requireRole): nessuna chiamata al database', async () => {
    fake.denyRole = true;
    await runDelete();
    expect(fake.log.filter((entry) => !entry.startsWith('redirect:'))).toEqual([]);
  });

  test('errore di delete_own_account: niente eliminazione dell\'utente, niente redirect, stato di errore', async () => {
    fake.rpcError = { code: '42501', message: 'staff accounts cannot be deleted here' };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runDelete();
    expect(result.redirect).toBeUndefined();
    expect(result.state?.status).toBe('error');
    expect(fake.log).toEqual(['server.rpc:delete_own_account']);
  });

  test('errore di deleteUser: log senza email, nessun logout né redirect, poi si riprova con successo', async () => {
    fake.deleteUserError = { message: 'Database error deleting user', status: 500 };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failed = await runDelete();
    expect(failed.redirect).toBeUndefined();
    expect(failed.state?.status).toBe('error');
    expect(fake.log).not.toContain('server.signOut');
    expect(fake.log).not.toContain('cookie.set:account_deleted');
    expect(errors).toHaveBeenCalled();
    const logged = JSON.stringify(errors.mock.calls, (_key, value: unknown) =>
      value instanceof Error ? `${value.name}: ${value.message}` : value,
    );
    expect(logged).not.toContain(CUSTOMER_EMAIL);
    expect(logged).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);

    // Operazione ripetibile
    fake.deleteUserError = null;
    fake.log = [];
    const retried = await runDelete();
    expect(retried.redirect).toBe('/');
    expect(fake.log).toContain(`admin.deleteUser:${CUSTOMER_ID}`);
  });

  test("un id diverso nel FormData è ignorato: si elimina solo l'utente della sessione", async () => {
    const { deleteAccount } = await load<AccountActionsModule>(ACCOUNT_ACTIONS);
    const formData = new FormData();
    for (const name of ['id', 'userId', 'user_id', 'customerId']) formData.set(name, 'c9b00000-0000-4000-8000-0000000000ff');
    await deleteAccount({ status: 'idle' }, formData).catch(() => undefined);
    expect(fake.log.filter((entry) => entry.startsWith('admin.deleteUser:'))).toEqual([`admin.deleteUser:${CUSTOMER_ID}`]);
  });

  test('il modulo è solo lato server', () => {
    expect(source('src/lib/auth/account-actions.ts')).toMatch(/^import\s+["']server-only["'];?\s*$/m);
  });

  test('il modulo è una server action e non usa la service role per la rpc', () => {
    const code = source('src/lib/auth/account-actions.ts');
    expect(code).toMatch(/^\s*["']use server["']/);
    expect(code).toMatch(/\brequireRole\s*\(\s*\[\s*['"]customer['"]\s*,?\s*\]\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Pagine nuove: requireRole, /privacy pubblica con il testo fuori da it.ts
// ---------------------------------------------------------------------------
describe('pagine della fetta 9b (CLAUDE.md – Sicurezza, decisioni B–D)', () => {
  test.each([
    'src/app/(customer)/profilo/consenso/page.tsx',
    'src/app/(customer)/profilo/elimina/page.tsx',
    'src/app/(customer)/profilo/page.tsx',
  ])('%s chiama requireRole(["customer"])', (file) => {
    expect(source(file)).toMatch(/\brequireRole\s*\(\s*\[\s*['"]customer['"]\s*,?\s*\]\s*\)/);
  });

  test('/privacy è pubblica e prende il testo da src/content/privacy-policy.tsx', () => {
    const page = source('src/app/(customer)/privacy/page.tsx');
    expect(page).not.toMatch(/\brequireRole\b/);
    expect(page).toMatch(/from\s+['"]@\/content\/privacy-policy['"]/);
    expect(existsSync(resolve(ROOT, 'src/content/privacy-policy.tsx'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Testi in it.ts (SPEC §9)
// ---------------------------------------------------------------------------
describe('testi della fetta 9b in src/i18n/it.ts (SPEC §9)', () => {
  test.each([
    'home.accountDeleted',
    'home.privacyLink',
    'privacy.title',
    'privacy.version',
    'profile.title',
    'profile.emailLabel',
    'profile.fullNameLabel',
    'profile.phoneLabel',
    'profile.marketingLabel',
    'profile.save',
    'profile.saved',
    'profile.invalid',
    'profile.error',
    'profile.privacyAccepted',
    'profile.marketingGiven',
    'profile.marketingRevoked',
    'profile.privacyLink',
    'profile.deleteAccount',
    'profile.deletion.title',
    'profile.deletion.futureBookings',
    'profile.deletion.pastBookings',
    'profile.deletion.account',
    'profile.deletion.irreversible',
    'profile.deletion.proceed',
    'profile.deletion.confirm',
    'profile.deletion.error',
    'auth.reconsent.title',
    'auth.reconsent.intro',
    'auth.reconsent.checkboxLabel',
    'auth.reconsent.submit',
    'auth.reconsent.invalid',
    'auth.reconsent.error',
    'admin.common.deletedCustomer',
    'admin.settings.privacyVersionChangeWarning',
    'admin.settings.privacyVersionChangeConfirm',
    'admin.settings.privacyVersionUnchanged',
  ])('it.%s è un testo non vuoto', async (key) => {
    const value = await text(key);
    expect(typeof value, `chiave mancante: it.${key}`).toBe('string');
    expect(String(value).trim()).not.toBe('');
  });

  test.each([
    ['privacy.version', ['{version}']],
    ['profile.privacyAccepted', ['{version}', '{date}']],
    ['profile.marketingGiven', ['{date}']],
    ['profile.marketingRevoked', ['{date}']],
  ])('it.%s ha i segnaposto %j', async (key, placeholders) => {
    const value = String(await text(key));
    for (const placeholder of placeholders) expect(value).toContain(placeholder);
  });

  test('avviso del cambio di versione con il testo deciso dall\'utente', async () => {
    expect(await text('admin.settings.privacyVersionChangeWarning')).toBe(
      "Tutti i clienti dovranno accettare di nuovo l'informativa prima di prenotare.",
    );
  });

  test('"Cliente eliminato" per le prenotazioni anonime', async () => {
    expect(await text('admin.common.deletedCustomer')).toBe('Cliente eliminato');
  });
});
