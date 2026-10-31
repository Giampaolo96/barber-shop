// Test di accettazione e2e – FETTA 6b (SPEC §11: "L'admin trova un cliente, ne vede lo storico e lo
// blocca o sblocca").
// Flussi principali e controllo d'accesso: SPEC §2 (clienti: solo admin), §6.7 (elenco con ricerca,
// storico, contatore no-show, blocco/sblocco), §6.2 (ricerca cliente nella manuale), §12 (cliente
// bloccato per no-show) + decisioni approvate per la fetta 6b (punti 1, 2, 3, 7, 8).
//
// Rotte attese:
//   /admin/clienti?q=…&pagina=N   voce di menu it.admin.nav.customers (solo admin); campo di ricerca con
//                                 label it.admin.customers.searchLabel (invio con Enter, GET su ?q=);
//                                 ogni cliente è un link (nome accessibile = nome del cliente) verso
//                                 /admin/clienti/<id>.
//   /admin/clienti/<id>           heading con il nome del cliente; email; storico delle prenotazioni
//                                 (date gg/mm/aaaa); stato: it.admin.customers.status.active |
//                                 status.blockedByAdmin | status.blockedByNoShow ({count}, {threshold});
//                                 pulsanti it.admin.customers.block / unblock / resetNoShows.
//   /admin/calendario/nuova       nella ricerca del cliente registrato, il risultato di un cliente bloccato
//                                 mostra it.admin.calendar.form.customerBlocked.
//   Il barbiere non vede la voce "Clienti" ed è rimandato a /admin da /admin/clienti e /admin/clienti/<id>.
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* e SUPABASE_SERVICE_ROLE_KEY (ambiente o
// .env.local). Gli account dei clienti si creano con l'API admin di Supabase Auth (service role, solo nel
// test) e si eliminano alla fine; profili e prenotazioni si preparano con l'API dell'admin demo (RLS
// attiva). Nomi ed email univoci per test: i file girano in parallelo.
// Date da testDate() e pulizia prima di creare le prenotazioni: modificato con l'approvazione dell'utente.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  acceptDialogs,
  adminApi,
  adminNavLink,
  env,
  expectPath,
  itDate,
  loginAsAdmin,
  loginAsBarber,
  romeWinter,
  s,
  sf,
  supabaseUrl,
  uniqueEmail,
  testDate,
  clearBookings,
  uniqueName,
  type AdminApi,
} from './admin-helpers';

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
type Customer = { id: string; email: string; fullName: string };

const serviceHeaders = (): Record<string, string> => {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

/** Cliente registrato (account confermato, profilo con nome e telefono). */
const createCustomer = async (request: APIRequestContext, api: AdminApi, fullName: string): Promise<Customer> => {
  const email = uniqueEmail('cliente');
  const response = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: { email, email_confirm: true },
  });
  expect(response.ok(), `creazione dell'utente fallita: ${response.status()} ${await response.text()}`).toBe(true);
  const { id } = (await response.json()) as { id: string };
  const phone = `+39333${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  await api.patch(`/rest/v1/profiles?id=eq.${id}&select=id`, { full_name: fullName, phone });
  return { id, email, fullName };
};

/** Prenotazione passata del cliente (gli stati finali non occupano l'orario). */
const pastBooking = async (
  api: AdminApi,
  customerId: string,
  date: string,
  time: string,
  status: 'completed' | 'no_show',
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    customer_id: customerId,
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: romeWinter(date, time),
    source: 'manual',
    status,
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

/** Giorno passato di gennaio/febbraio fra gli anni dati, tutto di questo test. */
const pastDate = (fromYear = 2012, toYear = 2023): string => testDate({ fromYear, toYear });

type ProfileRow = { is_blocked: boolean; no_show_count: number; no_show_reset_at: string | null; no_show_reset_by: string | null };
const profileOf = async (api: AdminApi, id: string): Promise<ProfileRow | undefined> =>
  (
    await api.get<ProfileRow[]>(
      `/rest/v1/profiles?select=is_blocked,no_show_count,no_show_reset_at,no_show_reset_by&id=eq.${id}`,
    )
  )[0];

const removeCustomers = async (request: APIRequestContext, api: AdminApi, customers: Customer[]): Promise<void> => {
  if (customers.length === 0) return;
  await api.del(`/rest/v1/bookings?customer_id=in.(${customers.map((c) => c.id).join(',')})`);
  for (const customer of customers) {
    await request.delete(`${supabaseUrl()}/auth/v1/admin/users/${customer.id}`, { headers: serviceHeaders() });
  }
};

const main = (page: Page) => page.locator('main');
const statusText = (page: Page, text: string) => main(page).getByText(text).first();

test.describe('Clienti (SPEC §6.7)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §6.7: elenco con ricerca, storico, blocco/sblocco; decisioni 3 e 7
  test('l\'admin cerca un cliente, ne apre lo storico, lo blocca e lo sblocca', async ({ page }) => {
    const api = await adminApi(page.request);
    const customers: Customer[] = [];
    acceptDialogs(page);

    try {
      const customer = await createCustomer(page.request, api, uniqueName('Cliente storico'));
      customers.push(customer);
      const first = pastDate(2012, 2017);
      const second = pastDate(2018, 2023);
      await clearBookings(api, [SEED.luca], first, second);
      await pastBooking(api, customer.id, first, '10:00', 'completed');
      await pastBooking(api, customer.id, second, '11:00', 'completed');

      await loginAsAdmin(page);
      await adminNavLink(page, 'admin.nav.customers').click();
      await expectPath(page, '/admin/clienti');

      // Ricerca per nome → link alla scheda
      const search = page.getByLabel(s('admin.customers.searchLabel'));
      await search.fill(customer.fullName);
      await search.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(customer.fullName);
      const link = main(page).getByRole('link', { name: customer.fullName, exact: true });
      await expect(link).toHaveCount(1);
      await link.click();
      await expectPath(page, `/admin/clienti/${customer.id}`);

      // Scheda: dati del cliente e storico
      await expect(page.getByRole('heading', { name: customer.fullName })).toBeVisible();
      await expect(main(page).getByText(customer.email).first()).toBeVisible();
      for (const date of [first, second]) await expect(main(page).getByText(itDate(date)).first()).toBeVisible();
      await expect(statusText(page, s('admin.customers.status.active'))).toBeVisible();

      // Blocco (decisione 3: solo profiles.is_blocked)
      await page.getByRole('button', { name: s('admin.customers.block'), exact: true }).click();
      await expect.poll(async () => (await profileOf(api, customer.id))?.is_blocked).toBe(true);
      await expect(statusText(page, s('admin.customers.status.blockedByAdmin'))).toBeVisible();

      // Sblocco
      await page.getByRole('button', { name: s('admin.customers.unblock'), exact: true }).click();
      await expect.poll(async () => (await profileOf(api, customer.id))?.is_blocked).toBe(false);
      await expect(statusText(page, s('admin.customers.status.active'))).toBeVisible();
      await expect(page.getByRole('button', { name: s('admin.customers.block'), exact: true })).toBeVisible();
    } finally {
      await removeCustomers(page.request, api, customers);
    }
  });

  // SPEC §12 (cliente bloccato per no-show), §6.7 (contatore no-show); decisioni 1 e 2
  test('cliente bloccato per no-show: l\'admin azzera i no-show e il cliente torna attivo', async ({ page }) => {
    const api = await adminApi(page.request);
    const customers: Customer[] = [];
    acceptDialogs(page);
    const [settings] = await api.get<Array<{ no_show_block_threshold: number }>>(
      '/rest/v1/shop_settings?select=no_show_block_threshold',
    );
    const threshold = settings?.no_show_block_threshold ?? 0;
    expect(threshold, 'il seed prevede una soglia di no-show attiva').toBeGreaterThan(0);

    try {
      const customer = await createCustomer(page.request, api, uniqueName('Cliente no-show'));
      customers.push(customer);
      const date = pastDate();
      await clearBookings(api, [SEED.luca], date);
      for (let i = 0; i < threshold; i += 1) {
        await pastBooking(api, customer.id, date, `${String(9 + i).padStart(2, '0')}:00`, 'no_show');
      }
      expect((await profileOf(api, customer.id))?.no_show_count).toBe(threshold);

      await loginAsAdmin(page);
      await page.goto(`/admin/clienti/${customer.id}`);
      await expect(
        statusText(page, sf('admin.customers.status.blockedByNoShow', { count: threshold, threshold })),
      ).toBeVisible();

      await page.getByRole('button', { name: s('admin.customers.resetNoShows'), exact: true }).click();
      await expect.poll(async () => (await profileOf(api, customer.id))?.no_show_count).toBe(0);
      const profile = await profileOf(api, customer.id);
      expect(profile).toMatchObject({ is_blocked: false, no_show_reset_by: SEED.adminProfile });
      expect(profile?.no_show_reset_at).not.toBeNull();
      await expect(statusText(page, s('admin.customers.status.active'))).toBeVisible();
    } finally {
      await removeCustomers(page.request, api, customers);
    }
  });

  // SPEC §2 (clienti solo admin), §6.2 + decisione 8 (etichetta "Bloccato" anche per il barbiere)
  test('barbiere: niente sezione Clienti, ma nella manuale vede quali clienti sono bloccati', async ({ page }) => {
    const api = await adminApi(page.request);
    const customers: Customer[] = [];
    const tag = uniqueName('Ricerca');

    try {
      const blocked = await createCustomer(page.request, api, `${tag} Uno`);
      const free = await createCustomer(page.request, api, `${tag} Due`);
      customers.push(blocked, free);
      await api.patch(`/rest/v1/profiles?id=eq.${blocked.id}&select=id`, { is_blocked: true });

      await loginAsBarber(page);
      await expect(adminNavLink(page, 'admin.nav.customers')).toHaveCount(0);
      for (const path of ['/admin/clienti', `/admin/clienti?q=${encodeURIComponent(tag)}`, `/admin/clienti/${free.id}`]) {
        await page.goto(path);
        await expectPath(page, '/admin');
      }

      await page.goto(`/admin/calendario/nuova?barbiere=${SEED.luca}&data=${testDate()}`);
      await page.getByRole('radio', { name: s('admin.calendar.form.registeredOption'), exact: true }).check();
      await page.getByLabel(s('admin.calendar.form.customerSearchLabel'), { exact: true }).fill(tag);
      const result = (name: string) => main(page).getByRole('listitem').filter({ hasText: name });
      await expect(result(blocked.fullName)).toHaveCount(1);
      await expect(result(free.fullName)).toHaveCount(1);
      await expect(result(blocked.fullName)).toContainText(s('admin.calendar.form.customerBlocked'));
      await expect(result(free.fullName)).not.toContainText(s('admin.calendar.form.customerBlocked'));
    } finally {
      await removeCustomers(page.request, api, customers);
    }
  });
});
