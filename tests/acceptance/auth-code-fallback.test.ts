// Test di accettazione – ripiego del login con il template email predefinito di Supabase
// (modifica all'autenticazione fuori dal piano di §11).
// Sezioni: SPEC §5.5 (login con magic link), §8 (sicurezza), docs/adr/002-autenticazione.md
// + decisioni approvate dall'utente:
//  1. GET /auth/callback scambia `code` con exchangeCodeForSession (niente service_role);
//  2. il proxy, su `/` e `/auth/confirm`, manda `?code=` a /auth/callback con gli stessi
//     parametri e `?error=` / `?error_code=` a /accedi?errore=link (funzione pura
//     `emailLinkFallback` in src/lib/auth/email-fallback.ts).
// Il flusso completo nel browser è in tests/e2e/auth-code-fallback.spec.ts.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Interfaccia attesa (il modulo ancora non esiste)
// ---------------------------------------------------------------------------
type EmailFallbackModule = {
  /**
   * Percorso + query su cui il proxy deve rimandare la richiesta, oppure `null` se la richiesta
   * prosegue normalmente. Non riceve né restituisce un'origine: il redirect resta sul nostro host.
   */
  emailLinkFallback: (url: URL) => string | null;
};

// Specifier in una variabile: `tsc --noEmit` resta verde finché il modulo non esiste.
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;
const EMAIL_FALLBACK = '@/lib/auth/email-fallback';
const fallback = async (url: string): Promise<string | null> =>
  (await load<EmailFallbackModule>(EMAIL_FALLBACK)).emailLinkFallback(new URL(url));

const ORIGIN = 'http://localhost:3000';
const INVALID_LINK = '/accedi?errore=link';
/** `n` come lo produce emailRedirectUrl per la destinazione `/prenota`. */
const N_PRENOTA = Buffer.from('/prenota', 'utf8').toString('base64url');

/** Percorso e parametri (in ordine) di un risultato relativo; il risultato non deve cambiare host. */
const parseRelative = (result: string | null): { pathname: string; params: Array<[string, string]> } => {
  expect(result, 'atteso un redirect, non null').not.toBeNull();
  const value = result ?? '';
  expect(value.startsWith('/') && !value.startsWith('//'), `atteso un percorso relativo: ${value}`).toBe(true);
  const url = new URL(value, ORIGIN);
  expect(url.origin).toBe(ORIGIN);
  return { pathname: url.pathname, params: [...url.searchParams.entries()].sort() };
};

const paramsOf = (url: string): Array<[string, string]> => [...new URL(url).searchParams.entries()].sort();

// ---------------------------------------------------------------------------
// emailLinkFallback – `code` del flusso PKCE
// ---------------------------------------------------------------------------
describe('emailLinkFallback: ?code= va a /auth/callback con gli stessi parametri (decisione 2)', () => {
  // Site URL: template predefinito senza destinazione → Supabase rimanda a `/?code=...`
  test('/ con solo code', async () => {
    const source = `${ORIGIN}/?code=0b1c2d3e-0000-4000-8000-000000000001`;
    expect(parseRelative(await fallback(source))).toEqual({ pathname: '/auth/callback', params: paramsOf(source) });
  });

  // emailRedirectUrl: `{origin}/?n=<next base64url>` → Supabase aggiunge `code`
  test('/ con code e n (destinazione codificata) li conserva entrambi', async () => {
    for (const source of [
      `${ORIGIN}/?n=${N_PRENOTA}&code=0b1c2d3e-0000-4000-8000-000000000002`,
      `${ORIGIN}/?code=0b1c2d3e-0000-4000-8000-000000000002&n=${N_PRENOTA}`,
    ]) {
      expect(parseRelative(await fallback(source))).toEqual({ pathname: '/auth/callback', params: paramsOf(source) });
    }
  });

  test('/auth/confirm con code va anch\'esso a /auth/callback, parametri compresi', async () => {
    const source = `${ORIGIN}/auth/confirm?code=0b1c2d3e-0000-4000-8000-000000000003&next=${encodeURIComponent(`${ORIGIN}/?n=${N_PRENOTA}`)}`;
    expect(parseRelative(await fallback(source))).toEqual({ pathname: '/auth/callback', params: paramsOf(source) });
  });
});

// ---------------------------------------------------------------------------
// emailLinkFallback – errori di Supabase nella query
// ---------------------------------------------------------------------------
describe('emailLinkFallback: ?error= / ?error_code= vanno a /accedi?errore=link (decisione 2)', () => {
  // Forma reale di GoTrue per un link scaduto o già usato (verificata sullo stack locale):
  // `/?error=access_denied&error_code=otp_expired&error_description=...&n=...#error=...`
  const cases = [
    `${ORIGIN}/?error=access_denied`,
    `${ORIGIN}/?error_code=otp_expired`,
    `${ORIGIN}/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
    `${ORIGIN}/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&n=${N_PRENOTA}`,
    `${ORIGIN}/auth/confirm?error=access_denied&error_code=otp_expired`,
  ];
  for (const source of cases) {
    test(`${source.slice(ORIGIN.length)} → ${INVALID_LINK}`, async () => {
      expect(await fallback(source)).toBe(INVALID_LINK);
    });
  }

  // Decisione presa nei test (proposta approvata): se c'è un errore, l'errore vince sul codice.
  test('con error/error_code e code insieme vince l\'errore', async () => {
    expect(await fallback(`${ORIGIN}/?code=0b1c2d3e-0000-4000-8000-000000000004&error=access_denied`)).toBe(INVALID_LINK);
    expect(await fallback(`${ORIGIN}/?error_code=otp_expired&code=0b1c2d3e-0000-4000-8000-000000000004`)).toBe(INVALID_LINK);
    expect(await fallback(`${ORIGIN}/auth/confirm?code=x&error=server_error&error_code=unexpected_failure`)).toBe(INVALID_LINK);
  });
});

// ---------------------------------------------------------------------------
// emailLinkFallback – richieste che proseguono normalmente
// ---------------------------------------------------------------------------
describe('emailLinkFallback: null fuori da / e /auth/confirm o senza parametri (decisione 2)', () => {
  const cases = [
    `${ORIGIN}/`,
    `${ORIGIN}/?n=${N_PRENOTA}`,
    // Flusso principale invariato (decisione 4): il link del template personalizzato
    `${ORIGIN}/auth/confirm?token_hash=pkce_abc&type=email&next=${encodeURIComponent(ORIGIN)}`,
    `${ORIGIN}/prenota?code=x`,
    `${ORIGIN}/prenota?error=access_denied`,
    `${ORIGIN}/accedi?error_code=otp_expired`,
    // La callback stessa non si rimanda a sé stessa
    `${ORIGIN}/auth/callback?code=x`,
    `${ORIGIN}/auth/callback?code=x&n=${N_PRENOTA}`,
    `${ORIGIN}/admin?code=x`,
    `${ORIGIN}/admin/login?error=access_denied`,
  ];
  for (const source of cases) {
    test(`${source.slice(ORIGIN.length)} → null`, async () => {
      expect(await fallback(source)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Controlli statici su src/app/auth/callback/route.ts (decisione 1, SPEC §8, CLAUDE.md – Sicurezza)
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CALLBACK_ROUTE = ['src', 'app', 'auth', 'callback', 'route.ts'] as const;

/** Sorgente senza commenti, per non farsi ingannare da parole citate nei commenti. */
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const readCallbackRoute = (): string => {
  const path = resolve(ROOT, ...CALLBACK_ROUTE);
  expect(existsSync(path), `file mancante: ${CALLBACK_ROUTE.join('/')}`).toBe(true);
  return stripComments(readFileSync(path, 'utf8'));
};

describe('Route handler GET /auth/callback (decisione 1)', () => {
  test('esiste ed esporta GET', () => {
    expect(readCallbackRoute()).toMatch(/export\s+(?:async\s+function\s+GET\b|const\s+GET\b|\{[^}]*\bGET\b[^}]*\})/);
  });

  test('scambia il codice con exchangeCodeForSession', () => {
    expect(readCallbackRoute()).toMatch(/\.exchangeCodeForSession\s*\(/);
  });

  // SPEC §8, CLAUDE.md – Sicurezza: la callback lavora con la chiave pubblica e i cookie del browser
  test('non usa la service_role', () => {
    const source = readCallbackRoute();
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role|SECRET_KEY/i);
    expect(source).not.toMatch(/['"]@\/lib\/db\/admin['"]|createAdminClient/);
  });
});
