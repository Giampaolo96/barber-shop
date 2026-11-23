// Test di accettazione e2e – FETTA 9b "Privacy e account del cliente" (SPEC §11 riga 9b: "il cliente si
// elimina; l'admin vede le prenotazioni passate come 'Cliente eliminato'"; SPEC §8; decisione D).
// Telefono 390×844 per il cliente, desktop per l'admin.
//
// Rotte e testi attesi (src/i18n/it.ts):
//   /profilo          link it.profile.deleteAccount verso /profilo/elimina.
//   /profilo/elimina  titolo it.profile.deletion.title; riepilogo it.profile.deletion.futureBookings,
//                     .pastBookings, .account, .irreversible; primo passo: pulsante
//                     it.profile.deletion.proceed; solo dopo compare il pulsante it.profile.deletion.confirm.
//   dopo la conferma  redirect a / con il messaggio it.home.accountDeleted, sessione chiusa.
//   admin             calendario (/admin?data=…&vista=giorno), dettaglio (/admin/calendario/<id>) e
//                     "Da aggiornare" (/admin/statistiche/da-aggiornare?dal=…&al=…) mostrano
//                     it.admin.common.deletedCustomer, senza link a /admin/clienti/<id>.
//
// Prerequisiti: vedi customer-account-helpers.ts. Date da testDate(); cliente nuovo per il test.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).
// Modifica chiesta dall'utente il 2026-11-23: il messaggio arriva da un cookie usa e getta, non da
// ?account=eliminato; dopo un ricaricamento non c'è più e il link nudo non lo mostra.

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  cleanup,
  clearBookings,
  createBooking,
  expectPath,
  loginAsAdmin,
  romeWinter,
  s,
  testDate,
  uniqueEmail,
  uniqueName,
} from './admin-helpers';
import {
  PHONE_VIEWPORT,
  authUserIdByEmail,
  deleteAuthUser,
  loginWithCodeFromCurrentPage,
  serviceGet,
  signUpCustomer,
  type NewCustomer,
} from './customer-account-helpers';

test.use({ viewport: PHONE_VIEWPORT });

const main = (page: Page): Locator => page.locator('main');
const customerLinks = (page: Page): Locator => main(page).locator('a[href^="/admin/clienti/"]');

type BookingRow = { id: string; status: string; customer_id: string | null; notes: string | null; guest_name: string | null };

test('il cliente elimina l\'account in due passi: futura cancellata, passata anonima, l\'admin vede "Cliente eliminato"', async ({
  page,
  browser,
}) => {
  const api = await adminApi(page.request);
  const bookings: string[] = [];
  const email = uniqueEmail('elimina-9b');
  let customer: NewCustomer | undefined;
  let reRegistered: string | null = null;
  const pastDay = testDate({ fromYear: 2012, toYear: 2023 });
  const futureDay = testDate();
  await clearBookings(api, [SEED.luca], pastDay, futureDay);

  try {
    customer = await signUpCustomer(page, { email, fullName: uniqueName('Da eliminare') });

    // Una passata ancora da chiudere (compare in "Da aggiornare") con nota e nota staff, e una futura
    const [past] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
      customer_id: customer.id,
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(pastDay, '10:00'),
      source: 'online',
      status: 'confirmed',
      notes: 'Nota del cliente E2E',
    });
    const [future] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
      customer_id: customer.id,
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(futureDay, '10:00'),
      source: 'online',
      status: 'confirmed',
      notes: 'Nota futura E2E',
    });
    const pastId = past?.id ?? '';
    const futureId = future?.id ?? '';
    bookings.push(pastId, futureId);
    await api.post('/rest/v1/booking_staff_notes?select=booking_id', { booking_id: pastId, note: 'Nota staff E2E' });

    // Primo passo: riepilogo di cosa succede, nessuna eliminazione con un solo tocco
    await page.goto('/profilo');
    await main(page).getByRole('link', { name: s('profile.deleteAccount'), exact: true }).click();
    await expectPath(page, '/profilo/elimina');
    await expect(page.getByRole('heading', { name: s('profile.deletion.title') })).toBeVisible();
    for (const key of ['futureBookings', 'pastBookings', 'account', 'irreversible']) {
      await expect(main(page).getByText(s(`profile.deletion.${key}`))).toBeVisible();
    }
    const confirm = main(page).getByRole('button', { name: s('profile.deletion.confirm'), exact: true });
    await expect(confirm).toHaveCount(0);

    // Secondo passo separato
    await main(page).getByRole('button', { name: s('profile.deletion.proceed'), exact: true }).click();
    await expect(confirm).toBeVisible();
    expect(await authUserIdByEmail(page.request, email), 'il primo passo non elimina nulla').toBe(customer.id);
    await confirm.click();

    // Ritorno alla home con il messaggio, sessione chiusa
    await expectPath(page, '/');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByText(s('home.accountDeleted'))).toBeVisible();
    // Usa e getta: cancellato dopo la prima lettura
    await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === 'account_deleted')).toBe(false);
    await page.reload();
    await expect(page.getByText(s('home.accountDeleted'))).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('link', { name: s('nav.login'), exact: true })).toBeVisible();
    await expect(page.locator('form').getByRole('button', { name: s('auth.logout'), exact: true })).toHaveCount(0);
    await page.goto('/profilo');
    await expectPath(page, '/accedi');

    // Database: utente eliminato, futura cancellata, tutto anonimo
    expect(await authUserIdByEmail(page.request, email)).toBeNull();
    const rows = await serviceGet<BookingRow[]>(
      page.request,
      `/rest/v1/bookings?select=id,status,customer_id,notes,guest_name&id=in.(${pastId},${futureId})`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(futureId)).toMatchObject({ status: 'cancelled_by_customer', customer_id: null, notes: null, guest_name: null });
    expect(byId.get(pastId)).toMatchObject({ status: 'confirmed', customer_id: null, notes: null, guest_name: null });
    expect(
      await serviceGet<unknown[]>(page.request, `/rest/v1/booking_staff_notes?select=booking_id&booking_id=eq.${pastId}`),
    ).toHaveLength(0);

    // SPEC §3.7.1: l'orario della futura è di nuovo libero
    bookings.push(
      await createBooking(api, { barberId: SEED.luca, serviceId: SEED.taglio, startsAt: romeWinter(futureDay, '10:00') }),
    );

    // Stessa email: si riparte da zero, dal completamento del profilo (con il link all'informativa)
    await page.goto('/accedi');
    await loginWithCodeFromCurrentPage(page, email);
    await expectPath(page, '/profilo/completa');
    await expect(main(page).locator('a[href="/privacy"]').first()).toBeVisible();
    reRegistered = await authUserIdByEmail(page.request, email);
    expect(reRegistered).not.toBeNull();
    expect(reRegistered).not.toBe(customer.id);

    // L'admin vede la passata come "Cliente eliminato", senza link alla scheda cliente
    const adminContext = await browser.newContext({ viewport: DESKTOP });
    try {
      const admin = await adminContext.newPage();
      await loginAsAdmin(admin);

      await admin.goto(`/admin?data=${pastDay}&vista=giorno`);
      const card = main(admin).locator(`a[href="/admin/calendario/${pastId}"]`);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(s('admin.common.deletedCustomer'));
      await card.click();
      await expectPath(admin, `/admin/calendario/${pastId}`);
      await expect(main(admin).getByText(s('admin.common.deletedCustomer')).first()).toBeVisible();
      await expect(customerLinks(admin)).toHaveCount(0);

      await admin.goto(`/admin/statistiche/da-aggiornare?dal=${pastDay}&al=${pastDay}`);
      const row = main(admin).getByRole('row').filter({ has: admin.locator(`a[href="/admin/calendario/${pastId}"]`) });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(s('admin.common.deletedCustomer'));
      await expect(customerLinks(admin)).toHaveCount(0);
    } finally {
      await adminContext.close();
    }
  } finally {
    await cleanup(api, { bookings });
    await deleteAuthUser(page.request, reRegistered);
    await deleteAuthUser(page.request, customer?.id);
  }
});

test('il link nudo /?account=eliminato non mostra il messaggio di account eliminato', async ({ page }) => {
  await page.goto('/?account=eliminato');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(s('home.accountDeleted'))).toHaveCount(0);
});
