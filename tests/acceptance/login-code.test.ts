// Test di accettazione – FETTA 8 (SPEC §11: "PWA ... + rifinitura UI"), login con codice a 6 cifre.
// Dall'app installata il link dell'email si apre nel browser e non nell'app: il cliente può
// entrare digitando il codice dell'email. Il link resta valido (flusso /auth/confirm invariato).
// Sezioni: SPEC §5.5 (login via email, telefono obbligatorio al primo accesso), §8 (sicurezza,
// rate limiting), §9 (testi in italiano), docs/adr/002-autenticazione.md (lo staff non entra con
// l'email) + decisioni approvate per la fetta 8, "Login con codice a 6 cifre".
//
// Interfacce attese:
//   src/lib/auth/schemas.ts   loginCodeSchema: { email (trim + minuscole), token (esattamente 6
//                             cifre, spazi rimossi), next? }
//   src/lib/auth/login-code.ts (server-only, usa createAdminClient e le rpc login_code_*):
//     checkLoginCode(email): Promise<{ blocked: boolean; remaining: number }>
//     registerLoginCodeFailure(email): Promise<{ blocked: boolean; remaining: number }>
//     resetLoginCode(email): Promise<void>      nuovo codice: azzera solo il contatore del codice
//     clearLoginCode(email): Promise<void>      login riuscito: azzera codice e finestra oraria
//   src/lib/auth/actions.ts ("use server"):
//     verifyLoginCode(previous: LoginCodeState, formData: FormData): Promise<LoginCodeState>
//       formData: email, token, next (facoltativo)
//       LoginCodeState = { status: 'idle' } | { status: 'invalid' }
//                      | { status: 'wrong'; remaining: number } | { status: 'blocked' }
//                      | { status: 'rateLimited' }
//       successo: clearLoginCode(email), poi redirect (come confirmEmailLink); staff: redirect('/admin/login').
//       errore di rate limit di GoTrue (status 429 o code 'over_request_rate_limit'): non conta come
//       tentativo sbagliato → { status: 'rateLimited' }.
//     requestMagicLink: chiama resetLoginCode(email normalizzata) solo se signInWithOtp non dà errore.
//   src/i18n/it.ts: it.auth.loginCode.{ label, submit, resend, changeEmail, linkStillWorks,
//                   invalid ("{remaining}"), blocked, rateLimited }
//   supabase/config.toml: [auth.email] otp_expiry = 900
//   supabase/templates/{magic_link,confirmation}.html: {{ .Token }} + link a /auth/confirm
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Specifier in una variabile: `tsc --noEmit` resta verde finché i moduli non esistono.
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (...segments: string[]): string => {
  const path = resolve(ROOT, ...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
};

// ---------------------------------------------------------------------------
// Moduli finti (le server action girano senza Next né Supabase)
// ---------------------------------------------------------------------------
const fake = vi.hoisted(() => ({
  log: [] as string[],
  check: { blocked: false, remaining: 5 } as { blocked: boolean; remaining: number },
  afterFailure: { blocked: false, remaining: 4 } as { blocked: boolean; remaining: number },
  verifyError: null as null | { message: string; code?: string; status?: number },
  signInError: null as null | { message: string; code?: string; status?: number },
  sessionResult: { status: 'signed-in', user: { id: 'u1', role: 'customer', isBlocked: false, profileComplete: true } } as
    | { status: 'signed-in'; user: { id: string; role: string; isBlocked: boolean; profileComplete: boolean } }
    | { status: 'staff' }
    | { status: 'invalid' },
  verifyArgs: [] as unknown[],
  signInArgs: [] as unknown[],
}));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'http://localhost:3000' }),
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    fake.log.push(`redirect:${url}`);
    throw new RedirectSignal(url);
  },
}));
vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({
    auth: {
      signInWithOtp: async (args: unknown) => {
        fake.log.push('signInWithOtp');
        fake.signInArgs.push(args);
        return { data: {}, error: fake.signInError };
      },
      setSession: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
  }),
}));
vi.mock('@/lib/auth/current-user', () => ({
  loadCurrentUser: async () => null,
  requireRole: async () => {
    throw new Error('requireRole non previsto nel login');
  },
}));
vi.mock('@/lib/auth/email-link', () => ({
  createEmailLinkVerifier: () => ({
    auth: {
      verifyOtp: async (args: unknown) => {
        fake.log.push('verifyOtp');
        fake.verifyArgs.push(args);
        return fake.verifyError
          ? { data: { session: null, user: null }, error: fake.verifyError }
          : { data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u1' } }, error: null };
      },
      signOut: async () => ({ error: null }),
    },
  }),
  openCustomerSession: async () => {
    fake.log.push('openCustomerSession');
    return fake.sessionResult;
  },
}));
vi.mock('@/lib/auth/login-code', () => ({
  checkLoginCode: async (email: string) => {
    fake.log.push(`check:${email}`);
    return fake.check;
  },
  registerLoginCodeFailure: async (email: string) => {
    fake.log.push(`failure:${email}`);
    return fake.afterFailure;
  },
  resetLoginCode: async (email: string) => {
    fake.log.push(`reset:${email}`);
  },
  clearLoginCode: async (email: string) => {
    fake.log.push(`clear:${email}`);
  },
}));

beforeEach(() => {
  fake.log = [];
  fake.check = { blocked: false, remaining: 5 };
  fake.afterFailure = { blocked: false, remaining: 4 };
  fake.verifyError = null;
  fake.signInError = null;
  fake.sessionResult = { status: 'signed-in', user: { id: 'u1', role: 'customer', isBlocked: false, profileComplete: true } };
  fake.verifyArgs = [];
  fake.signInArgs = [];
});

type LoginCodeState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'wrong'; remaining: number }
  | { status: 'blocked' }
  | { status: 'rateLimited' };
type Action<S> = (previous: S, formData: FormData) => Promise<S>;
type ActionsModule = {
  verifyLoginCode: Action<LoginCodeState>;
  requestMagicLink: Action<{ status: string }>;
};

const actions = (): Promise<ActionsModule> => load<ActionsModule>('@/lib/auth/actions');

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

/** Email passate a login-code.ts (la normalizzazione può avvenire anche nel database). */
const normalizedCalls = (kind: 'check' | 'failure' | 'reset' | 'clear'): string[] =>
  fake.log.filter((entry) => entry.startsWith(`${kind}:`)).map((entry) => entry.slice(kind.length + 1).trim().toLowerCase());

/** Esegue l'azione: restituisce lo stato oppure la destinazione del redirect. */
const run = async (values: Record<string, string>): Promise<LoginCodeState | { redirect: string }> => {
  const { verifyLoginCode } = await actions();
  expect(verifyLoginCode, 'src/lib/auth/actions.ts deve esportare verifyLoginCode').toBeTypeOf('function');
  try {
    return await verifyLoginCode({ status: 'idle' }, form(values));
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirect: error.url };
    throw error;
  }
};

// ---------------------------------------------------------------------------
// loginCodeSchema
// ---------------------------------------------------------------------------
type SafeParse = { success: boolean; data?: { email: string; token: string; next?: string | null } };
type SchemasModule = { loginCodeSchema: { safeParse: (input: unknown) => SafeParse } };

const parseCode = async (input: unknown): Promise<SafeParse> => {
  const { loginCodeSchema } = await load<SchemasModule>('@/lib/auth/schemas');
  expect(loginCodeSchema, 'src/lib/auth/schemas.ts deve esportare loginCodeSchema').toBeDefined();
  return loginCodeSchema.safeParse(input);
};

describe('loginCodeSchema (SPEC §5.5, CLAUDE.md – Zod su ogni input)', () => {
  test('email normalizzata (trim + minuscole) e codice di 6 cifre', async () => {
    const result = await parseCode({ email: '  Mario.Rossi@Example.COM ', token: '012345' });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe('mario.rossi@example.com');
    expect(result.data?.token).toBe('012345');
  });

  test('gli spazi incollati nel codice si tolgono', async () => {
    const result = await parseCode({ email: 'a@qa.test', token: ' 123 456 ' });
    expect(result.success).toBe(true);
    expect(result.data?.token).toBe('123456');
  });

  test.each(['12345', '1234567', '12a456', 'abcdef', '', '12345.'])('codice "%s" rifiutato', async (token) => {
    expect((await parseCode({ email: 'a@qa.test', token })).success).toBe(false);
  });

  test('email non valida rifiutata', async () => {
    expect((await parseCode({ email: 'non-una-email', token: '123456' })).success).toBe(false);
  });

  test('next facoltativo: assente va bene, presente si conserva', async () => {
    expect((await parseCode({ email: 'a@qa.test', token: '123456' })).success).toBe(true);
    const withNext = await parseCode({ email: 'a@qa.test', token: '123456', next: '/prenota' });
    expect(withNext.success).toBe(true);
    expect(withNext.data?.next).toBe('/prenota');
  });
});

// ---------------------------------------------------------------------------
// verifyLoginCode – limite dei tentativi lato server
// ---------------------------------------------------------------------------
describe('verifyLoginCode – validazione e limite dei tentativi (SPEC §8, decisioni fetta 8)', () => {
  test('codice non valido nel formato: stato invalid, nessuna verifica né conteggio', async () => {
    expect(await run({ email: 'a@qa.test', token: '12ab56' })).toEqual({ status: 'invalid' });
    expect(fake.log.filter((entry) => entry === 'verifyOtp' || entry.startsWith('failure:'))).toEqual([]);
  });

  test('verifica con il client senza cookie: verifyOtp({ email, token, type: "email" }) normalizzati', async () => {
    await run({ email: ' Mario@Example.com ', token: '123 456' });
    expect(fake.verifyArgs).toEqual([{ email: 'mario@example.com', token: '123456', type: 'email' }]);
  });

  test('il limite si controlla prima di verificare il codice', async () => {
    await run({ email: 'a@qa.test', token: '123456' });
    const checkAt = fake.log.findIndex((entry) => entry.startsWith('check:'));
    expect(checkAt, `eventi: ${fake.log.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(checkAt).toBeLessThan(fake.log.indexOf('verifyOtp'));
  });

  // Decisione: oltre il limite resta solo il link, il codice non viene nemmeno verificato
  test('email bloccata: stato blocked e verifyOtp mai chiamato (anche con il codice giusto)', async () => {
    fake.check = { blocked: true, remaining: 0 };
    expect(await run({ email: 'a@qa.test', token: '123456' })).toEqual({ status: 'blocked' });
    expect(fake.log).not.toContain('verifyOtp');
    expect(fake.log).not.toContain('openCustomerSession');
  });

  test('codice sbagliato o scaduto: errore contato, stato wrong con i tentativi rimasti', async () => {
    fake.verifyError = { message: 'Token has expired or is invalid', code: 'otp_expired' };
    fake.afterFailure = { blocked: false, remaining: 3 };
    expect(await run({ email: 'A@QA.test', token: '123456' })).toEqual({ status: 'wrong', remaining: 3 });
    expect(normalizedCalls('failure')).toEqual(['a@qa.test']);
    expect(fake.log).not.toContain('openCustomerSession');
  });

  test('errore che raggiunge il limite: stato blocked', async () => {
    fake.verifyError = { message: 'Token has expired or is invalid', code: 'otp_expired' };
    fake.afterFailure = { blocked: true, remaining: 0 };
    expect(await run({ email: 'a@qa.test', token: '123456' })).toEqual({ status: 'blocked' });
  });

  // Decisione approvata: il login riuscito azzera entrambi i contatori (codice e finestra oraria)
  test("codice giusto: clearLoginCode con l'email normalizzata, nessun errore contato", async () => {
    await run({ email: ' A@QA.test ', token: '123456' });
    expect(normalizedCalls('failure')).toEqual([]);
    expect(normalizedCalls('clear')).toEqual(['a@qa.test']);
  });

  test('codice sbagliato: nessun azzeramento dei contatori', async () => {
    fake.verifyError = { message: 'Token has expired or is invalid', code: 'otp_expired' };
    await run({ email: 'a@qa.test', token: '123456' });
    expect(normalizedCalls('clear')).toEqual([]);
    expect(normalizedCalls('reset')).toEqual([]);
  });

  // Decisione approvata: il rate limit di GoTrue non è un tentativo sbagliato
  test.each([
    ['status 429', { message: 'Request rate limit reached', status: 429 }],
    ['code over_request_rate_limit', { message: 'Request rate limit reached', code: 'over_request_rate_limit' }],
  ])('rate limit di GoTrue (%s): stato rateLimited, nessun errore contato', async (_label, error) => {
    fake.verifyError = error;
    expect(await run({ email: 'a@qa.test', token: '123456' })).toEqual({ status: 'rateLimited' });
    expect(normalizedCalls('failure')).toEqual([]);
    expect(fake.log).not.toContain('openCustomerSession');
  });
});

// ---------------------------------------------------------------------------
// verifyLoginCode – destinazioni identiche al link (SPEC §5.5, ADR 002)
// ---------------------------------------------------------------------------
describe('verifyLoginCode – destinazioni come il link email (SPEC §5.5, ADR 002)', () => {
  test('cliente con profilo completo → next', async () => {
    expect(await run({ email: 'a@qa.test', token: '123456', next: '/prenotazioni' })).toEqual({ redirect: '/prenotazioni' });
  });

  test('next esterno ignorato (safeNextPath) → /', async () => {
    expect(await run({ email: 'a@qa.test', token: '123456', next: 'https://evil.example/x' })).toEqual({ redirect: '/' });
  });

  test('primo accesso (profilo incompleto) → /profilo/completa con next', async () => {
    fake.sessionResult = { status: 'signed-in', user: { id: 'u1', role: 'customer', isBlocked: false, profileComplete: false } };
    expect(await run({ email: 'a@qa.test', token: '123456', next: '/prenota' })).toEqual({
      redirect: '/profilo/completa?next=%2Fprenota',
    });
  });

  test('staff: nessuna sessione e /admin/login', async () => {
    fake.sessionResult = { status: 'staff' };
    expect(await run({ email: 'barbiere@qa.test', token: '123456' })).toEqual({ redirect: '/admin/login' });
  });
});

// ---------------------------------------------------------------------------
// requestMagicLink – un nuovo codice azzera il contatore del codice
// ---------------------------------------------------------------------------
describe('requestMagicLink azzera il contatore dei tentativi (decisioni fetta 8)', () => {
  test('email valida: resetLoginCode con l\'email normalizzata', async () => {
    const { requestMagicLink } = await actions();
    await requestMagicLink({ status: 'idle' }, form({ email: ' Mario@Example.com ' }));
    expect(fake.log).toContain('signInWithOtp');
    expect(normalizedCalls('reset')).toEqual(['mario@example.com']);
  });

  // Decisione approvata: senza un nuovo codice inviato il contatore non si azzera
  test('signInWithOtp con errore: nessun azzeramento', async () => {
    fake.signInError = { message: 'For security purposes, you can only request this after 1 seconds.', code: 'over_email_send_rate_limit', status: 429 };
    const { requestMagicLink } = await actions();
    await requestMagicLink({ status: 'idle' }, form({ email: 'mario@example.com' }));
    expect(fake.log).toContain('signInWithOtp');
    expect(normalizedCalls('reset')).toEqual([]);
  });

  test('email non valida: nessun azzeramento', async () => {
    const { requestMagicLink } = await actions();
    await requestMagicLink({ status: 'idle' }, form({ email: 'non-una-email' }));
    expect(normalizedCalls('reset')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// src/lib/auth/login-code.ts – usa le funzioni del database
// ---------------------------------------------------------------------------
describe('src/lib/auth/login-code.ts (decisioni fetta 8)', () => {
  const source = (): string =>
    readText('src', 'lib', 'auth', 'login-code.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

  test('esporta checkLoginCode, registerLoginCodeFailure, resetLoginCode e clearLoginCode', () => {
    const code = source();
    for (const name of ['checkLoginCode', 'registerLoginCodeFailure', 'resetLoginCode', 'clearLoginCode']) {
      expect(code, name).toMatch(new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)${name}\\b`));
    }
  });

  test('chiama le quattro rpc con il client service_role', () => {
    const code = source();
    expect(code).toMatch(/\bcreateAdminClient\s*\(/);
    for (const rpc of ['login_code_check', 'login_code_register_failure', 'login_code_reset', 'login_code_clear']) {
      expect(code, rpc).toMatch(new RegExp(`\\.rpc\\(\\s*['"\`]${rpc}['"\`]`));
    }
  });
});

// ---------------------------------------------------------------------------
// Configurazione di Supabase Auth e template delle email
// ---------------------------------------------------------------------------
/** Valore di `key` nella sezione `[section]` di supabase/config.toml (lettura minima). */
const tomlValue = (section: string, key: string): string | undefined => {
  let current = '';
  for (const raw of readText('supabase', 'config.toml').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = (header[1] ?? '').trim();
      continue;
    }
    const match = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (current === section && match?.[1] === key) return (match[2] ?? '').split('#')[0]?.trim();
  }
  return undefined;
};

describe('Codice nelle email (decisioni fetta 8)', () => {
  test('[auth.email] otp_expiry = 900 (15 minuti)', () => {
    expect(tomlValue('auth.email', 'otp_expiry')).toBe('900');
  });

  test('[auth.email] otp_length = 6', () => {
    expect(tomlValue('auth.email', 'otp_length')).toBe('6');
  });

  test('[auth.email.template.confirmation] usa supabase/templates/confirmation.html', () => {
    expect(String(tomlValue('auth.email.template.confirmation', 'content_path')).replace(/\\/g, '/')).toMatch(
      /(?:^|\/)templates\/confirmation\.html"?$/,
    );
  });

  test.each(['magic_link.html', 'confirmation.html'])('%s contiene il codice {{ .Token }}', (file) => {
    expect(readText('supabase', 'templates', file)).toMatch(/\{\{\s*\.Token\s*\}\}/);
  });

  // Il link resta un'alternativa funzionante, con il flusso /auth/confirm invariato
  test.each(['magic_link.html', 'confirmation.html'])('%s conserva il link a /auth/confirm con token_hash', (file) => {
    const template = readText('supabase', 'templates', file);
    expect(template).toMatch(/\/auth\/confirm\?token_hash=\{\{\s*\.TokenHash\s*\}\}/);
    expect(template).not.toMatch(/\{\{\s*\.ConfirmationURL\s*\}\}/);
  });

  // Con otp_expiry = 900 il testo non può più dire "scade dopo un'ora"
  test.each(['magic_link.html', 'confirmation.html'])('%s indica la scadenza di 15 minuti', (file) => {
    const template = readText('supabase', 'templates', file);
    expect(template).not.toMatch(/un['’]ora|60 minuti/i);
    expect(template).toMatch(/15 minuti/);
  });
});

// ---------------------------------------------------------------------------
// Testi (SPEC §9: src/i18n/it.ts)
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

describe('Testi del login con codice (SPEC §9)', () => {
  test.each([
    'auth.loginCode.label',
    'auth.loginCode.submit',
    'auth.loginCode.resend',
    'auth.loginCode.changeEmail',
    'auth.loginCode.linkStillWorks',
    'auth.loginCode.invalid',
    'auth.loginCode.blocked',
    'auth.loginCode.rateLimited',
  ])('it.%s è una stringa non vuota', async (key) => {
    const value = await string(key);
    expect(typeof value).toBe('string');
    expect(String(value).trim()).not.toBe('');
  });

  // GoTrue non distingue codice sbagliato da scaduto: un solo messaggio, con i tentativi rimasti
  test('invalid: "Codice non valido o scaduto" con il segnaposto {remaining}', async () => {
    const value = String(await string('auth.loginCode.invalid'));
    expect(value).toMatch(/Codice non valido o scaduto/);
    expect(value).toContain('{remaining}');
  });

  test('rateLimited: "Troppe richieste, riprova tra poco"', async () => {
    expect(String(await string('auth.loginCode.rateLimited'))).toMatch(/Troppe richieste, riprova tra poco/);
  });

  test('blocked: invita a chiedere un nuovo codice', async () => {
    expect(String(await string('auth.loginCode.blocked'))).toMatch(/Troppi tentativi.*nuovo codice/);
  });

  test('resend: "Invia di nuovo"; changeEmail: "Usa un\'altra email"', async () => {
    expect(String(await string('auth.loginCode.resend'))).toMatch(/Invia di nuovo/);
    expect(String(await string('auth.loginCode.changeEmail'))).toMatch(/Usa un['’]altra email/);
  });

  test('linkStillWorks ricorda che anche il link funziona', async () => {
    expect(String(await string('auth.loginCode.linkStillWorks'))).toMatch(/link/i);
  });
});
