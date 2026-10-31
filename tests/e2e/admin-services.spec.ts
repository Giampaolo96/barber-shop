// Test di accettazione e2e – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze,
// chiusure" – fatta quando: "CRUD completi"). Sezione Servizi.
// Sezioni: SPEC §3.2 (prezzo in centesimi, servizio disattivato), §6.4 (CRUD, ordinamento,
// attivazione), §9 (formato it-IT), §12 ("Servizio disattivato con prenotazioni future già
// esistenti") + decisioni approvate per la fetta 3 (punto E).
// Contratto dell'interfaccia (decisione fetta 3):
// - /admin/servizi elenca i servizi in una tabella, una riga per servizio, nell'ordine di
//   sort_order; ogni riga mostra nome e prezzo (formatCents) e, se disattivato,
//   it.admin.common.inactive; azioni di riga: link it.admin.common.edit, pulsanti
//   it.admin.common.moveUp / moveDown / delete.
// - "Nuovo servizio" (it.admin.services.new) apre il modulo con le etichette it.admin.services.*;
//   si salva con it.admin.common.save; errori di validazione con it.admin.common.invalid.
// - Dopo il salvataggio si torna (o si può tornare) all'elenco /admin/servizi.
// Date da testDate() e pulizia prima di creare le prenotazioni: modificato con l'approvazione dell'utente.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test } from '@playwright/test';
import {
  DESKTOP,
  SEED,
  acceptDialogs,
  adminApi,
  bookingStatuses,
  cleanup,
  createBarber,
  createBooking,
  createService,
  disableNativeValidation,
  euro,
  expectPath,
  field,
  linkOrButton,
  loginAsAdmin,
  loginAsBarber,
  romeWinter,
  rowWith,
  s,
  saveButton,
  sf,
  testDate,
  clearBookings,
  uniqueName,
} from './admin-helpers';

type ServiceRow = { id: string; name: string; description: string | null; duration_min: number; price_cents: number; is_active: boolean };

test.describe('Admin – servizi (SPEC §6.4)', () => {
  test.use({ viewport: DESKTOP });

  test('crea, modifica, disattiva ed elimina un servizio senza prenotazioni', async ({ page }) => {
    acceptDialogs(page);
    const api = await adminApi(page.request);
    const name = uniqueName('Servizio');
    const renamed = `${name} bis`;
    const findByName = (value: string) =>
      api.get<ServiceRow[]>(
        `/rest/v1/services?select=id,name,description,duration_min,price_cents,is_active&name=eq.${encodeURIComponent(value)}`,
      );

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/servizi');
      await expectPath(page, '/admin/servizi');
      await expect(page.getByRole('heading', { name: s('admin.nav.services') })).toBeVisible();

      // Creazione – SPEC §3.2: prezzo inserito in euro, salvato in centesimi
      await linkOrButton(page, s('admin.services.new')).click();
      await field(page, 'admin.services.nameLabel').fill(name);
      await field(page, 'admin.services.descriptionLabel').fill('Creato dal test e2e');
      await field(page, 'admin.services.durationLabel').fill('30');
      await field(page, 'admin.services.priceLabel').fill('12,50');
      await expect(field(page, 'admin.services.activeLabel')).toBeChecked();
      await saveButton(page).click();

      await expect.poll(async () => (await findByName(name)).length, { message: 'servizio non salvato' }).toBe(1);
      const [created] = await findByName(name);
      expect(created).toMatchObject({ duration_min: 30, price_cents: 1250, is_active: true, description: 'Creato dal test e2e' });

      // SPEC §9: prezzo mostrato in formato it-IT
      await page.goto('/admin/servizi');
      await expect(rowWith(page, name)).toHaveCount(1);
      await expect(rowWith(page, name)).toContainText(euro('12,50 €'));
      await expect(rowWith(page, name)).not.toContainText(s('admin.common.inactive'));

      // Modifica
      await rowWith(page, name).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
      await expect(field(page, 'admin.services.nameLabel')).toHaveValue(name);
      await expect(field(page, 'admin.services.priceLabel')).toHaveValue(/^12[,.]50?$/);
      await field(page, 'admin.services.nameLabel').fill(renamed);
      await field(page, 'admin.services.priceLabel').fill('15');
      await field(page, 'admin.services.durationLabel').fill('45');
      await saveButton(page).click();
      await expect.poll(async () => (await findByName(renamed))[0]?.price_cents, { message: 'modifica non salvata' }).toBe(1500);
      expect((await findByName(renamed))[0]?.duration_min).toBe(45);
      await page.goto('/admin/servizi');
      await expect(rowWith(page, renamed)).toContainText(euro('15,00 €'));

      // Disattivazione – SPEC §3.2: "non più prenotabile"; resta nell'elenco dell'admin
      await rowWith(page, renamed).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
      await field(page, 'admin.services.activeLabel').uncheck();
      await saveButton(page).click();
      await expect.poll(async () => (await findByName(renamed))[0]?.is_active, { message: 'disattivazione non salvata' }).toBe(false);
      await page.goto('/admin/servizi');
      await expect(rowWith(page, renamed)).toContainText(s('admin.common.inactive'));

      // Eliminazione di un servizio senza prenotazioni
      await rowWith(page, renamed).getByRole('button', { name: s('admin.common.delete'), exact: true }).click();
      await expect(rowWith(page, renamed)).toHaveCount(0);
      await expect.poll(async () => (await findByName(renamed)).length, { message: 'servizio non eliminato' }).toBe(0);
    } finally {
      const leftovers = [...(await findByName(name)), ...(await findByName(renamed))].map((row) => row.id);
      await cleanup(api, { services: leftovers });
    }
  });

  // CLAUDE.md – Sicurezza: input validato lato server; CLAUDE.md regola 3: niente importi ambigui
  test('prezzo non valido o nome vuoto: errore e nessun servizio salvato', async ({ page }) => {
    const api = await adminApi(page.request);
    const name = uniqueName('Prezzo errato');
    await loginAsAdmin(page);
    await page.goto('/admin/servizi');
    await linkOrButton(page, s('admin.services.new')).click();

    // Ogni tentativo riempie tutti i campi: solo quello indicato non è valido
    for (const [price, duration, label] of [
      ['12,505', '30', 'prezzo con tre decimali'],
      ['-5', '30', 'prezzo negativo'],
      ['dodici', '30', 'prezzo testuale'],
      ['12,50', '0', 'durata zero'],
    ] as const) {
      await field(page, 'admin.services.nameLabel').fill(name);
      await field(page, 'admin.services.durationLabel').fill(duration);
      await field(page, 'admin.services.priceLabel').fill(price);
      await disableNativeValidation(page);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.invalid')), `nessun errore per ${label}`).toBeVisible();
      expect(await api.get(`/rest/v1/services?select=id&name=eq.${encodeURIComponent(name)}`)).toEqual([]);
    }

    const rows = await api.get(`/rest/v1/services?select=id&name=eq.${encodeURIComponent(name)}`);
    expect(rows).toEqual([]);
  });

  // SPEC §6.4: "ordinamento"
  test('riordina due servizi con "su" e "giù" e l\'ordine resta dopo il ricaricamento', async ({ page }) => {
    const api = await adminApi(page.request);
    // sort_order alti e consecutivi: nessun altro servizio sta fra i due
    const base = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const first = uniqueName('Ordine A');
    const second = uniqueName('Ordine B');
    const firstId = await createService(api, { name: first, sortOrder: base });
    const secondId = await createService(api, { name: second, sortOrder: base + 1 });

    const rowIndex = async (name: string): Promise<number> => {
      const texts = await page.locator('main').getByRole('row').allInnerTexts();
      return texts.findIndex((text) => text.includes(name));
    };
    const expectOrder = async (before: string, after: string): Promise<void> => {
      await expect
        .poll(async () => {
          const a = await rowIndex(before);
          const b = await rowIndex(after);
          return a >= 0 && b >= 0 && a < b;
        }, { message: `"${before}" deve precedere "${after}"` })
        .toBe(true);
    };

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/servizi');
      await expectOrder(first, second);

      await rowWith(page, first).getByRole('button', { name: s('admin.common.moveDown'), exact: true }).click();
      await expectOrder(second, first);
      await page.reload();
      await expectOrder(second, first);

      await rowWith(page, first).getByRole('button', { name: s('admin.common.moveUp'), exact: true }).click();
      await expectOrder(first, second);
      await page.reload();
      await expectOrder(first, second);

      const order = await api.get<Array<{ id: string }>>(
        `/rest/v1/services?select=id&id=in.(${firstId},${secondId})&order=sort_order`,
      );
      expect(order.map((row) => row.id)).toEqual([firstId, secondId]);
    } finally {
      await cleanup(api, { services: [firstId, secondId] });
    }
  });

  // ADR 001: "Servizi e barbieri con prenotazioni si disattivano, non si eliminano"
  test('eliminare un servizio con prenotazioni mostra un messaggio che suggerisce di disattivarlo', async ({ page }) => {
    acceptDialogs(page);
    const api = await adminApi(page.request);
    const name = uniqueName('Con prenotazioni');
    const serviceId = await createService(api, { name, durationMin: 20 });
    const barberId = await createBarber(api, uniqueName('Barbiere servizio'), [serviceId]);
    const date = testDate();
    await clearBookings(api, [barberId], date);
    const bookingId = await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '10:00') });

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/servizi');
      await rowWith(page, name).getByRole('button', { name: s('admin.common.delete'), exact: true }).click();

      await expect(page.getByText(s('admin.services.deleteHasBookings'))).toBeVisible();
      await page.reload();
      await expect(rowWith(page, name)).toHaveCount(1);
      const rows = await api.get(`/rest/v1/services?select=id&id=eq.${serviceId}`);
      expect(rows).toHaveLength(1);
      expect(await bookingStatuses(api, [bookingId])).toEqual(['confirmed']);
    } finally {
      await cleanup(api, { barbers: [barberId], services: [serviceId] });
    }
  });

  // SPEC §12 + decisione fetta 3: avviso con il numero di prenotazioni, nessuna cancellazione
  test('disattivare un servizio con prenotazioni future avvisa col numero e non le cancella', async ({ page }) => {
    const api = await adminApi(page.request);
    const name = uniqueName('Da disattivare');
    const serviceId = await createService(api, { name, durationMin: 20, priceCents: 1800 });
    const barberId = await createBarber(api, uniqueName('Barbiere disattivazione'), [serviceId, SEED.taglio]);
    const date = testDate();
    await clearBookings(api, [barberId], date);
    const bookings = [
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '10:00') }),
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '15:00') }),
    ];
    // Non vanno contate (decisione fetta 3: solo confirmed con starts_at > now): un altro servizio,
    // una cancellata, una passata ancora confirmed
    const other = await createBooking(api, { barberId, serviceId: SEED.taglio, startsAt: romeWinter(date, '17:00') });
    await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '16:00'), status: 'cancelled_by_shop' });
    await createBooking(api, { barberId, serviceId, startsAt: '2024-01-16T10:00:00+01:00' });

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/servizi');
      await rowWith(page, name).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
      await field(page, 'admin.services.activeLabel').uncheck();
      await saveButton(page).click();

      await expect(page.getByText(sf('admin.services.deactivatedWithBookings', { count: 2 }))).toBeVisible();
      const [service] = await api.get<ServiceRow[]>(`/rest/v1/services?select=is_active&id=eq.${serviceId}`);
      expect(service?.is_active).toBe(false);
      expect(await bookingStatuses(api, bookings)).toEqual(['confirmed', 'confirmed']);
      expect(await bookingStatuses(api, [other])).toEqual(['confirmed']);
      // SPEC §3.6: prezzo e durata copiati non cambiano
      const copied = await api.get<Array<{ price_cents: number; duration_min: number }>>(
        `/rest/v1/bookings?select=price_cents,duration_min&id=in.(${bookings.join(',')})`,
      );
      expect(copied).toEqual([
        { price_cents: 1800, duration_min: 20 },
        { price_cents: 1800, duration_min: 20 },
      ]);
    } finally {
      await cleanup(api, { barbers: [barberId], services: [serviceId] });
    }
  });

  // SPEC §2: i servizi sono solo dell'admin
  test('il barbiere non raggiunge /admin/servizi', async ({ page }) => {
    await loginAsBarber(page);
    await page.goto('/admin/servizi');
    await expectPath(page, '/admin');
    await expect(linkOrButton(page, s('admin.services.new'))).toHaveCount(0);
  });
});
