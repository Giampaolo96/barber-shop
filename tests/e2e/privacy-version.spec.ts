// Test di accettazione e2e – FETTA 9b "Privacy e account del cliente" (SPEC §11 riga 9b: "nuovo
// consenso quando cambia la versione dell'informativa ... senza il nuovo consenso il cliente vede e
// cancella le sue prenotazioni ma non ne crea di nuove"; SPEC §3.1, §8; decisione A).
//
// Cambia shop_settings.privacy_policy_version, condivisa da tutti: gira nel progetto Playwright
// `privacy-version`, dopo `admin-settings` (quindi dopo tutti gli altri), in modalità seriale.
// afterAll ripristina SEMPRE la versione originale con la service role, anche se il test fallisce.
//
// Rotte e testi attesi (src/i18n/it.ts):
//   /admin/impostazioni  campo it.admin.settings.privacyPolicyVersionLabel modificabile; con una versione
//                        diversa "Salva" (it.admin.common.save) apre un alertdialog con
//                        it.admin.settings.privacyVersionChangeWarning e il pulsante
//                        it.admin.settings.privacyVersionChangeConfirm; solo dopo la conferma si salva.
//   /profilo/consenso?next=<percorso>  link a /privacy, casella it.auth.reconsent.checkboxLabel
//                        obbligatoria, pulsante it.auth.reconsent.submit; dopo torna a `next`.
//
// Prerequisiti: vedi customer-account-helpers.ts. Cliente nuovo creato prima del cambio di versione.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, request as playwrightRequest, test, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  acceptDialogs,
  adminApi,
  cleanup,
  createService,
  disableNativeValidation,
  expectPath,
  field,
  loginAsAdmin,
  romeWinter,
  s,
  saveButton,
  testDate,
  uniqueEmail,
  uniqueName,
} from './admin-helpers';
import {
  currentPolicyVersion,
  deleteAuthUser,
  profileOf,
  servicePatch,
  signUpCustomer,
} from './customer-account-helpers';

test.describe.configure({ mode: 'serial' });

let originalVersion: string | null = null;
const created: { customerId: string | null; services: string[]; bookings: string[] } = {
  customerId: null,
  services: [],
  bookings: [],
};

test.beforeAll(async () => {
  const context = await playwrightRequest.newContext();
  try {
    originalVersion = await currentPolicyVersion(context);
  } finally {
    await context.dispose();
  }
});

test.afterAll(async () => {
  const context = await playwrightRequest.newContext();
  try {
    // Prima di tutto la versione: gli altri giri ne dipendono.
    if (originalVersion !== null) {
      await servicePatch(context, '/rest/v1/shop_settings?id=eq.true', { privacy_policy_version: originalVersion });
    }
    const api = await adminApi(context);
    await cleanup(api, { bookings: created.bookings, services: created.services });
    await deleteAuthUser(context, created.customerId);
  } finally {
    await context.dispose();
  }
});

const main = (page: Page): Locator => page.locator('main');

test('nuova versione dell\'informativa: il cliente gestisce le sue prenotazioni ma per prenotare deve accettarla di nuovo', async ({
  page,
  browser,
}) => {
  expect(originalVersion, 'versione originale letta in beforeAll').not.toBeNull();
  acceptDialogs(page);
  const api = await adminApi(page.request);

  // Cliente con il consenso alla versione attuale e il marketing attivo
  const customer = await signUpCustomer(page, {
    email: uniqueEmail('riconsenso'),
    fullName: uniqueName('Riconsenso'),
    marketing: true,
  });
  created.customerId = customer.id;
  const before = await profileOf(page.request, customer.id);
  expect(before?.privacy_policy_version).toBe(originalVersion);
  expect(before?.marketing_consent).toBe(true);

  // Una prenotazione futura da cancellare da "Le mie prenotazioni"
  const serviceName = uniqueName('Riconsenso servizio');
  const serviceId = await createService(api, { name: serviceName, durationMin: 30 });
  created.services.push(serviceId);
  await api.post('/rest/v1/barber_services?select=barber_id', { barber_id: SEED.luca, service_id: serviceId });
  const [booking] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    customer_id: customer.id,
    barber_id: SEED.luca,
    service_id: serviceId,
    starts_at: romeWinter(testDate(), '10:00'),
    source: 'online',
    status: 'confirmed',
  });
  created.bookings.push(booking?.id ?? '');

  // L'admin pubblica una nuova versione da Impostazioni, con l'avviso di conferma
  const newVersion = `e2e-${Date.now().toString(36)}`;
  const adminContext = await browser.newContext({ viewport: DESKTOP });
  try {
    const admin = await adminContext.newPage();
    await loginAsAdmin(admin);
    await admin.goto('/admin/impostazioni');
    const version = field(admin, 'admin.settings.privacyPolicyVersionLabel');
    await expect(version).toHaveValue(originalVersion ?? '');
    await expect(version).toBeEditable();
    await version.fill(newVersion);
    await saveButton(admin).click();

    const dialog = admin.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(s('admin.settings.privacyVersionChangeWarning'));
    // Prima della conferma non si salva nulla
    expect(await currentPolicyVersion(page.request)).toBe(originalVersion);
    await dialog.getByRole('button', { name: s('admin.settings.privacyVersionChangeConfirm'), exact: true }).click();
    await expect(admin.getByText(s('admin.common.saved'))).toBeVisible();
    await expect.poll(() => currentPolicyVersion(page.request)).toBe(newVersion);
  } finally {
    await adminContext.close();
  }

  // Senza il nuovo consenso: niente flusso di prenotazione...
  await page.goto('/prenota');
  await expectPath(page, '/profilo/consenso');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/prenota');
  await expect(main(page).locator('a[href="/privacy"]').first()).toBeVisible();

  // ...ma le sue prenotazioni le vede e le cancella
  await page.goto('/prenotazioni');
  await expectPath(page, '/prenotazioni');
  const item = main(page).getByRole('listitem').filter({ hasText: serviceName });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: s('booking.list.cancel'), exact: true }).click();
  await expect(page.getByText(s('booking.list.cancelled'))).toBeVisible();
  await expect
    .poll(async () => (await api.get<Array<{ status: string }>>(`/rest/v1/bookings?select=status&id=eq.${booking?.id}`))[0]?.status)
    .toBe('cancelled_by_customer');

  // Il profilo resta raggiungibile
  await page.goto('/profilo');
  await expectPath(page, '/profilo');

  // Dal flusso di prenotazione, con i parametri: nuovo consenso e ritorno lì
  const target = `/prenota/quando?servizio=${SEED.taglio}`;
  await page.goto(target);
  await expectPath(page, '/profilo/consenso');
  expect(new URL(page.url()).searchParams.get('next')).toBe(target);

  // La casella è obbligatoria (controllo lato server)
  await disableNativeValidation(page);
  const checkbox = main(page).getByLabel(s('auth.reconsent.checkboxLabel'), { exact: true });
  await expect(checkbox).not.toBeChecked();
  await main(page).getByRole('button', { name: s('auth.reconsent.submit'), exact: true }).click();
  await expect(main(page).getByText(s('auth.reconsent.invalid'))).toBeVisible();
  expect((await profileOf(page.request, customer.id))?.privacy_policy_version).toBe(originalVersion);

  await checkbox.check();
  await main(page).getByRole('button', { name: s('auth.reconsent.submit'), exact: true }).click();
  await expectPath(page, '/prenota/quando');
  expect(new URL(page.url()).searchParams.get('servizio')).toBe(SEED.taglio);

  // Consenso alla nuova versione con la data del database; il marketing resta com'era
  const after = await profileOf(page.request, customer.id);
  expect(after?.privacy_policy_version).toBe(newVersion);
  expect(new Date(after?.privacy_consent_at ?? 0).getTime()).toBeGreaterThan(
    new Date(before?.privacy_consent_at ?? 0).getTime(),
  );
  expect(after?.marketing_consent).toBe(true);
  expect(after?.marketing_consent_at).toBe(before?.marketing_consent_at);

  // Consenso di nuovo valido: la pagina del consenso rimanda alla home, /prenota è aperta
  await page.goto('/profilo/consenso');
  await expectPath(page, '/');
  await page.goto('/prenota');
  await expectPath(page, '/prenota');
});
