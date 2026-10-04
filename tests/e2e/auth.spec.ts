// Test di accettazione e2e – FETTA 2 (SPEC §11: "Cliente e admin entrano e vedono aree diverse").
// Sezioni: SPEC §2 (ruoli), §5.5 (login con magic link, telefono obbligatorio), §8 (privacy e
// sicurezza), §3.7.4 + decisioni approvate per la fetta 2.
//
// Prerequisiti: Supabase locale avviato (`npx supabase start`, `npx supabase db reset` per il
// seed con gli utenti demo) e Mailpit raggiungibile su http://127.0.0.1:54324. L'URL e la chiave
// pubblica di Supabase si leggono da NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// (ambiente o `.env.local`).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Percorso relativo voluto: non dipende dalla risoluzione dell'alias `@/*` in Playwright.
import { it } from '../../src/i18n/it';

const MAILPIT_URL = 'http://127.0.0.1:54324';
const DEMO_PASSWORD = 'demo1234';
const ADMIN_EMAIL = 'admin@demo.local';
const BARBER_EMAIL = 'barber@demo.local';
const CUSTOMER_EMAIL = 'cliente@demo.local';

const DESKTOP = { width: 1280, height: 800 };

/** Solo l'host esterno: la regex è confrontata con l'URL completo, query compresa. */
const EVIL_HOST = /^https?:\/\/evil\.example/;

// ---------------------------------------------------------------------------
// Testi dell'interfaccia: sempre da src/i18n/it.ts (SPEC §9)
// ---------------------------------------------------------------------------
/** Stringa di `it` per percorso (`auth.staffLogin.title`); errore chiaro se la chiave manca. */
const s = (path: string): string => {
  let node: unknown = it;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  if (typeof node !== 'string' || node.trim() === '') {
    throw new Error(`chiave i18n mancante in src/i18n/it.ts: it.${path}`);
  }
  return node;
};

const ADMIN_ONLY_NAV = [
  'admin.nav.services',
  'admin.nav.barbers',
  'admin.nav.closures',
  'admin.nav.customers',
  'admin.nav.settings',
  'admin.nav.stats',
] as const;

// ---------------------------------------------------------------------------
// Supabase locale e Mailpit
// ---------------------------------------------------------------------------
const readEnvFile = (name: string): string | undefined => {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return undefined;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#') || !line.startsWith(`${name}=`)) continue;
    return line
      .slice(name.length + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
};

const env = (name: string): string => {
  const value = process.env[name] ?? readEnvFile(name);
  if (value === undefined || value === '') {
    throw new Error(`variabile mancante: ${name} (ambiente o .env.local, vedi .env.example)`);
  }
  return value;
};

const supabaseUrl = (): string => env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const apiHeaders = (accessToken?: string): Record<string, string> => ({
  apikey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  'Content-Type': 'application/json',
  ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
});

let emailCounter = 0;
/** Indirizzo nuovo a ogni chiamata: i test non condividono utenti e possono girare in parallelo. */
const uniqueEmail = (label: string): string => {
  emailCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `e2e-${label}-${Date.now()}-${emailCounter}-${random}@qa.test`;
};

type MailpitSummary = { ID: string; Created: string };
type MailpitMessage = { HTML: string; Text: string; Subject: string };

/** Corpo dell'ultima email arrivata a `to` (dopo le prime `skip`), letto da Mailpit. */
const latestEmail = async (request: APIRequestContext, to: string, skip = 0): Promise<MailpitMessage> => {
  let messages: MailpitSummary[] = [];
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${to}"` },
        });
        expect(response.ok(), 'Mailpit non raggiungibile su http://127.0.0.1:54324').toBe(true);
        messages = ((await response.json()) as { messages: MailpitSummary[] }).messages;
        return messages.length;
      },
      { message: `nessuna email arrivata a ${to}`, timeout: 10_000 },
    )
    .toBeGreaterThan(skip);
  const newest = [...messages].sort((a, b) => b.Created.localeCompare(a.Created))[0];
  expect(newest).toBeDefined();
  const response = await request.get(`${MAILPIT_URL}/api/v1/message/${newest?.ID}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as MailpitMessage;
};

const countEmails = async (request: APIRequestContext, to: string): Promise<number> => {
  const response = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${to}"` } });
  expect(response.ok(), 'Mailpit non raggiungibile su http://127.0.0.1:54324').toBe(true);
  return ((await response.json()) as { messages: MailpitSummary[] }).messages.length;
};

/** Link di accesso contenuto nell'email: deve puntare alla nostra route /auth/confirm con token_hash. */
const confirmLink = (message: MailpitMessage): URL => {
  const hrefs = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((match) =>
    (match[1] ?? '').replace(/&amp;/g, '&'),
  );
  const href = hrefs.find((candidate) => candidate.includes('/auth/confirm?'));
  expect(
    href,
    `l'email "${message.Subject}" deve contenere un link a /auth/confirm (template con token_hash)`,
  ).toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  expect(url.pathname).toBe('/auth/confirm');
  expect(url.searchParams.get('token_hash') ?? '').not.toBe('');
  expect(url.searchParams.get('type') ?? '').not.toBe('');
  return url;
};

/** Percorso + query del link, da aprire sul `baseURL` dei test (stesso host dei cookie). */
const relative = (url: URL): string => `${url.pathname}${url.search}`;

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Attende che l'URL abbia esattamente questo percorso (query e hash ignorati). */
const expectPath = async (page: Page, pathname: string): Promise<void> => {
  await expect.poll(() => pathOf(page), { message: `percorso atteso: ${pathname}` }).toBe(pathname);
};

// ---------------------------------------------------------------------------
// Azioni sull'interfaccia
// ---------------------------------------------------------------------------
/** Chiede il magic link da /accedi e restituisce il link ricevuto via email. */
const requestMagicLink = async (page: Page, email: string): Promise<URL> => {
  const before = await countEmails(page.request, email);
  await page.goto('/accedi');
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  return confirmLink(await latestEmail(page.request, email, before));
};

const fillCompleteProfile = async (
  page: Page,
  values: { fullName: string; phone: string; privacy: boolean },
): Promise<void> => {
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(values.fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(values.phone);
  const privacy = page.getByLabel(s('auth.completeProfile.privacyConsentLabel'));
  if (values.privacy) await privacy.check();
  else await privacy.uncheck();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
};

const confirmButton = (page: Page) =>
  page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') });

/**
 * Apre il link del magic link e conferma con il pulsante: la GET su /auth/confirm mostra solo
 * la pagina intermedia, il token viene verificato dalla POST del form (server action).
 */
const openAndConfirm = async (page: Page, target: URL | string): Promise<void> => {
  const response = await page.goto(typeof target === 'string' ? target : relative(target));
  expect(response?.status()).toBe(200);
  await expectPath(page, '/auth/confirm');
  await expect(page.locator('main').getByRole('heading', { name: s('auth.confirmLink.title') })).toBeVisible();
  await expect(confirmButton(page)).toBeVisible();
  await confirmButton(page).click();
};

const staffLogin = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto('/admin/login');
  await page.getByLabel(s('auth.staffLogin.emailLabel')).fill(email);
  await page.getByLabel(s('auth.staffLogin.passwordLabel')).fill(password);
  await page.getByRole('button', { name: s('auth.staffLogin.submit') }).click();
};

const logoutButton = (page: Page) => page.locator('form').getByRole('button', { name: s('auth.logout'), exact: true });

const adminNavLink = (page: Page, key: string) =>
  page.getByRole('navigation').getByRole('link', { name: s(key), exact: true });

// ---------------------------------------------------------------------------
// Anonimo
// ---------------------------------------------------------------------------
test.describe('Anonimo (SPEC §2, §5.5)', () => {
  // Decisione fetta 2: "Anonimo su /admin/** → /admin/login"
  for (const path of ['/admin', '/admin/servizi', '/admin/clienti', '/admin/impostazioni']) {
    test(`anonimo su ${path} viene mandato a /admin/login`, async ({ page }) => {
      await page.goto(path);
      await expectPath(page, '/admin/login');
      await expect(page.getByRole('heading', { name: s('auth.staffLogin.title') })).toBeVisible();
    });
  }

  // SPEC §5.5: il completamento del profilo richiede una sessione
  test('anonimo su /profilo/completa viene mandato a /accedi', async ({ page }) => {
    await page.goto('/profilo/completa');
    await expectPath(page, '/accedi');
  });

  // Decisione fetta 2: le pagine private del cliente richiedono il login (/profilo è l'unica
  // che esiste in questa fetta)
  test('anonimo su /profilo viene mandato a /accedi', async ({ page }) => {
    await page.goto('/profilo');
    await expectPath(page, '/accedi');
  });

  // SPEC §5.1: la home resta pubblica, con il collegamento alla pagina di login
  test('la home è pubblica e porta a /accedi', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expectPath(page, '/');
    const login = page.getByRole('link', { name: s('nav.login'), exact: true });
    await expect(login).toBeVisible();
    await expect(logoutButton(page)).toHaveCount(0);
    await login.click();
    await expectPath(page, '/accedi');
  });

  // Decisione fetta 2: login cliente con magic link, senza password
  test('/accedi mostra solo il campo email', async ({ page }) => {
    const response = await page.goto('/accedi');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: s('auth.customerLogin.title') })).toBeVisible();
    await expect(page.getByLabel(s('auth.customerLogin.emailLabel'))).toBeVisible();
    await expect(page.getByRole('button', { name: s('auth.customerLogin.submit') })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  // Decisione fetta 2: staff con email + password, "nessuna auto-registrazione"
  test('/admin/login mostra email e password, senza registrazione', async ({ page }) => {
    const response = await page.goto('/admin/login');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: s('auth.staffLogin.title') })).toBeVisible();
    await expect(page.getByLabel(s('auth.staffLogin.emailLabel'))).toBeVisible();
    await expect(page.getByLabel(s('auth.staffLogin.passwordLabel'))).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: s('auth.staffLogin.submit') })).toBeVisible();
    await expect(page.getByRole('link', { name: /registr/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /registr/i })).toHaveCount(0);
  });

  // Aggiunta di sicurezza 3: senza token valido non si entra, e `next` esterno non viene seguito
  for (const next of [
    'https://evil.example/rubato',
    '//evil.example/rubato',
    '/\\evil.example/rubato',
    'https:evil.example',
  ]) {
    test(`/auth/confirm con token non valido e next=${next} resta sul sito`, async ({ page, baseURL }) => {
      await page.route(EVIL_HOST, (route) => route.fulfill({ status: 200, body: 'sito esterno' }));
      const query = new URLSearchParams({ token_hash: 'token-non-valido', type: 'email', next }).toString();

      // La GET mostra la pagina intermedia: 200, nessun redirect
      const get = await page.request.get(`/auth/confirm?${query}`, { maxRedirects: 0 });
      expect(get.status()).toBe(200);

      // La conferma (POST) con token non valido porta a /accedi, sul nostro sito, senza sessione
      await openAndConfirm(page, `/auth/confirm?${query}`);
      await expectPath(page, '/accedi');
      expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
      await expect(logoutButton(page)).toHaveCount(0);
      await page.goto('/profilo/completa');
      await expectPath(page, '/accedi');
    });
  }

  test('/auth/confirm con token non valido e next interno non crea una sessione', async ({ page }) => {
    await openAndConfirm(page, '/auth/confirm?token_hash=token-non-valido&type=email&next=/profilo/completa');
    await expectPath(page, '/accedi');
    await page.goto('/profilo/completa');
    await expectPath(page, '/accedi');
  });

  // Decisione fetta 2: senza token_hash o con type non ammesso non c'è nulla da confermare
  for (const query of ['', '?type=email', '?token_hash=token-qualsiasi', '?token_hash=token-qualsiasi&type=non-ammesso']) {
    test(`/auth/confirm${query} (parametri mancanti o non ammessi) rimanda a /accedi`, async ({ page }) => {
      await page.goto(`/auth/confirm${query}`);
      await expectPath(page, '/accedi');
      await expect(confirmButton(page)).toHaveCount(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Cliente: magic link → completamento profilo → area clienti
// ---------------------------------------------------------------------------
test.describe('Cliente con magic link (SPEC §5.5, §8, §2)', () => {
  test('primo accesso: magic link, completamento del profilo, area clienti, logout', async ({ page }) => {
    const email = uniqueEmail('cliente');

    // SPEC §5.5: email con magic link → GET /auth/confirm?token_hash=...&type=...
    const link = await requestMagicLink(page, email);
    await openAndConfirm(page, link);

    // Decisione fetta 2: al primo accesso il cliente completa il profilo
    await expectPath(page, '/profilo/completa');
    await expect(page.getByRole('heading', { name: s('auth.completeProfile.title') })).toBeVisible();

    // SPEC §8: consensi mai preselezionati
    await expect(page.getByLabel(s('auth.completeProfile.privacyConsentLabel'))).not.toBeChecked();
    await expect(page.getByLabel(s('auth.completeProfile.marketingConsentLabel'))).not.toBeChecked();

    // Decisione fetta 2: il profilo incompleto non blocca le pagine pubbliche...
    await page.goto('/');
    await expectPath(page, '/');
    await expect(page.getByRole('heading', { name: it.shop.name })).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();

    // ...ma le pagine private del cliente rimandano al completamento
    await page.goto('/profilo');
    await expectPath(page, '/profilo/completa');

    // SPEC §5.5: "Il telefono è obbligatorio in profilo"
    await fillCompleteProfile(page, { fullName: 'Elisa Prova', phone: '', privacy: true });
    await expect(page.getByRole('button', { name: s('auth.completeProfile.submit') })).toBeVisible();
    await page.goto('/profilo');
    await expectPath(page, '/profilo/completa');

    // CLAUDE.md – Sicurezza: telefono non valido rifiutato dal server
    await fillCompleteProfile(page, { fullName: 'Elisa Prova', phone: '12', privacy: true });
    await expect(page.getByRole('button', { name: s('auth.completeProfile.submit') })).toBeVisible();
    await page.goto('/profilo');
    await expectPath(page, '/profilo/completa');

    // SPEC §8: "consenso esplicito al trattamento in registrazione"
    await fillCompleteProfile(page, { fullName: 'Elisa Prova', phone: '+39 333 1234567', privacy: false });
    await expect(page.getByRole('button', { name: s('auth.completeProfile.submit') })).toBeVisible();
    await page.goto('/profilo');
    await expectPath(page, '/profilo/completa');

    // Nome, telefono e consenso privacy (marketing facoltativo, non dato) → area clienti.
    // Review fetta 5 (approvato dall'utente): si torna alla pagina da cui si era partiti (/profilo).
    await fillCompleteProfile(page, { fullName: 'Elisa Prova', phone: '+39 333 1234567', privacy: true });
    await expectPath(page, '/profilo');
    await expect(page.getByRole('heading', { name: s('profile.title') })).toBeVisible();

    // Aggiunta di sicurezza 6: il logout è un <button> dentro un <form>, mai un link
    await expect(logoutButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: s('auth.logout'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: s('nav.login'), exact: true })).toHaveCount(0);

    // Decisione fetta 2: "Cliente su /admin/** → home /"
    for (const path of ['/admin', '/admin/servizi', '/admin/impostazioni', '/admin/login']) {
      await page.goto(path);
      await expectPath(page, '/');
    }

    // Con il profilo completo la pagina privata è raggiungibile
    const profile = await page.goto('/profilo');
    expect(profile?.status()).toBe(200);
    await expectPath(page, '/profilo');

    // Profilo già completo e sessione attiva: niente ritorno a completamento o login
    await page.goto('/profilo/completa');
    await expectPath(page, '/');
    await page.goto('/accedi');
    await expectPath(page, '/');

    // La sessione sopravvive al ricaricamento della pagina
    await page.reload();
    await expect(logoutButton(page)).toBeVisible();

    // Logout
    // Decisione fetta 2: dopo il logout si va sulla home
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(page.getByRole('link', { name: s('nav.login'), exact: true })).toBeVisible();
    await expect(logoutButton(page)).toHaveCount(0);
    await page.goto('/profilo');
    await expectPath(page, '/accedi');
    await page.goto('/profilo/completa');
    await expectPath(page, '/accedi');

    // SPEC §8: il magic link vale una volta sola: riaprirlo e confermare non crea una sessione
    await openAndConfirm(page, link);
    await expectPath(page, '/accedi');
    await expect(logoutButton(page)).toHaveCount(0);
    await page.goto('/profilo/completa');
    await expectPath(page, '/accedi');
  });

  // Decisione fetta 2: la GET non verifica il token (scanner delle email, anteprime dei link)
  test('una GET da sola non consuma il magic link: serve il click sul pulsante', async ({ page }) => {
    const email = uniqueEmail('scanner');
    const link = await requestMagicLink(page, email);

    // Uno scanner apre il link più volte senza inviare il form
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const scanned = await page.request.get(relative(link), { maxRedirects: 0 });
      expect(scanned.status()).toBe(200);
    }

    // Anche aprirlo nel browser senza cliccare non crea una sessione
    const opened = await page.goto(relative(link));
    expect(opened?.status()).toBe(200);
    await expectPath(page, '/auth/confirm');
    await expect(confirmButton(page)).toBeVisible();
    await page.goto('/profilo/completa');
    await expectPath(page, '/accedi');
    await page.goto('/');
    await expect(logoutButton(page)).toHaveCount(0);

    // Il token è ancora valido: con il click l'accesso riesce
    await openAndConfirm(page, link);
    await expectPath(page, '/profilo/completa');
    await page.goto('/');
    await expect(logoutButton(page)).toBeVisible();
  });

  // Decisione fetta 2: lo staff entra solo con email + password da /admin/login
  test('magic link chiesto con l\'email di uno staff: stessa risposta, nessuna sessione staff', async ({ page }) => {
    const answerFor = async (email: string): Promise<string> => {
      await page.goto('/accedi');
      await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
      await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
      await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
      await expectPath(page, '/accedi');
      return (await page.locator('main').innerText()).split(email).join('<email>');
    };

    // Aggiunta di sicurezza 4: la risposta su /accedi è la stessa di sempre
    const before = await countEmails(page.request, ADMIN_EMAIL);
    const forStaff = await answerFor(ADMIN_EMAIL);
    const forUnknown = await answerFor(uniqueEmail('non-staff'));
    expect(forStaff).toBe(forUnknown);

    // Aprendo il link e confermando non si ottiene una sessione staff
    const link = confirmLink(await latestEmail(page.request, ADMIN_EMAIL, before));
    await openAndConfirm(page, link);
    await expectPath(page, '/admin/login');
    await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);

    for (const path of ['/admin', '/admin/impostazioni']) {
      await page.goto(path);
      await expectPath(page, '/admin/login');
      await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);
    }
    await page.goto('/');
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
  });

  // Aggiunta di sicurezza 3: `next` accetta solo percorsi interni
  test('accesso successivo: next esterno ignorato, si arriva alla home', async ({ page }) => {
    const email = uniqueEmail('ritorno');
    await page.route(EVIL_HOST, (route) => route.fulfill({ status: 200, body: 'sito esterno' }));

    const first = await requestMagicLink(page, email);
    await openAndConfirm(page, first);
    await expectPath(page, '/profilo/completa');
    await fillCompleteProfile(page, { fullName: 'Rita Ritorno', phone: '333 765 4321', privacy: true });
    await expectPath(page, '/');
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);

    // Utente già registrato e con profilo completo: nuovo magic link con `next` esterno
    const second = await requestMagicLink(page, email);
    second.searchParams.set('next', '//evil.example/rubato');
    await openAndConfirm(page, second);
    await expectPath(page, '/');
    expect(new URL(page.url()).hostname).not.toBe('evil.example');
    await expect(logoutButton(page)).toBeVisible();
  });

  test('accesso successivo: next=https://evil.example ignorato', async ({ page, baseURL }) => {
    const email = uniqueEmail('esterno');
    await page.route(EVIL_HOST, (route) => route.fulfill({ status: 200, body: 'sito esterno' }));

    const link = await requestMagicLink(page, email);
    link.searchParams.set('next', 'https://evil.example/rubato');
    await openAndConfirm(page, link);
    // Utente nuovo: il profilo è incompleto, quindi si arriva al completamento (mai fuori dal sito)
    await expectPath(page, '/profilo/completa');
    expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
  });

  // Aggiunta di sicurezza 4: nessuna enumerazione degli account
  test('stessa risposta al magic link per email registrata e mai vista', async ({ page }) => {
    const unknown = uniqueEmail('sconosciuta');

    const answerFor = async (email: string): Promise<string> => {
      await page.goto('/accedi');
      await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
      await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
      await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
      await expectPath(page, '/accedi');
      return (await page.locator('main').innerText()).split(email).join('<email>');
    };

    const existing = await answerFor(CUSTOMER_EMAIL);
    const missing = await answerFor(unknown);
    expect(missing).toBe(existing);
  });

  // CLAUDE.md – Sicurezza: input validato lato server
  test('email non valida: nessun messaggio di invio e nessuna email', async ({ page }) => {
    await page.goto('/accedi');
    await page.getByLabel(s('auth.customerLogin.emailLabel')).fill('non-una-email');
    await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
    await expectPath(page, '/accedi');
    await expect(page.getByText(s('auth.customerLogin.linkSent'))).toHaveCount(0);
    await expect(page.getByLabel(s('auth.customerLogin.emailLabel'))).toBeVisible();
  });

  // Aggiunta di sicurezza 1: il ruolo viene solo da profiles, mai dai metadati
  test('utente registrato con role admin nei metadati resta cliente e non entra in /admin', async ({ page }) => {
    const email = uniqueEmail('finto-admin');
    const response = await page.request.post(`${supabaseUrl()}/auth/v1/otp`, {
      headers: apiHeaders(),
      data: {
        email,
        create_user: true,
        data: { role: 'admin', is_blocked: false, full_name: 'Finto Admin' },
      },
    });
    expect(response.ok(), `registrazione via API fallita: ${response.status()}`).toBe(true);

    const link = confirmLink(await latestEmail(page.request, email));
    await openAndConfirm(page, link);
    await expectPath(page, '/profilo/completa');

    for (const path of ['/admin', '/admin/servizi', '/admin/impostazioni']) {
      await page.goto(path);
      await expect
        .poll(() => pathOf(page), { message: `${path} deve rimandare fuori da /admin` })
        .toMatch(/^\/(?:profilo\/completa)?$/);
      await expect(page.getByRole('navigation').getByRole('link', { name: s('admin.nav.services') })).toHaveCount(0);
    }

    await fillCompleteProfileAfterRedirect(page);
    await page.goto('/admin');
    await expectPath(page, '/');
  });
});

/** Completa il profilo partendo da qualunque pagina dell'area clienti. */
async function fillCompleteProfileAfterRedirect(page: Page): Promise<void> {
  await page.goto('/profilo/completa');
  await expectPath(page, '/profilo/completa');
  await fillCompleteProfile(page, { fullName: 'Finto Admin', phone: '+39 333 0000000', privacy: true });
  await expectPath(page, '/');
}

// ---------------------------------------------------------------------------
// Account staff di prova, creati via API (nessuna auto-registrazione nell'interfaccia)
// ---------------------------------------------------------------------------
type StaffAccount = { email: string; password: string; userId: string; adminToken: string };

/** L'admin demo aggiorna un profilo via API REST (RLS: solo l'admin può cambiare ruolo e blocco). */
const patchProfile = async (
  request: APIRequestContext,
  adminToken: string,
  userId: string,
  data: { role?: 'barber' | 'admin' | 'customer'; is_blocked?: boolean },
): Promise<void> => {
  const patch = await request.patch(`${supabaseUrl()}/rest/v1/profiles?id=eq.${userId}`, {
    headers: { ...apiHeaders(adminToken), Prefer: 'return=representation' },
    data,
  });
  expect(patch.ok(), `aggiornamento del profilo via API fallito: ${patch.status()}`).toBe(true);
  const rows = (await patch.json()) as Array<{ role: string; is_blocked: boolean }>;
  expect(rows).toHaveLength(1);
  if (data.role !== undefined) expect(rows[0]?.role).toBe(data.role);
  if (data.is_blocked !== undefined) expect(rows[0]?.is_blocked).toBe(data.is_blocked);
};

/** Nuovo utente con password, email confermata, promosso a barbiere dall'admin demo. */
const createBarberAccount = async (
  request: APIRequestContext,
  label: string,
  options: { blocked: boolean },
): Promise<StaffAccount> => {
  const email = uniqueEmail(label);
  const password = 'E2e-password-2026';

  // 1. Registrazione via API, con conferma dell'email se richiesta
  const signup = await request.post(`${supabaseUrl()}/auth/v1/signup`, {
    headers: apiHeaders(),
    data: { email, password },
  });
  expect(signup.ok(), `registrazione via API fallita: ${signup.status()}`).toBe(true);
  const signupBody = (await signup.json()) as { id?: string; access_token?: string; user?: { id: string } };
  const userId = signupBody.user?.id ?? signupBody.id ?? '';
  expect(userId, 'id del nuovo utente').not.toBe('');

  if (signupBody.access_token === undefined) {
    const message = await latestEmail(request, email);
    const body = `${message.HTML.replace(/&amp;/g, '&')}\n${message.Text}`;
    const tokenHash = /[?&](?:token_hash|token)=([A-Za-z0-9_-]+)/.exec(body)?.[1];
    const type = /[?&]type=([a-z_]+)/.exec(body)?.[1];
    expect(tokenHash, "token di conferma nell'email").toBeTruthy();
    const verify = await request.post(`${supabaseUrl()}/auth/v1/verify`, {
      headers: apiHeaders(),
      data: { type: type ?? 'signup', token_hash: tokenHash },
    });
    expect(verify.ok(), `conferma email via API fallita: ${verify.status()}`).toBe(true);
  }

  // 2. L'admin demo lo promuove a barbiere (ed eventualmente lo blocca)
  const adminSession = await request.post(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    headers: apiHeaders(),
    data: { email: ADMIN_EMAIL, password: DEMO_PASSWORD },
  });
  expect(adminSession.ok(), `login admin via API fallito: ${adminSession.status()}`).toBe(true);
  const { access_token: adminToken } = (await adminSession.json()) as { access_token: string };

  await patchProfile(request, adminToken, userId, { role: 'barber', is_blocked: options.blocked });
  return { email, password, userId, adminToken };
};

// ---------------------------------------------------------------------------
// Staff: admin e barbiere (area /admin, desktop first)
// ---------------------------------------------------------------------------
test.describe('Staff su /admin (SPEC §2)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §2: "admin – Tutto"; decisione fetta 2: menu completo
  test('admin: entra da /admin/login, vede il menu completo, esce', async ({ page }) => {
    await staffLogin(page, ADMIN_EMAIL, DEMO_PASSWORD);
    await expectPath(page, '/admin');

    await expect(adminNavLink(page, 'admin.nav.calendar')).toBeVisible();
    for (const key of ADMIN_ONLY_NAV) {
      await expect(adminNavLink(page, key)).toBeVisible();
    }

    // Già autenticato: le pagine di login rimandano all'area riservata
    await page.goto('/admin/login');
    await expectPath(page, '/admin');

    // Decisione fetta 2: lo staff "può vedere le pagine pubbliche dell'area clienti"
    await page.goto('/');
    await expectPath(page, '/');
    await expect(page.getByRole('heading', { name: it.shop.name })).toBeVisible();

    // Decisione fetta 2: il completamento del profilo è solo per i clienti
    await page.goto('/profilo/completa');
    await expectPath(page, '/admin');

    // Aggiunta di sicurezza 6: logout con <button> in un <form>
    await expect(logoutButton(page)).toBeVisible();
    await expect(page.getByRole('link', { name: s('auth.logout'), exact: true })).toHaveCount(0);
    // Decisione fetta 2: dopo il logout si va sulla home, anche per lo staff
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
  });

  // SPEC §2: barbiere; decisione fetta 2: menu ridotto e rotte solo-admin protette
  test('barbiere: entra in /admin, vede solo "Calendario", le rotte solo-admin lo rimandano a /admin', async ({
    page,
  }) => {
    await staffLogin(page, BARBER_EMAIL, DEMO_PASSWORD);
    await expectPath(page, '/admin');

    await expect(adminNavLink(page, 'admin.nav.calendar')).toBeVisible();
    for (const key of ADMIN_ONLY_NAV) {
      await expect(adminNavLink(page, key)).toHaveCount(0);
    }

    for (const path of [
      '/admin/servizi',
      '/admin/barbieri',
      '/admin/chiusure',
      '/admin/clienti',
      '/admin/impostazioni',
      '/admin/statistiche',
    ]) {
      await page.goto(path);
      await expectPath(page, '/admin');
    }

    await page.goto('/');
    await expectPath(page, '/');

    await expect(logoutButton(page)).toBeVisible();
    await logoutButton(page).click();
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
  });

  // Aggiunta di sicurezza 4: errore generico "Credenziali non valide"
  test('/admin/login: stesso errore per password sbagliata, email inesistente e account cliente', async ({ page }) => {
    const errorFor = async (email: string, password: string): Promise<string> => {
      await staffLogin(page, email, password);
      await expect(page.getByText(s('auth.staffLogin.invalidCredentials'))).toBeVisible();
      await expect(page.getByText(s('auth.staffLogin.accountDisabled'))).toHaveCount(0);
      await expectPath(page, '/admin/login');
      return page.locator('main').innerText();
    };

    expect(s('auth.staffLogin.invalidCredentials')).toBe('Credenziali non valide');

    const wrongPassword = await errorFor(ADMIN_EMAIL, 'password-sbagliata');
    const unknownEmail = await errorFor(uniqueEmail('inesistente'), DEMO_PASSWORD);
    // Un cliente con credenziali valide non deve poter distinguere il proprio caso dagli altri
    const customerAccount = await errorFor(CUSTOMER_EMAIL, DEMO_PASSWORD);

    expect(unknownEmail).toBe(wrongPassword);
    expect(customerAccount).toBe(wrongPassword);

    // Il tentativo del cliente da /admin/login non lascia una sessione aperta
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
    await page.goto('/');
    await expect(logoutButton(page)).toHaveCount(0);
  });

  // CLAUDE.md – Sicurezza: input validato lato server, nessun dettaglio nell'errore
  test('/admin/login: campi vuoti non fanno entrare', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByRole('button', { name: s('auth.staffLogin.submit') }).click();
    await expectPath(page, '/admin/login');
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
  });

  // Decisione fetta 2: lo staff bloccato viene disconnesso e rimandato a /admin/login con il
  // messaggio "Account disabilitato" (che compare solo dopo credenziali corrette)
  test('staff bloccato: credenziali corrette, messaggio di account disabilitato, nessuna sessione', async ({
    page,
  }) => {
    // Le chiamate alle API di Supabase restituiscono i token nel corpo, senza cookie: il browser
    // resta senza sessione finché non si passa da /admin/login
    const account = await createBarberAccount(page.request, 'staff-bloccato', { blocked: true });

    // Con credenziali corrette lo staff bloccato non entra e vede il messaggio dedicato
    await staffLogin(page, account.email, account.password);
    await expect(page.getByText(s('auth.staffLogin.accountDisabled'))).toBeVisible();
    await expectPath(page, '/admin/login');
    await expect(page.getByText(s('auth.staffLogin.invalidCredentials'))).toHaveCount(0);
    await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);

    // Nessuna sessione: /admin resta chiuso e sulla home non c'è il logout
    for (const path of ['/admin', '/admin/calendario', '/admin/servizi']) {
      await page.goto(path);
      await expectPath(page, '/admin/login');
      await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);
    }
    await page.goto('/');
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: s('nav.login'), exact: true })).toBeVisible();
  });

  // Decisione fetta 2: il blocco vale anche per una sessione staff già aperta
  test('staff bloccato a sessione già aperta: alla visita successiva è fuori da /admin', async ({ page }) => {
    const account = await createBarberAccount(page.request, 'staff-poi-bloccato', { blocked: false });

    // Finché non è bloccato entra normalmente
    await staffLogin(page, account.email, account.password);
    await expectPath(page, '/admin');
    await expect(adminNavLink(page, 'admin.nav.calendar')).toBeVisible();
    await expect(logoutButton(page)).toBeVisible();

    // L'admin demo lo blocca mentre la sessione è aperta
    await patchProfile(page.request, account.adminToken, account.userId, { is_blocked: true });

    // Alla visita successiva: fuori da /admin, con il messaggio dedicato e senza menu
    await page.goto('/admin');
    await expectPath(page, '/admin/login');
    await expect(page.getByText(s('auth.staffLogin.accountDisabled'))).toBeVisible();
    await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);

    await page.goto('/admin/calendario');
    await expectPath(page, '/admin/login');
    await expect(adminNavLink(page, 'admin.nav.calendar')).toHaveCount(0);

    // Sessione chiusa nel browser: sulla home non c'è più il logout
    await page.goto('/');
    await expectPath(page, '/');
    await expect(logoutButton(page)).toHaveCount(0);
  });
});
