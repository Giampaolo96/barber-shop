// Regressioni e2e – statistiche, riquadro "Da aggiornare" ed elenco (richiesta dell'utente dopo la
// fetta 9a; SPEC §6.9, ADR 010).
// Dati: prenotazioni di un ospite su Luca / Taglio in una settimana di gennaio/febbraio fra il 2011
// e il 2015 scelta a caso (nessun altro e2e usa quegli anni), create con l'API dell'admin demo come
// in admin-stats.spec.ts. Pulizia nel finally.

import { expect, test, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  cleanup,
  expectPath,
  itDate,
  loginAsAdmin,
  loginAsBarber,
  plusDays,
  romeWinter,
  s,
  type AdminApi,
} from './admin-helpers';

type Status = 'confirmed' | 'completed';

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

const isolatedMonday = (): string => {
  const start = `${randomInt(2011, 2015)}-${pad(randomInt(1, 2))}-${pad(randomInt(1, 20))}`;
  const weekday = new Date(`${start}T12:00:00Z`).getUTCDay();
  return plusDays(start, (8 - weekday) % 7);
};

const GUEST = 'E2E Da aggiornare';

const booking = async (api: AdminApi, date: string, time: string, status: Status, notes: string | null = null) => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: GUEST,
    guest_phone: '+393330000000',
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: romeWinter(date, time),
    source: 'manual',
    status,
    notes,
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const toCloseTile = (page: Page) => page.locator('main [data-stat="to-close"]');
const listRows = (page: Page) =>
  page.getByRole('table', { name: s('admin.stats.toUpdate.tableTitle') }).locator('tbody').getByRole('row');

test.describe('Statistiche: "Da aggiornare" (SPEC §6.9)', () => {
  test.use({ viewport: DESKTOP });

  test('il riquadro porta all\'elenco degli appuntamenti passati ancora confermati, con il dettaglio', async ({ page }) => {
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const monday = isolatedMonday();
    const sunday = plusDays(monday, 6);

    try {
      const toUpdate = await booking(api, monday, '10:00', 'confirmed');
      bookings.push(toUpdate);
      bookings.push(await booking(api, plusDays(monday, 1), '11:00', 'confirmed', ' Prenotazione demo '));
      bookings.push(await booking(api, plusDays(monday, 2), '10:00', 'completed'));

      await loginAsAdmin(page);
      await page.goto(`/admin/statistiche?dal=${monday}&al=${sunday}`);
      await expect(toCloseTile(page)).toContainText(s('admin.stats.totals.toClose'));
      await expect(toCloseTile(page)).toContainText(s('admin.stats.totalsHint.toClose'));
      await expect(toCloseTile(page).locator('[data-stat-value]')).toHaveText('2');

      await toCloseTile(page).getByRole('link').click();
      await expectPath(page, '/admin/statistiche/da-aggiornare');
      expect(new URL(page.url()).searchParams.get('dal')).toBe(monday);
      await expect(page.getByRole('heading', { level: 1, name: s('admin.stats.toUpdate.title') })).toBeVisible();
      await expect(listRows(page)).toHaveCount(2);
      const first = listRows(page).first();
      await expect(first).toContainText(itDate(monday));
      await expect(first).toContainText('10:00');
      await expect(first).toContainText(GUEST);

      // Con le demo escluse resta solo l'appuntamento vero
      await page.goto(`/admin/statistiche/da-aggiornare?dal=${monday}&al=${sunday}&escludi_demo=1`);
      await expect(listRows(page)).toHaveCount(1);

      await listRows(page).first().getByRole('link').click();
      await expectPath(page, `/admin/calendario/${toUpdate}`);
    } finally {
      await cleanup(api, { bookings });
    }
  });

  test('a zero il riquadro non è un collegamento e l\'elenco è vuoto', async ({ page }) => {
    const monday = isolatedMonday();
    const sunday = plusDays(monday, 6);
    await loginAsAdmin(page);
    await page.goto(`/admin/statistiche?dal=${monday}&al=${sunday}`);
    await expect(toCloseTile(page).locator('[data-stat-value]')).toHaveText('0');
    await expect(toCloseTile(page).getByRole('link')).toHaveCount(0);

    await page.goto(`/admin/statistiche/da-aggiornare?dal=${monday}&al=${sunday}`);
    await expect(page.getByText(s('admin.stats.toUpdate.empty'))).toBeVisible();
  });

  test('il barbiere non apre l\'elenco', async ({ page }) => {
    await loginAsBarber(page);
    await page.goto('/admin/statistiche/da-aggiornare');
    await expectPath(page, '/admin');
  });
});
