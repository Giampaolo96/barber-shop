// Test di accettazione – FETTA 8h "Sicurezza dati", punto 2 dell'audit del 2026-10-30 (decisioni
// approvate dall'utente il 2026-11-08). SPEC §2 (lo staff entra con email e password), §11 riga 8h
// ("una sessione staff senza password non ha privilegi"; "il recupero password porta a un nuovo
// accesso con password"), CLAUDE.md – Sicurezza (requireRole in ogni pagina, proxy come primo filtro).
//
// Interfacce attese:
//   src/lib/auth/access.ts:
//     export function isPasswordSession(claims: { amr?: unknown } | null | undefined): boolean
//       true solo se amr è un array con almeno un elemento { method: "password" }.
//     export const PASSWORD_REQUIRED_REASON = "password"   (valore di ?motivo=)
//   requireRole (src/lib/auth/current-user.ts): utente staff con claim (supabase.auth.getClaims())
//     non da password → redirect("/admin/login?motivo=password"), anche se `allowed` contiene il ruolo.
//     I clienti non sono toccati.
//   proxy (src/proxy.ts): staff con sessione non da password su /admin/** (escluso /admin/login) →
//     redirect a /admin/login?motivo=password e cookie sb-…-auth-token cancellati; su /admin/login
//     nessun redirect verso /admin.
//   /admin/login?motivo=password mostra it.auth.staffLogin.passwordRequired.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Role = 'customer' | 'barber' | 'admin';
type Amr = Array<Record<string, unknown> | null> | unknown;

// ---------------------------------------------------------------------------
// Finti: sessione (claim e profilo), navigazione, client Supabase del server e del proxy
// ---------------------------------------------------------------------------
const fake = vi.hoisted(() => ({
  userId: null as string | null,
  /** undefined = claim amr assente */
  amr: undefined as unknown,
  claimsError: false,
  profile: null as Record<string, unknown> | null,
  redirects: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
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
    useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
    usePathname: () => '/admin/login',
    useSearchParams: () => new URLSearchParams(),
  };
});

const fakeClient = vi.hoisted(() => () => {
  const builder = (): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'single' || property === 'maybeSingle') {
            return async () => ({ data: fake.profile, error: null });
          }
          if (property === 'then') {
            return (onFulfilled: (value: unknown) => unknown) =>
              Promise.resolve({ data: fake.profile === null ? [] : [fake.profile], error: null }).then(onFulfilled);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  const user = () => (fake.userId === null ? null : { id: fake.userId, aud: 'authenticated', role: 'authenticated' });
  return {
    auth: {
      getUser: async () => {
        const u = user();
        return u === null
          ? { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'no session', status: 400 } }
          : { data: { user: u }, error: null };
      },
      getClaims: async () => {
        if (fake.userId === null) return { data: null, error: null };
        if (fake.claimsError) return { data: null, error: { name: 'AuthApiError', message: 'invalid claim', status: 401 } };
        const claims: Record<string, unknown> = { sub: fake.userId, aud: 'authenticated', role: 'authenticated' };
        if (fake.amr !== undefined) claims.amr = fake.amr;
        return { data: { claims, header: {}, signature: new Uint8Array() }, error: null };
      },
      getSession: async () => {
        throw new Error('getSession() non va usato lato server');
      },
    },
    from: () => builder(),
    rpc: async () => ({ data: null, error: null }),
  };
});

vi.mock('@/lib/db/server', () => ({ createClient: async () => fakeClient() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => fakeClient(), createBrowserClient: () => fakeClient() }));
vi.mock('@/lib/db/env', () => ({ supabaseEnv: () => ({ url: 'http://127.0.0.1:54321', anonKey: 'anon-key' }) }));

const USER_ID = 'e8000000-0000-4000-8000-0000000080a1';
const PASSWORD: Amr = [{ method: 'password', timestamp: 1794000000 }];
const OTP: Amr = [{ method: 'otp', timestamp: 1794000000 }];
const RECOVERY: Amr = [{ method: 'recovery', timestamp: 1794000000 }];

const signIn = (role: Role, amr: Amr | undefined, overrides: Record<string, unknown> = {}): void => {
  fake.userId = USER_ID;
  fake.amr = amr;
  fake.profile = {
    id: USER_ID,
    role,
    is_blocked: false,
    full_name: 'Persona di prova',
    phone: '+39 333 0000080',
    privacy_consent_at: '2026-10-02T10:00:00+00:00',
    privacy_policy_version: '2026-10',
    marketing_consent: false,
    marketing_consent_at: null,
    no_show_count: 0,
    ...overrides,
  };
};

beforeEach(() => {
  fake.userId = null;
  fake.amr = undefined;
  fake.claimsError = false;
  fake.profile = null;
  fake.redirects = [];
  vi.resetModules();
});

type AccessModule = {
  isPasswordSession: (claims: { amr?: unknown } | null | undefined) => boolean;
  PASSWORD_REQUIRED_REASON: string;
};
const accessModule = async (): Promise<AccessModule> => {
  const mod = (await import('@/lib/auth/access')) as unknown as Partial<AccessModule>;
  expect(mod.isPasswordSession, 'access.ts deve esportare isPasswordSession').toBeTypeOf('function');
  return mod as AccessModule;
};

// ---------------------------------------------------------------------------
// isPasswordSession – logica pura
// ---------------------------------------------------------------------------
describe('isPasswordSession: solo un accesso con password vale come sessione dello staff (fetta 8h)', () => {
  test('PASSWORD_REQUIRED_REASON = "password"', async () => {
    const mod = (await import('@/lib/auth/access')) as unknown as Partial<AccessModule>;
    expect(mod.PASSWORD_REQUIRED_REASON).toBe('password');
  });

  test.each([
    ['password', [{ method: 'password', timestamp: 1794000000 }]],
    ['password senza timestamp', [{ method: 'password' }]],
    ['secondo fattore e password', [{ method: 'totp', timestamp: 2 }, { method: 'password', timestamp: 1 }]],
    ['elemento null prima della password', [null, { method: 'password' }]],
  ])('%s → true', async (_label, amr) => {
    const { isPasswordSession } = await accessModule();
    expect(isPasswordSession({ amr })).toBe(true);
  });

  test.each([
    ['codice email (otp)', [{ method: 'otp', timestamp: 1 }]],
    ['recupero password', [{ method: 'recovery', timestamp: 1 }]],
    ['magic link', [{ method: 'magiclink', timestamp: 1 }]],
    ['invito', [{ method: 'invite', timestamp: 1 }]],
    ['più metodi, nessuno password', [{ method: 'otp' }, { method: 'oauth' }]],
    ['array vuoto', []],
    ['elementi null', [null]],
    ['stringhe invece di oggetti', ['password']],
    ['oggetto invece di array', { method: 'password' }],
    ['stringa', 'password'],
    ['numero', 1],
    ['null', null],
    ['metodo con maiuscole', [{ method: 'Password' }]],
    ['metodo non stringa', [{ method: ['password'] }]],
  ])('%s → false', async (_label, amr) => {
    const { isPasswordSession } = await accessModule();
    expect(isPasswordSession({ amr })).toBe(false);
  });

  test('claim senza amr, null o undefined → false', async () => {
    const { isPasswordSession } = await accessModule();
    expect(isPasswordSession({})).toBe(false);
    expect(isPasswordSession(null)).toBe(false);
    expect(isPasswordSession(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireRole – lo staff senza password torna al login con motivo=password
// ---------------------------------------------------------------------------
type CurrentUserModule = { requireRole: (allowed: readonly Role[]) => Promise<{ id: string; role: Role }> };
const currentUser = async (): Promise<CurrentUserModule> =>
  (await import('@/lib/auth/current-user')) as unknown as CurrentUserModule;

describe('requireRole: privilegi staff solo con sessione da password (fetta 8h)', () => {
  test.each([
    ['admin', 'otp', ['admin'], OTP],
    ['admin', 'otp', ['barber', 'admin'], OTP],
    ['barber', 'otp', ['barber', 'admin'], OTP],
    ['admin', 'recovery', ['admin'], RECOVERY],
    ['barber', 'recovery', ['barber', 'admin'], RECOVERY],
    ['admin', 'senza amr', ['admin'], undefined],
    ['barber', 'senza amr', ['barber', 'admin'], undefined],
  ] as const)('%s con sessione %s, requireRole(%j) → /admin/login?motivo=password', async (role, _label, allowed, amr) => {
    signIn(role, amr);
    const { requireRole } = await currentUser();
    await expect(requireRole(allowed)).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/admin/login?motivo=password']);
  });

  test('admin con claim non leggibili (getClaims in errore) → /admin/login?motivo=password', async () => {
    signIn('admin', PASSWORD);
    fake.claimsError = true;
    const { requireRole } = await currentUser();
    await expect(requireRole(['admin'])).rejects.toBeDefined();
    expect(fake.redirects).toEqual(['/admin/login?motivo=password']);
  });

  test('admin con sessione da password: passa', async () => {
    signIn('admin', PASSWORD);
    const { requireRole } = await currentUser();
    const user = await requireRole(['admin']);
    expect(user.role).toBe('admin');
    expect(fake.redirects).toEqual([]);
  });

  test('barbiere con sessione da password: passa requireRole([barber, admin])', async () => {
    signIn('barber', [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 2 }]);
    const { requireRole } = await currentUser();
    expect((await requireRole(['barber', 'admin'])).role).toBe('barber');
    expect(fake.redirects).toEqual([]);
  });

  test.each([
    ['codice email', OTP],
    ['senza amr', undefined],
  ] as const)('cliente con sessione %s: requireRole([customer]) passa (nessun controllo amr)', async (_label, amr) => {
    signIn('customer', amr);
    const { requireRole } = await currentUser();
    expect((await requireRole(['customer'])).role).toBe('customer');
    expect(fake.redirects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Proxy – primo filtro: sessione staff non da password fuori da /admin, cookie tolti
// ---------------------------------------------------------------------------
const AUTH_COOKIES = ['sb-127-auth-token.0', 'sb-127-auth-token.1'];
const request = (path: string): NextRequest =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: [...AUTH_COOKIES.map((name) => `${name}=base64-qa`), 'tema=chiaro'].join('; ') },
  });
const callProxy = async (path: string): Promise<Response> => {
  const { proxy } = (await import('@/proxy')) as { proxy: (req: NextRequest) => Promise<Response> };
  return proxy(request(path));
};
const location = (response: Response): URL | null => {
  const value = response.headers.get('location');
  return value === null ? null : new URL(value, 'http://localhost:3000');
};
/** Cookie cancellati dalla risposta: valore vuoto e scadenza nel passato (o Max-Age=0). */
const deletedCookies = (response: Response): string[] =>
  response.headers
    .getSetCookie()
    .filter((line) => /^[^=]+=;|^[^=]+=(?:""|)(?:;|$)/.test(line) && /expires=thu, 01 jan 1970|max-age=0/i.test(line))
    .map((line) => line.slice(0, line.indexOf('=')));

describe('proxy: staff senza password fuori da /admin (fetta 8h)', () => {
  test.each([
    ['admin', '/admin', OTP],
    ['admin', '/admin/clienti', RECOVERY],
    ['barber', '/admin/calendario', OTP],
    ['barber', '/admin', undefined],
  ] as const)('%s su %s senza password → /admin/login?motivo=password e cookie della sessione tolti', async (role, path, amr) => {
    signIn(role, amr);
    const response = await callProxy(path);
    const to = location(response);
    expect(to?.pathname, 'redirect al login dello staff').toBe('/admin/login');
    expect(to?.searchParams.get('motivo')).toBe('password');
    expect(deletedCookies(response).sort()).toEqual(expect.arrayContaining(AUTH_COOKIES));
    expect(deletedCookies(response), 'gli altri cookie restano').not.toContain('tema');
  });

  test('admin con codice email su /admin/login: nessun rimando a /admin (niente ciclo)', async () => {
    signIn('admin', OTP);
    const response = await callProxy('/admin/login');
    expect(location(response)?.pathname ?? null).not.toBe('/admin');
  });

  test('admin con codice email su /admin/login?motivo=password: nessun rimando a /admin', async () => {
    signIn('admin', OTP);
    const { proxy } = (await import('@/proxy')) as { proxy: (req: NextRequest) => Promise<Response> };
    const response = await proxy(request('/admin/login?motivo=password'));
    expect(location(response)?.pathname ?? null).not.toBe('/admin');
  });

  test('admin con password su /admin: consentito, cookie intatti', async () => {
    signIn('admin', PASSWORD);
    const response = await callProxy('/admin');
    expect(location(response)).toBeNull();
    expect(deletedCookies(response)).toEqual([]);
  });

  test('staff bloccato con password: resta motivo=disabilitato', async () => {
    signIn('admin', PASSWORD, { is_blocked: true });
    const response = await callProxy('/admin');
    expect(location(response)?.pathname).toBe('/admin/login');
    expect(location(response)?.searchParams.get('motivo')).toBe('disabilitato');
  });

  test('cliente con codice email su /prenota: consentito (nessun controllo amr per i clienti)', async () => {
    signIn('customer', OTP);
    const response = await callProxy('/prenota');
    expect(location(response)).toBeNull();
    expect(deletedCookies(response)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// /admin/login?motivo=password – messaggio dedicato
// ---------------------------------------------------------------------------
describe('/admin/login con motivo=password (fetta 8h)', () => {
  const renderLogin = async (motivo?: string): Promise<string> => {
    const { default: StaffLoginPage } = (await import('@/app/admin/login/page')) as {
      default: (props: { searchParams: Promise<{ motivo?: string }> }) => Promise<ReactElement>;
    };
    return renderToStaticMarkup(await StaffLoginPage({ searchParams: Promise.resolve(motivo ? { motivo } : {}) }));
  };
  const passwordRequired = async (): Promise<string> => {
    const { it } = await import('@/i18n/it');
    const text = (it.auth.staffLogin as Record<string, unknown>).passwordRequired;
    expect(typeof text === 'string' && text.trim() !== '', 'manca it.auth.staffLogin.passwordRequired').toBe(true);
    return text as string;
  };

  test('motivo=password → messaggio it.auth.staffLogin.passwordRequired', async () => {
    const text = await passwordRequired();
    expect(await renderLogin('password')).toContain(text);
  });

  test('senza motivo o con motivo=disabilitato → nessun messaggio di password', async () => {
    const text = await passwordRequired();
    expect(await renderLogin()).not.toContain(text);
    const disabled = await renderLogin('disabilitato');
    expect(disabled).not.toContain(text);
    const { it } = await import('@/i18n/it');
    expect(disabled).toContain(it.auth.staffLogin.accountDisabled);
  });
});
