// Test di accettazione e2e – FETTA 8 (SPEC §11: "PWA ... Installabile su iOS e Android"):
// login con il codice a 6 cifre dell'email, per chi usa l'app installata (il link si aprirebbe nel
// browser e non nell'app).
// Sezioni: SPEC §5.5 (login via email, profilo da completare al primo accesso), §8 (sicurezza,
// limite dei tentativi), §9 (tap target, label), ADR 002 (lo staff non entra con l'email) +
// decisioni approvate per la fetta 8, "Login con codice a 6 cifre".
//
// Interfaccia attesa su /accedi, dopo l'invio dell'email (resta visibile it.auth.customerLogin.linkSent):
//   campo con label it.auth.loginCode.label (inputmode="numeric", autocomplete="one-time-code", ≥ 44px);
//   pulsante it.auth.loginCode.submit; pulsante it.auth.loginCode.resend (disattivato per 60 s; il
//   nome può contenere il conto alla rovescia); link o pulsante it.auth.loginCode.changeEmail, che
//   riporta al campo email; testo it.auth.loginCode.linkStillWorks;
//   errori: it.auth.loginCode.invalid con {remaining}, it.auth.loginCode.blocked.
//
// Prerequisiti: Supabase locale con il seed e Mailpit su http://127.0.0.1:54324; per il test dello
// staff SUPABASE_SERVICE_ROLE_KEY (account creato con l'API admin di Supabase Auth, solo nel test).
// Email univoche per test: nessun altro test chiede un codice per gli stessi indirizzi.
// Ogni codice provato è una verifica di GoTrue ([auth.rate_limit] token_verifications, per IP):
// i test ne usano il minimo indispensabile.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  adminApi,
  env,
  expectPath,
  linkOrButton,
  s,
  sf,
  supabaseUrl,
  uniqueEmail,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail, type MailpitMessage } from './mailpit';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
/** Codice a 6 cifre del testo visibile dell'email (link e attributi esclusi). */
const codeFrom = (message: MailpitMessage): string => {
  const visible = message.HTML.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const codes = [...visible.matchAll(/(?<![\d\w])(\d{6})(?![\d\w])/g)].map((match) => match[1] ?? '');
  expect(codes.length, "l'email deve mostrare il codice a 6 cifre ({{ .Token }})").toBeGreaterThan(0);
  return codes[0] ?? '';
};

/** Un codice diverso da quello giusto (stessa lunghezza). */
const wrongCode = (code: string): string => `${code.slice(0, 5)}${(Number(code[5]) + 1) % 10}`;

const codeInput = (page: Page) => page.getByLabel(s('auth.loginCode.label'), { exact: true });
const codeSubmit = (page: Page) => page.getByRole('button', { name: s('auth.loginCode.submit'), exact: true });
const logoutButton = (page: Page) => page.locator('form').getByRole('button', { name: s('auth.logout'), exact: true });

/**
 * Chiede l'email dalla pagina /accedi già aperta (conserva `next`) e restituisce il messaggio
 * arrivato a Mailpit. Dopo l'invio compare il campo del codice.
 */
const requestCode = async (page: Page, email: string): Promise<MailpitMessage> => {
  await expectPath(page, '/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await expect(codeInput(page)).toBeVisible();
  return waitForNewEmail(page.request, email, before);
};

const enterCode = async (page: Page, code: string): Promise<void> => {
  await codeInput(page).fill(code);
  await codeSubmit(page).click();
};

const completeProfile = async (page: Page): Promise<void> => {
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill('Cliente Codice');
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
};

const serviceHeaders = (): Record<string, string> => {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

/** Account staff (barbiere) di prova: confermato, ruolo assegnato dall'admin demo. */
const createStaffUser = async (request: APIRequestContext): Promise<{ id: string; email: string }> => {
  const email = uniqueEmail('codice-staff');
  const response = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: { email, email_confirm: true },
  });
  expect(response.ok(), `creazione dell'utente fallita: ${response.status()} ${await response.text()}`).toBe(true);
  const { id } = (await response.json()) as { id: string };
  const api = await adminApi(request);
  await api.patch(`/rest/v1/profiles?id=eq.${id}&select=id`, { role: 'barber', full_name: 'Staff Codice' });
  return { id, email };
};

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
test.describe('Cliente con il codice (SPEC §5.5, decisioni fetta 8)', () => {
  // Primo accesso (template di conferma della registrazione), poi accesso da cliente esistente
  // (template del magic link): in entrambi i casi il codice apre la sessione come il link.
  test('nuovo cliente: codice → /profilo/completa → destinazione; poi, da cliente esistente, codice → next', async ({ page }) => {
    const email = uniqueEmail('codice-cliente');

    await page.goto('/prenota');
    await expectPath(page, '/accedi');
    const signup = await requestCode(page, email);
    expect(confirmHref(signup), 'il link a /auth/confirm resta nell\'email di conferma').toBeDefined();
    await enterCode(page, codeFrom(signup));

    await expectPath(page, '/profilo/completa');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/prenota');
    await completeProfile(page);
    await expectPath(page, '/prenota');

    // Cliente esistente: esce, parte da un'altra pagina privata e rientra con un nuovo codice
    await page.goto('/');
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);

    await page.goto('/prenotazioni');
    await expectPath(page, '/accedi');
    const magicLink = await requestCode(page, email);
    expect(confirmHref(magicLink), 'il link a /auth/confirm resta nell\'email del magic link').toBeDefined();
    await enterCode(page, codeFrom(magicLink));
    await expectPath(page, '/prenotazioni');
    await page.goto('/');
    await expect(logoutButton(page)).toBeVisible();

    // SPEC §5.6, decisione "Installazione": voce fissa "Installa l'app" nel profilo
    await page.goto('/profilo');
    await expectPath(page, '/profilo');
    await expect(linkOrButton(page.locator('main'), s('pwa.install.profileEntry'))).toBeVisible();
  });

  // Limiti: 5 errori per codice (azzerati da un nuovo codice), al massimo 10 all'ora per email
  test('codice sbagliato: tentativi rimasti; al 5° errore blocco anche col codice giusto; un nuovo codice fa ripartire', async ({ page }) => {
    const email = uniqueEmail('codice-errori');

    await page.goto('/accedi');
    const first = codeFrom(await requestCode(page, email));

    // Accessibilità del campo (SPEC §9, decisioni fetta 8) e testi del modulo
    await expect(codeInput(page)).toHaveAttribute('inputmode', 'numeric');
    await expect(codeInput(page)).toHaveAttribute('autocomplete', 'one-time-code');
    expect((await codeInput(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((await codeSubmit(page).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(s('auth.loginCode.linkStillWorks'))).toBeVisible();
    await expect(page.getByRole('button', { name: s('auth.loginCode.resend') })).toBeDisabled();

    await enterCode(page, wrongCode(first));
    await expect(page.getByText(sf('auth.loginCode.invalid', { remaining: 4 }))).toBeVisible();
    await expectPath(page, '/accedi');

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await enterCode(page, wrongCode(first));
      await expect(page.getByText(sf('auth.loginCode.invalid', { remaining: 5 - attempt }))).toBeVisible();
    }
    await enterCode(page, wrongCode(first));
    await expect(page.getByText(s('auth.loginCode.blocked'))).toBeVisible();

    // Bloccato: nessuna sessione. Che nemmeno il codice giusto venga verificato lo controlla
    // tests/acceptance/login-code.test.ts (il modulo può nascondere o disattivare il campo).
    await expectPath(page, '/accedi');

    // Nuovo codice per la stessa email ("Usa un'altra email" riporta al campo email): il contatore
    // del codice riparte (5 errori nell'ora finora, il tetto è 10)
    await linkOrButton(page, s('auth.loginCode.changeEmail')).click();
    await expect(codeInput(page)).toHaveCount(0);
    const second = codeFrom(await requestCode(page, email));
    await enterCode(page, wrongCode(second));
    await expect(page.getByText(sf('auth.loginCode.invalid', { remaining: 4 }))).toBeVisible();
    await enterCode(page, second);
    await expectPath(page, '/profilo/completa');
  });

  // Decisione: "Invia di nuovo" disattivato per 60 secondi dopo l'invio
  test('"Invia di nuovo" resta disattivato per 60 secondi', async ({ page }) => {
    await page.clock.install();
    await page.goto('/accedi');
    await requestCode(page, uniqueEmail('codice-reinvio'));
    const resend = page.getByRole('button', { name: s('auth.loginCode.resend') });
    await expect(resend).toBeDisabled();
    await page.clock.fastForward(55_000);
    await expect(resend).toBeDisabled();
    await page.clock.fastForward(6_000);
    await expect(resend).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Staff (ADR 002: lo staff entra solo con email e password)
// ---------------------------------------------------------------------------
test.describe('Staff con il codice (ADR 002, decisioni fetta 8)', () => {
  test('un barbiere che usa il codice finisce su /admin/login senza sessione', async ({ page, request }) => {
    const staff = await createStaffUser(request);
    try {
      await page.goto('/accedi');
      const code = codeFrom(await requestCode(page, staff.email));
      await enterCode(page, code);
      await expectPath(page, '/admin/login');

      // Nessuna sessione staff: /admin rimanda al login
      await page.goto('/admin');
      await expectPath(page, '/admin/login');
      // ...e nessuna sessione nell'area clienti
      await page.goto('/');
      await expect(logoutButton(page)).toHaveCount(0);
    } finally {
      await request.delete(`${supabaseUrl()}/auth/v1/admin/users/${staff.id}`, { headers: serviceHeaders() });
    }
  });
});
