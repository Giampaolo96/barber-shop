// Test di accettazione e2e – FETTA 3 (SPEC §11). Il barbiere gestisce le proprie assenze.
// Sezioni: SPEC §2 (il barbiere "gestisce le proprie assenze (senza approvazione dell'admin)"),
// §3.5, §3.7.4 (nessun dato altrui), §13.4 (nessuna approvazione) + decisioni approvate per la
// fetta 3 (punti B ed E): nuova rotta /admin/assenze, voce di menu it.admin.nav.timeOff.
// Il modulo e l'elenco seguono il contratto descritto in tests/e2e/admin-periods.spec.ts.
// Utente: barber@demo.local (scheda "Luca" del seed). Ogni test usa motivi e date univoci.
// Date da testDate() e pulizia prima di creare le prenotazioni: modificato con l'approvazione dell'utente.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP,
  SEED,
  acceptDialogs,
  adminApi,
  adminNavLink,
  cleanup,
  createBooking,
  expectPath,
  field,
  instant,
  itDate,
  loginAsBarber,
  romeWinter,
  rowWith,
  s,
  clearBookings,
  saveButton,
  sf,
  testDate,
  uniqueName,
} from './admin-helpers';

type TimeOffRow = { id: string; barber_id: string; starts_at: string; ends_at: string; reason: string | null };

const timeOffByReason = (api: Awaited<ReturnType<typeof adminApi>>, reason: string) =>
  api.get<TimeOffRow[]>(
    `/rest/v1/time_off?select=id,barber_id,starts_at,ends_at,reason&reason=eq.${encodeURIComponent(reason)}`,
  );

const fillTimed = async (page: Page, start: string, end: string, reason: string): Promise<void> => {
  await page.getByRole('radio', { name: s('admin.period.timed'), exact: true }).check();
  await field(page, 'admin.period.startLabel').fill(start);
  await field(page, 'admin.period.endLabel').fill(end);
  await field(page, 'admin.period.reasonLabel').fill(reason);
};

test.describe('Barbiere – le proprie assenze (SPEC §2, §3.5)', () => {
  test.use({ viewport: DESKTOP });

  test('vede "Assenze" nel menu e crea, modifica ed elimina una propria assenza', async ({ page }) => {
    acceptDialogs(page);
    const api = await adminApi(page.request);
    const date = testDate();
    await clearBookings(api, [SEED.luca], date);
    const reason = uniqueName('Permesso barbiere');
    const renamed = `${reason} bis`;
    // Una propria prenotazione confermata dentro l'assenza: l'avviso vale anche per il barbiere
    const booking = await createBooking(api, { barberId: SEED.luca, serviceId: SEED.taglio, startsAt: romeWinter(date, '14:30') });

    try {
      await loginAsBarber(page);
      await expect(adminNavLink(page, 'admin.nav.timeOff')).toBeVisible();
      await adminNavLink(page, 'admin.nav.timeOff').click();
      await expectPath(page, '/admin/assenze');
      await expect(page.getByRole('heading', { name: s('admin.nav.timeOff') })).toBeVisible();

      // Creazione (SPEC §13.4: nessuna approvazione, valida subito)
      await fillTimed(page, `${date}T14:00`, `${date}T16:00`, reason);
      await saveButton(page).click();
      // Decisione fetta 3 (utente): avviso anche quando l'assenza la inserisce il barbiere
      // Decisione fetta 3 (utente, dopo la review): con una sola prenotazione il testo è al singolare
      await expect(page.getByText(sf('admin.period.overlapsBookingsOne', { count: 1 }))).toBeVisible();
      const row = rowWith(page, reason);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(itDate(date));
      await expect(row).toContainText('14:00');
      await expect(row).toContainText('16:00');

      const [saved] = await timeOffByReason(api, reason);
      expect(saved?.barber_id, 'l\'assenza deve essere sulla scheda del barbiere collegato (Luca)').toBe(SEED.luca);
      expect(instant(saved?.starts_at ?? '')).toBe(instant(romeWinter(date, '14:00')));
      expect(instant(saved?.ends_at ?? '')).toBe(instant(romeWinter(date, '16:00')));

      // Modifica
      await row.getByRole('link', { name: s('admin.common.edit'), exact: true })
        .or(row.getByRole('button', { name: s('admin.common.edit'), exact: true }))
        .click();
      await expect(field(page, 'admin.period.reasonLabel')).toHaveValue(reason);
      await field(page, 'admin.period.endLabel').fill(`${date}T17:30`);
      await field(page, 'admin.period.reasonLabel').fill(renamed);
      await saveButton(page).click();
      // Si aspetta l'esito del salvataggio prima di lasciare la pagina (approvato dall'utente)
      await expect(page.getByText(s('admin.common.saved'))).toBeVisible();
      await page.goto('/admin/assenze');
      await expect(rowWith(page, renamed)).toHaveCount(1);
      await expect(rowWith(page, renamed)).toContainText('17:30');
      const [edited] = await timeOffByReason(api, renamed);
      expect(edited?.id).toBe(saved?.id);
      expect(edited?.barber_id).toBe(SEED.luca);
      expect(instant(edited?.ends_at ?? '')).toBe(instant(romeWinter(date, '17:30')));

      // Eliminazione
      await rowWith(page, renamed).getByRole('button', { name: s('admin.common.delete'), exact: true }).click();
      await expect(rowWith(page, renamed)).toHaveCount(0);
      await expect.poll(async () => (await timeOffByReason(api, renamed)).length).toBe(0);
    } finally {
      await cleanup(api, { bookings: [booking], timeOffReasons: [reason, renamed] });
    }
  });

  // SPEC §2 / §3.7.4: solo le proprie assenze
  test('non vede le assenze degli altri barbieri e non può scegliere un altro barbiere', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = testDate();
    const othersReason = uniqueName('Ferie di Sara');
    await api.post('/rest/v1/time_off?select=id', {
      barber_id: SEED.sara,
      starts_at: romeWinter(date, '09:00'),
      ends_at: romeWinter(date, '13:00'),
      reason: othersReason,
    });

    try {
      await loginAsBarber(page);
      await page.goto('/admin/assenze');
      await expect(page.getByRole('heading', { name: s('admin.nav.timeOff') })).toBeVisible();
      await expect(page.getByText(othersReason)).toHaveCount(0);
      // Nessuna scelta del barbiere nel modulo: l'assenza è sempre sulla propria scheda
      await expect(page.locator('main').getByRole('combobox')).toHaveCount(0);
      await expect(page.locator('main').getByText('Sara', { exact: true })).toHaveCount(0);
    } finally {
      await cleanup(api, { timeOffReasons: [othersReason] });
    }
  });

  // SPEC §2 + decisione fetta 3: le altre pagine della fetta 3 restano solo-admin
  test('non raggiunge le pagine solo-admin della fetta 3', async ({ page }) => {
    await loginAsBarber(page);
    for (const path of [
      '/admin/servizi',
      '/admin/barbieri',
      `/admin/barbieri/${SEED.luca}`,
      `/admin/barbieri/${SEED.luca}/orari`,
      `/admin/barbieri/${SEED.luca}/assenze`,
      `/admin/barbieri/${SEED.sara}/assenze`,
      '/admin/chiusure',
      '/admin/impostazioni',
    ]) {
      await page.goto(path);
      await expectPath(page, '/admin');
    }
    for (const key of ['admin.nav.services', 'admin.nav.barbers', 'admin.nav.closures', 'admin.nav.settings']) {
      await expect(adminNavLink(page, key)).toHaveCount(0);
    }
  });
});
