// Warm-up degli e2e in sviluppo. Non è un file di test e non contiene asserzioni.
//
// Con `npm run dev` Next compila ogni pagina alla prima richiesta. Dalla fetta 6 `/admin` è il
// calendario: la sua prima compilazione cadeva dentro i timeout dei test che fanno login in
// parallelo all'avvio. Qui si caricano una volta le pagine principali, prima che partano i test.
// Con la build di produzione (CI) non serve e non fa nulla. Se il warm-up fallisce lo si segnala
// soltanto: i test girano comunque.

import { chromium, type BrowserContext, type FullConfig, type Page } from '@playwright/test';

import { ADMIN_EMAIL, CUSTOMER_EMAIL, DEMO_PASSWORD, SEED, s } from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import { resetDateClaims } from './test-date';

/** Una compilazione a freddo può superare i timeout predefiniti. */
const COMPILE_TIMEOUT = 120_000;

/** Pagine dell'area staff (con la sessione dell'admin demo). */
const ADMIN_PAGES = [
  '/admin',
  '/admin?vista=settimana',
  '/admin/calendario/nuova',
  // id inesistente: compila il dettaglio e la sua pagina 404
  '/admin/calendario/00000000-0000-4000-8000-000000000000',
  '/admin/assenze',
  '/admin/servizi',
  '/admin/servizi/nuovo',
  '/admin/barbieri',
  '/admin/barbieri/nuovo',
  `/admin/barbieri/${SEED.luca}`,
  `/admin/barbieri/${SEED.luca}/orari`,
  `/admin/barbieri/${SEED.luca}/assenze`,
  '/admin/chiusure',
  '/admin/impostazioni',
  // fetta 9a
  '/admin/statistiche',
];

/** Pagine del flusso cliente (con la sessione del cliente demo). */
const CUSTOMER_PAGES = [
  '/',
  '/prenota',
  // fetta 8e: "Quando?" al posto dei passi barbiere e orario
  `/prenota/quando?servizio=${SEED.taglio}`,
  '/prenota/riepilogo',
  '/prenotazioni',
  '/profilo',
];

const visit = async (page: Page, path: string): Promise<void> => {
  await page.goto(path, { timeout: COMPILE_TIMEOUT });
};

const warmUpAdmin = async (context: BrowserContext): Promise<void> => {
  const page = await context.newPage();
  await visit(page, '/admin/login');
  await page.getByLabel(s('auth.staffLogin.emailLabel')).fill(ADMIN_EMAIL);
  await page.getByLabel(s('auth.staffLogin.passwordLabel')).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: s('auth.staffLogin.submit') }).click();
  await page.waitForURL((url) => url.pathname === '/admin', { timeout: COMPILE_TIMEOUT });
  for (const path of ADMIN_PAGES) await visit(page, path);
};

/** Login del cliente demo con il magic link (Mailpit), come negli e2e del flusso cliente. */
const warmUpCustomer = async (context: BrowserContext): Promise<void> => {
  const page = await context.newPage();
  await visit(page, '/accedi');
  const before = await newestEmailId(page.request, CUSTOMER_EMAIL);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(CUSTOMER_EMAIL);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();

  const href = confirmHref(await waitForNewEmail(page.request, CUSTOMER_EMAIL, before));
  if (!href) throw new Error("link /auth/confirm non trovato nell'email");

  const url = new URL(href);
  await visit(page, `${url.pathname}${url.search}`);
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await page.waitForURL((current) => current.pathname === '/', { timeout: COMPILE_TIMEOUT });
  for (const path of CUSTOMER_PAGES) await visit(page, path);
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Le date dei test (test-date.ts) valgono per un giro solo.
  resetDateClaims();

  // Sulla build di produzione (CI e npm run test:e2e) niente compilazione su richiesta.
  if (process.env.CI || config.metadata.production) return;

  const baseURL = config.projects[0]?.use.baseURL;
  const browser = await chromium.launch();
  try {
    for (const warmUp of [warmUpAdmin, warmUpCustomer]) {
      const context = await browser.newContext({ baseURL });
      try {
        await warmUp(context);
      } catch (error) {
        console.warn(`[warm-up e2e] ${warmUp.name} non completato:`, error instanceof Error ? error.message : error);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
