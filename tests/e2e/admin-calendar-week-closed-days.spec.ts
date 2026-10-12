// Vista settimana senza i giorni di chiusura settimanale fissa (modifica della fetta 8c, SPEC §6.1,
// ADR 008): una colonna non si disegna se il negozio non ha orari in quel giorno della settimana
// (shop_opening_hours), salvo prenotazioni da mostrare in quella data. URL e navigazione restano da
// lunedì a domenica. I casi limite sono in tests/acceptance/calendar-week-closed-days.test.ts.
//
// Prerequisiti: Supabase locale con il seed. Orari del seed: martedì–sabato (lunedì e domenica chiusi).
// Dati unici per test (nomi degli ospiti e settimane casuali d'inverno), creati e rimossi con l'API
// dell'admin demo.

import { expect, test, type Page } from '@playwright/test';

import { DESKTOP, SEED, adminApi, cleanup, loginAsAdmin, plusDays, romeWinter, uniqueName } from './admin-helpers';

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/** Lunedì di una settimana futura di gennaio/febbraio, diversa da quelle degli altri spec della settimana. */
const futureWinterMonday = (): string => {
  const day = new Date(Date.UTC(randomInt(2050, 2069), randomInt(0, 1), randomInt(5, 22), 12));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
};

const weekUrl = (date: string): string => `/admin?data=${date}&vista=settimana&barbiere=${SEED.luca}`;

const columnDates = (page: Page): Promise<string[]> =>
  page.locator('main [data-date]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-date') ?? ''));

test.describe('Vista settimana senza giorni di chiusura fissa (SPEC §6.1)', () => {
  test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false });

  test('con gli orari del seed 5 colonne da martedì a sabato, senza scorrimento orizzontale', async ({ page }) => {
    const mon = futureWinterMonday();
    await loginAsAdmin(page);
    await page.goto(weekUrl(plusDays(mon, 3)));

    await expect(page.locator('main [data-date]')).toHaveCount(5);
    expect(await columnDates(page)).toEqual([1, 2, 3, 4, 5].map((offset) => plusDays(mon, offset)));

    // Su desktop le colonne visibili stanno tutte nel contenitore, e la pagina non scorre di lato
    const scroller = page.locator('main [data-week-scroll]');
    expect(await scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('una prenotazione di lunedì fa comparire la colonna del lunedì', async ({ page }) => {
    const api = await adminApi(page.request);
    const mon = futureWinterMonday();
    const guestName = uniqueName('Ospite del lunedì');
    const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
      guest_name: guestName,
      guest_phone: '+393330000881',
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(mon, '10:00'),
      source: 'manual',
      status: 'confirmed',
    });
    const id = rows[0]?.id ?? '';

    try {
      await loginAsAdmin(page);
      await page.goto(weekUrl(mon));

      await expect(page.locator('main [data-date]')).toHaveCount(6);
      expect(await columnDates(page)).toEqual([0, 1, 2, 3, 4, 5].map((offset) => plusDays(mon, offset)));
      await expect(page.locator('main').getByRole('link', { name: new RegExp(guestName) })).toHaveCount(1);
    } finally {
      await cleanup(api, { bookings: [id] });
    }
  });
});
