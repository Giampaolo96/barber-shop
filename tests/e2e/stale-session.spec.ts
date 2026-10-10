// Regressione del bug in produzione su Safari iOS (dopo la fetta 8, scritta durante la correzione,
// non da spec-qa). Sessione revocata altrove (logout dall'app installata, revoca dell'admin) ma con
// il cookie ancora nel browser: il proxy vedeva un cliente e rimandava /accedi e /admin/login alla
// home, mentre le pagine vedevano un anonimo ("Accedi" che non fa nulla, "Prenota" che ricarica la
// home). Ora il browser torna anonimo a tutti gli effetti e i cookie della sessione spariscono.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { env, expectPath, s, supabaseUrl, uniqueEmail } from './admin-helpers';
import { newestEmailId, waitForNewEmail } from './mailpit';

const isAuthTokenCookie = (name: string): boolean => name.startsWith('sb-') && /-auth-token(?:\.\d+)?$/.test(name);

/** Access token della sessione nei cookie di @supabase/ssr ("base64-" + JSON, anche a pezzi). */
const accessTokenFromCookies = async (context: BrowserContext): Promise<string> => {
  const parts = (await context.cookies())
    .filter((cookie) => isAuthTokenCookie(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .map((cookie) => cookie.value)
    .join('');
  expect(parts, 'cookie di sessione dopo il login').not.toBe('');
  const json = Buffer.from(parts.replace(/^base64-/, ''), 'base64url').toString('utf8');
  return (JSON.parse(json) as { access_token: string }).access_token;
};

/** Login con il codice di un cliente nuovo, con il profilo completato: finisce in home. */
const loginNewCustomer = async (page: Page): Promise<void> => {
  const email = uniqueEmail('sessione-revocata');
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  const message = await waitForNewEmail(page.request, email, before);
  const visible = message.HTML.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const code = visible.match(/(?<![\d\w])(\d{6})(?![\d\w])/)?.[1] ?? '';
  await page.getByLabel(s('auth.loginCode.label'), { exact: true }).fill(code);
  await page.getByRole('button', { name: s('auth.loginCode.submit'), exact: true }).click();

  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill('Cliente Revocato');
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
};

test('sessione revocata altrove: Accedi, Prenota e /admin/login funzionano da anonimo e i cookie spariscono', async ({ page, context }) => {
  await loginNewCustomer(page);
  const loginLink = page.getByRole('banner').getByRole('link', { name: s('nav.login'), exact: true });
  await expect(loginLink).toHaveCount(0);

  // Revoca della sola sessione di questo browser con l'API admin (service role + JWT dell'utente)
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const revoke = await page.request.post(`${supabaseUrl()}/auth/v1/logout?scope=local`, {
    headers: { apikey: key, Authorization: `Bearer ${await accessTokenFromCookies(context)}` },
  });
  expect(revoke.status()).toBe(204);
  // Il cookie resta nel browser: è proprio la situazione del bug
  expect((await context.cookies()).some((cookie) => isAuthTokenCookie(cookie.name))).toBe(true);

  await page.goto('/');
  await expect(loginLink).toBeVisible();

  // "Accedi" apre /accedi (prima restava sulla home) e i cookie della sessione spariscono
  await loginLink.click();
  await expectPath(page, '/accedi');
  await expect(page.getByRole('heading', { name: s('auth.customerLogin.title') })).toBeVisible();
  expect((await context.cookies()).filter((cookie) => isAuthTokenCookie(cookie.name))).toEqual([]);

  // "Prenota" porta al login con il ritorno alla prenotazione (prima ricaricava la home)
  await page.goto('/');
  await page.getByRole('link', { name: s('home.book'), exact: true }).click();
  await expect(page).toHaveURL(/\/accedi\?next=%2Fprenota$/);

  // /admin/login resta aperta (prima riportava alla home)
  await page.goto('/admin/login');
  await expectPath(page, '/admin/login');
  await expect(page.getByRole('heading', { name: s('auth.staffLogin.title') })).toBeVisible();
});
