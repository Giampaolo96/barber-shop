// Test di accettazione e2e – ripiego del login con il template email predefinito di Supabase
// (modifica all'autenticazione fuori dal piano di §11).
// Sezioni: SPEC §5.5 (login con magic link, telefono obbligatorio), §8 (sicurezza),
// docs/adr/002-autenticazione.md (lo staff non entra mai con il magic link) + decisioni approvate:
//  1. GET /auth/callback scambia `code`; cliente → destinazione (o /profilo/completa?next=...),
//     staff → /admin/login senza sessione; codice mancante/non valido/scaduto → /accedi?errore=link;
//  2. il proxy manda `/?code=` a /auth/callback e `/?error=` / `?error_code=` a /accedi?errore=link;
//  3. errori nel fragment (`#error=...`) → /accedi?errore=link (componente client nel layout clienti);
//  4. il flusso principale (/auth/confirm + POST) non cambia.
//
// Simulazione del template predefinito. In locale le email usano il template personalizzato
// (`/auth/confirm?token_hash=...&type=email&next={{ .RedirectTo }}`); il `token_hash` (prefisso
// `pkce_`) è lo stesso token che il template predefinito mette in
// `{SUPABASE_URL}/auth/v1/verify?token=<token_hash>&type=<tipo>&redirect_to={{ .RedirectTo }}`.
// Il tipo è quello dei template predefiniti: `signup` per il primo accesso di un indirizzo nuovo
// (email "Confirm signup"), `magiclink` per un account esistente (verificato sullo stack locale:
// con il tipo sbagliato GoTrue risponde otp_expired). Il code_verifier PKCE è nel cookie che
// la server action di /accedi ha scritto nel browser: il link va aperto nello stesso contesto.
//
// Prerequisiti: Supabase locale avviato con il seed e Mailpit su http://127.0.0.1:54324.
// I test usano indirizzi nuovi o il barbiere demo (nessun altro e2e gli chiede un magic link),
// così le email non si confondono fra test in parallelo.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Page } from '@playwright/test';

import { BARBER_EMAIL, expectPath, s, supabaseUrl, uniqueEmail } from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';

type EmailLink = { tokenHash: string; redirectTo: string };
type DefaultTemplateType = 'signup' | 'magiclink';

const INVALID_LINK_PATH = '/accedi';

const logoutButton = (page: Page) => page.locator('form').getByRole('button', { name: s('auth.logout'), exact: true });

/** Decodifica `n` come nextFromEmailLink (base64url). */
const decodeN = (redirectTo: string): string | null => {
  const encoded = new URL(redirectTo).searchParams.get('n');
  return encoded === null ? null : Buffer.from(encoded, 'base64url').toString('utf8');
};

/**
 * Invia il modulo di /accedi (la pagina corrente, con l'eventuale `next`) e legge dall'email il
 * token e l'URL di redirect, cioè gli ingredienti del link del template predefinito.
 */
const requestLinkFromCurrentPage = async (page: Page, email: string, baseURL: string): Promise<EmailLink> => {
  await expectPath(page, '/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();

  const href = confirmHref(await waitForNewEmail(page.request, email, before));
  expect(href, "l'email deve contenere il link a /auth/confirm con token_hash").toBeDefined();
  const confirm = new URL(href ?? 'http://invalid.invalid');
  const tokenHash = confirm.searchParams.get('token_hash') ?? '';
  const redirectTo = confirm.searchParams.get('next') ?? '';
  // Flusso PKCE: senza prefisso la simulazione del template predefinito non avrebbe senso.
  expect(tokenHash, 'token_hash PKCE atteso (signInWithOtp lato server con @supabase/ssr)').toMatch(/^pkce_/);
  // {{ .RedirectTo }}: emailRedirectTo di requestMagicLink oppure il Site URL, sempre sul nostro host
  expect(new URL(redirectTo).origin).toBe(new URL(baseURL).origin);
  return { tokenHash, redirectTo };
};

/** Link come lo scrive il template predefinito di Supabase ({{ .ConfirmationURL }}). */
const defaultTemplateLink = (link: EmailLink, type: DefaultTemplateType): string => {
  const query = new URLSearchParams({ token: link.tokenHash, type, redirect_to: link.redirectTo });
  return `${supabaseUrl()}/auth/v1/verify?${query.toString()}`;
};

/** Decisione 1–3: ogni link non valido finisce su /accedi?errore=link. */
const expectInvalidLink = async (page: Page): Promise<void> => {
  await expectPath(page, INVALID_LINK_PATH);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('errore'), { message: 'atteso ?errore=link' })
    .toBe('link');
};

/** Nessuna sessione cliente: pagina privata → /accedi, nessun logout in testata. */
const expectNoCustomerSession = async (page: Page): Promise<void> => {
  await page.goto('/profilo/completa');
  await expectPath(page, '/accedi');
  await page.goto('/');
  await expect(logoutButton(page)).toHaveCount(0);
};

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
test.describe('Cliente con il link del template predefinito (SPEC §5.5, decisione 1)', () => {
  test('nuovo cliente da /prenota: profilo da completare, poi la destinazione; al login successivo direttamente lì', async ({
    page,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3000';
    const email = uniqueEmail('fallback-cliente');

    // Primo accesso partendo da una pagina privata: `next` arriva a /accedi
    await page.goto('/prenota');
    await expectPath(page, '/accedi');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/prenota');
    const first = await requestLinkFromCurrentPage(page, email, origin);
    expect(decodeN(first.redirectTo), 'emailRedirectTo con la destinazione codificata in n').toBe('/prenota');

    // Supabase verifica il token e rimanda a `/?n=...&code=...`: la sessione si apre nella callback
    await page.goto(defaultTemplateLink(first, 'signup'));
    await expectPath(page, '/profilo/completa');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/prenota');

    // SPEC §5.5: telefono obbligatorio; dopo il salvataggio si arriva alla destinazione
    await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill('Cliente Ripiego');
    await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
    await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
    await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
    await expectPath(page, '/prenota');
    await page.goto('/');
    await expect(logoutButton(page)).toBeVisible();

    // Cliente esistente con profilo completo: il link porta direttamente alla destinazione
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
    await page.goto('/prenotazioni');
    await expectPath(page, '/accedi');
    const second = await requestLinkFromCurrentPage(page, email, origin);
    expect(decodeN(second.redirectTo)).toBe('/prenotazioni');

    await page.goto(defaultTemplateLink(second, 'magiclink'));
    await expectPath(page, '/prenotazioni');
    await page.goto('/');
    await expect(logoutButton(page)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
test.describe('Staff con il link del template predefinito (ADR 002, decisione 1)', () => {
  // ADR 002: il magic link non apre mai una sessione staff
  test('il barbiere demo finisce su /admin/login senza sessione', async ({ page, baseURL }) => {
    await page.goto('/accedi');
    const link = await requestLinkFromCurrentPage(page, BARBER_EMAIL, baseURL ?? 'http://localhost:3000');

    await page.goto(defaultTemplateLink(link, 'magiclink'));
    await expectPath(page, '/admin/login');

    // Nessuna sessione staff: /admin rimanda al login (con una sessione /admin/login rimanderebbe a /admin)
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
    // ...e nessuna sessione nemmeno nell'area clienti
    await page.goto('/');
    await expect(logoutButton(page)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Link non validi
// ---------------------------------------------------------------------------
test.describe('Link non validi (decisioni 1–3)', () => {
  test('codice inventato: /?code=inventato → /accedi?errore=link, senza sessione', async ({ page }) => {
    await page.goto('/?code=inventato');
    await expectInvalidLink(page);
    await expectNoCustomerSession(page);
  });

  // GoTrue (stack locale) per un link già usato o scaduto risponde 303 verso
  // `<redirect_to>?error=access_denied&error_code=otp_expired&...#error=access_denied&...`:
  // l'esito atteso non dipende da dove si trova l'errore (query o fragment).
  test('link già usato: aprirlo una seconda volta → /accedi?errore=link, senza sessione', async ({ page, baseURL }) => {
    const email = uniqueEmail('fallback-usato');
    await page.goto('/accedi');
    const link = await requestLinkFromCurrentPage(page, email, baseURL ?? 'http://localhost:3000');
    const url = defaultTemplateLink(link, 'signup');

    // Prima apertura (es. lo scanner della posta): il token è valido e viene consumato
    const firstOpen = await page.request.get(url, { maxRedirects: 0 });
    expect(firstOpen.status()).toBe(303);
    expect(new URL(firstOpen.headers()['location'] ?? 'http://invalid.invalid').searchParams.get('code') ?? '').not.toBe('');

    // Seconda apertura, nel browser del cliente
    await page.goto(url);
    await expectInvalidLink(page);
    await expectNoCustomerSession(page);
  });

  test('errore nella query: /?error=access_denied&error_code=otp_expired → /accedi?errore=link', async ({ page }) => {
    await page.goto('/?error=access_denied&error_code=otp_expired');
    await expectInvalidLink(page);
  });

  test('errore nel fragment: /#error=access_denied&error_code=otp_expired → /accedi?errore=link', async ({ page }) => {
    await page.goto('/#error=access_denied&error_code=otp_expired');
    await expectInvalidLink(page);
  });
});
