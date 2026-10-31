// Date da testDate() e pulizia prima di creare le prenotazioni: modificato con l'approvazione dell'utente.
// Sezione Clienti su telefono (390 px): elenco a righe invece della tabella a cinque colonne, che
// schiacciava nome ed email (l'email andava a capo lettera per lettera). Ogni cliente è un link alto
// almeno 44 px, l'email sta su una riga, la pagina non scorre in orizzontale. Lo stesso per lo
// storico nella scheda del cliente.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  SEED,
  adminApi,
  env,
  loginAsAdmin,
  romeWinter,
  supabaseUrl,
  testDate,
  clearBookings,
  uniqueName,
  type AdminApi,
} from './admin-helpers';

const serviceHeaders = (): Record<string, string> => {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Righe di testo occupate da un elemento. */
const textLines = (page: Page, testId: string, text: string): Promise<number> =>
  page
    .getByTestId(testId)
    .getByText(text, { exact: true })
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });

test.describe('Clienti su telefono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let api: AdminApi;
  let request: APIRequestContext;
  let customerId = '';

  test.beforeEach(async ({ request: req }) => {
    request = req;
    api = await adminApi(req);
  });

  test.afterEach(async () => {
    if (!customerId) return;
    await api.del(`/rest/v1/bookings?customer_id=eq.${customerId}`);
    await request.delete(`${supabaseUrl()}/auth/v1/admin/users/${customerId}`, { headers: serviceHeaders() });
    customerId = '';
  });

  test("a 390 px elenco e storico sono righe da 44 px, l'email su una riga e nessuno scroll della pagina", async ({
    page,
  }) => {
    const fullName = uniqueName('Francesco Esposito Della Valle');
    // Email lunga: nella tabella andava a capo lettera per lettera
    const email = `francesco.espositodellavalle.${Date.now()}${Math.floor(Math.random() * 1000)}@esempio-barbiere.it`;
    const created = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
      headers: serviceHeaders(),
      data: { email, email_confirm: true },
    });
    expect(created.ok(), `creazione dell'utente fallita: ${created.status()}`).toBe(true);
    customerId = ((await created.json()) as { id: string }).id;
    await api.patch(`/rest/v1/profiles?id=eq.${customerId}&select=id`, {
      full_name: fullName,
      phone: `+39333${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    });
    const day = testDate({ fromYear: 2012, toYear: 2021 });
    await clearBookings(api, [SEED.luca], day);
    await api.post('/rest/v1/bookings?select=id', {
      customer_id: customerId,
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(day, '10:00'),
      source: 'manual',
      status: 'completed',
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/clienti?q=${encodeURIComponent(fullName)}`);

    // Elenco: niente tabella, una riga-link per cliente
    await expect(page.locator('main table')).toBeHidden();
    const item = page.getByTestId('customers-list').getByRole('link').filter({ hasText: fullName });
    await expect(item).toHaveCount(1);
    const box = await item.boundingBox();
    expect(box?.height ?? 0, 'area di tocco della riga').toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(await textLines(page, 'customers-list', email), 'email su una riga').toBe(1);
    expect(await textLines(page, 'customers-list', fullName), 'nome su una riga').toBe(1);
    expect(await pageOverflow(page), 'nessuno scroll orizzontale della pagina').toBeLessThanOrEqual(0);

    // Scheda: dati leggibili e storico a righe
    await item.click();
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
    await expect(page.locator('main').getByText(email, { exact: true })).toBeVisible();
    await expect(page.locator('main table')).toBeHidden();
    const booking = page.getByTestId('customer-history-list').getByRole('link');
    await expect(booking).toHaveCount(1);
    expect((await booking.boundingBox())?.height ?? 0, 'area di tocco dello storico').toBeGreaterThanOrEqual(44);
    expect(await pageOverflow(page), 'nessuno scroll orizzontale della scheda').toBeLessThanOrEqual(0);
  });
});
