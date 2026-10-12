// Vista giorno con "mostra cancellate": una cancellata nello stesso orario di una confermata
// (bookings_no_overlap vale solo per le confirmed) non deve restare coperta. Le due schede stanno
// in corsie affiancate, senza intersecarsi, e ognuna apre il proprio dettaglio; a 390 px la corsia
// stretta mostra solo l'ora e il nome (troncato), ma resta cliccabile.

import { expect, test, type Locator, type Page } from '@playwright/test';

import { DESKTOP, SEED, adminApi, cleanup, expectPath, loginAsAdmin, romeWinter, uniqueName, type AdminApi } from './admin-helpers';

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/** Mercoledì futuro di gennaio/febbraio (ora solare, giorno lavorativo per il seed). */
const futureWednesday = (): string => {
  const day = new Date(Date.UTC(randomInt(2032, 2049), randomInt(0, 1), randomInt(5, 25), 12));
  day.setUTCDate(day.getUTCDate() + ((3 - day.getUTCDay() + 7) % 7));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createGuestBooking = async (
  api: AdminApi,
  values: { guestName: string; startsAt: string; status: 'confirmed' | 'cancelled_by_shop' },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: values.guestName,
    guest_phone: '+393330000700',
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status,
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const card = (page: Page, guestName: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(escapeRegExp(guestName)) });

const intersects = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const viewport of [DESKTOP, { width: 390, height: 844 }]) {
  test.describe(`Calendario, cancellata sovrapposta a una confermata (${viewport.width} px)`, () => {
    test.use({ viewport });

    let api: AdminApi;
    const bookings: string[] = [];

    test.beforeEach(async ({ request }) => {
      api = await adminApi(request);
    });

    test.afterEach(async () => {
      await cleanup(api, { bookings: bookings.splice(0) });
    });

    test('con "mostra cancellate" entrambe visibili, affiancate e cliccabili', async ({ page }) => {
      const date = futureWednesday();
      // Orario poco usato dagli altri spec, che girano in parallelo sugli stessi barbieri del seed.
      const startsAt = romeWinter(date, '15:15');
      const cancelledName = uniqueName('Cancellata');
      const confirmedName = uniqueName('Confermata');
      // La cancellata viene creata prima: oggi la confermata, creata dopo, la copriva del tutto.
      const cancelledId = await createGuestBooking(api, { guestName: cancelledName, startsAt, status: 'cancelled_by_shop' });
      bookings.push(cancelledId);
      const confirmedId = await createGuestBooking(api, { guestName: confirmedName, startsAt, status: 'confirmed' });
      bookings.push(confirmedId);

      await loginAsAdmin(page);
      const dayUrl = `/admin?data=${date}&cancellate=1`;
      await page.goto(dayUrl);

      const cancelled = card(page, cancelledName);
      const confirmed = card(page, confirmedName);
      await expect(cancelled).toBeVisible();
      await expect(confirmed).toBeVisible();

      const cancelledBox = await cancelled.boundingBox();
      const confirmedBox = await confirmed.boundingBox();
      expect(cancelledBox).not.toBeNull();
      expect(confirmedBox).not.toBeNull();
      if (!cancelledBox || !confirmedBox) return;
      expect(intersects(cancelledBox, confirmedBox), 'le due schede non devono coprirsi').toBe(false);
      // La confermata sta nella corsia di sinistra.
      expect(confirmedBox.x).toBeLessThan(cancelledBox.x);

      // Corsia stretta (sotto 7rem, il caso normale a 390 px): al posto di orario completo e servizio,
      // solo l'ora d'inizio e il nome. La larghezza dipende dalle colonne mostrate (barbieri attivi).
      const full = cancelled.getByText(/^15:15–15:45 /);
      const compact = cancelled.getByText(new RegExp(`^15:15 ${escapeRegExp(cancelledName)}$`));
      // La container query misura il contenuto della scheda: larghezza meno padding (e bordo).
      const contentWidth = await cancelled.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      if (contentWidth < 7 * 16) {
        await expect(full).toBeHidden();
        await expect(compact).toBeVisible();
      } else {
        await expect(full).toBeVisible();
        await expect(compact).toBeHidden();
      }

      await cancelled.click();
      await expectPath(page, `/admin/calendario/${cancelledId}`);
      await expect(page.locator('main')).toContainText(cancelledName);

      await page.goto(dayUrl);
      await card(page, confirmedName).click();
      await expectPath(page, `/admin/calendario/${confirmedId}`);
      await expect(page.locator('main')).toContainText(confirmedName);
    });
  });
}
