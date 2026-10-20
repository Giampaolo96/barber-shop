// Regressioni e2e – statistiche, riquadro "Da aggiornare" ed elenco (richiesta dell'utente dopo la
// fetta 9a; SPEC §6.9, ADR 010).
// Dati: prenotazioni di un ospite su Luca / Taglio create con l'API dell'admin demo come in
// admin-stats.spec.ts, pulizia nel finally. Ogni test ha la sua settimana fissa del 2011 (nessun altro
// e2e usa quell'anno): i due test girano in parallelo e con settimane scelte a caso potevano
// coincidere, così "a zero" vedeva le prenotazioni dell'altro.

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

/** Lunedì delle settimane dei due test: distinte e non sovrapposte. */
const TO_UPDATE_MONDAY = '2011-01-10';
const EMPTY_MONDAY = '2011-01-24';

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

/**
 * Pulizia iniziale: toglie le prenotazioni di prova rimaste nella settimana da un giro interrotto
 * prima del finally, che altrimenti farebbero fallire i conteggi del giro successivo.
 */
const clearWeek = async (api: AdminApi, monday: string): Promise<void> => {
  const from = encodeURIComponent(romeWinter(monday, '00:00'));
  const to = encodeURIComponent(romeWinter(plusDays(monday, 7), '00:00'));
  await api.del(
    `/rest/v1/bookings?guest_name=eq.${encodeURIComponent(GUEST)}&starts_at=gte.${from}&starts_at=lt.${to}`,
  );
};

const toCloseTile = (page: Page) => page.locator('main [data-stat="to-close"]');
const listRows = (page: Page) =>
  page.getByRole('table', { name: s('admin.stats.toUpdate.tableTitle') }).locator('tbody').getByRole('row');

test.describe('Statistiche: "Da aggiornare" (SPEC §6.9)', () => {
  test.use({ viewport: DESKTOP });

  test('il riquadro porta all\'elenco degli appuntamenti passati ancora confermati, con il dettaglio', async ({ page }) => {
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const monday = TO_UPDATE_MONDAY;
    const sunday = plusDays(monday, 6);
    await clearWeek(api, monday);

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
    const monday = EMPTY_MONDAY;
    const sunday = plusDays(monday, 6);
    await clearWeek(await adminApi(page.request), monday);
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
