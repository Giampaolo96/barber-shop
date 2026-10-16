// Test di accettazione e2e – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze,
// chiusure" – fatta quando: "CRUD completi"). Sezione Barbieri e orari settimanali.
// Sezioni: SPEC §3.3 (barbieri, servizi abilitati), §3.4 (orari a più fasce, ora locale), §6.5,
// §12 + decisioni approvate per la fetta 3 (punto E).
// Contratto dell'interfaccia (decisione fetta 3):
// - /admin/barbieri: tabella con una riga per barbiere; link di riga it.admin.common.edit;
//   "Nuovo barbiere" (it.admin.barbers.new); modulo con etichette it.admin.barbers.*; i servizi
//   abilitati sono checkbox con il nome del servizio dentro un gruppo (fieldset) intitolato
//   it.admin.barbers.servicesLabel.
// - /admin/barbieri/<id>/orari: un gruppo (fieldset) per giorno intitolato
//   it.admin.hours.weekdays.<1..7>; in ogni gruppo il pulsante it.admin.hours.addSlot aggiunge una
//   fascia con i campi it.admin.hours.startLabel / endLabel (input type="time"); un solo pulsante
//   it.admin.common.save salva tutta la settimana; esito it.admin.common.saved, fasce sovrapposte
//   it.admin.hours.overlap.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP,
  SEED,
  adminApi,
  bookingStatuses,
  cleanup,
  createBarber,
  createBooking,
  createService,
  disableNativeValidation,
  expectPath,
  field,
  linkOrButton,
  loginAsAdmin,
  loginAsBarber,
  randomWinterDate,
  romeWinter,
  rowWith,
  s,
  saveButton,
  sf,
  uniqueName,
} from './admin-helpers';

type BarberRow = { id: string; display_name: string; bio: string | null; is_active: boolean };
type HoursRow = { weekday: number; start_time: string; end_time: string };

const servicesGroup = (page: Page) =>
  page.getByRole('group', { name: s('admin.barbers.servicesLabel'), exact: true });

const dayGroup = (page: Page, weekday: number) =>
  page.getByRole('group', { name: s(`admin.hours.weekdays.${weekday}`), exact: true });

const findBarbers = (api: Awaited<ReturnType<typeof adminApi>>, name: string) =>
  api.get<BarberRow[]>(
    `/rest/v1/barbers?select=id,display_name,bio,is_active&display_name=eq.${encodeURIComponent(name)}`,
  );

const hoursOf = async (api: Awaited<ReturnType<typeof adminApi>>, barberId: string): Promise<string[]> => {
  const rows = await api.get<HoursRow[]>(
    `/rest/v1/working_hours?select=weekday,start_time,end_time&barber_id=eq.${barberId}&order=weekday,start_time`,
  );
  return rows.map((row) => `${row.weekday} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)}`);
};

test.describe('Admin – barbieri (SPEC §6.5)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §3.3: nome, bio, attivo, servizi abilitati (il ritratto: tests/e2e/barber-photo.spec.ts)
  test('crea un barbiere con servizi abilitati, li ritrova modificandolo', async ({ page }) => {
    const api = await adminApi(page.request);
    const name = uniqueName('Barbiere');

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/barbieri');
      await expect(page.getByRole('heading', { name: s('admin.nav.barbers') })).toBeVisible();
      await linkOrButton(page, s('admin.barbers.new')).click();

      await field(page, 'admin.barbers.displayNameLabel').fill(name);
      await field(page, 'admin.barbers.bioLabel').fill('Barbiere creato dal test e2e');
      await servicesGroup(page).getByRole('checkbox', { name: 'Taglio', exact: true }).check();
      await servicesGroup(page).getByRole('checkbox', { name: 'Barba', exact: true }).check();
      await saveButton(page).click();
      // Si aspetta l'esito del salvataggio prima di leggere il DB (approvato dall'utente): la
      // creazione reindirizza alla scheda solo dopo aver salvato anche i servizi abilitati.
      await expect(page).toHaveURL(/\/admin\/barbieri\/[0-9a-f-]{36}$/);

      await expect.poll(async () => (await findBarbers(api, name)).length, { message: 'barbiere non salvato' }).toBe(1);
      const [created] = await findBarbers(api, name);
      expect(created).toMatchObject({ bio:'Barbiere creato dal test e2e', is_active: true });
      const enabled = await api.get<Array<{ service_id: string }>>(
        `/rest/v1/barber_services?select=service_id&barber_id=eq.${created?.id}`,
      );
      expect(enabled.map((row) => row.service_id).sort()).toEqual([SEED.taglio, SEED.barba].sort());

      await page.goto('/admin/barbieri');
      await expect(rowWith(page, name)).toHaveCount(1);
      await rowWith(page, name).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
      await expect(field(page, 'admin.barbers.displayNameLabel')).toHaveValue(name);
      await expect(servicesGroup(page).getByRole('checkbox', { name: 'Taglio', exact: true })).toBeChecked();
      await expect(servicesGroup(page).getByRole('checkbox', { name: 'Barba', exact: true })).toBeChecked();
      await expect(servicesGroup(page).getByRole('checkbox', { name: 'Taglio bambino', exact: true })).not.toBeChecked();

      // Modifica dei servizi abilitati
      await servicesGroup(page).getByRole('checkbox', { name: 'Barba', exact: true }).uncheck();
      await saveButton(page).click();
      await expect
        .poll(async () =>
          (
            await api.get<Array<{ service_id: string }>>(
              `/rest/v1/barber_services?select=service_id&barber_id=eq.${created?.id}`,
            )
          ).map((row) => row.service_id),
        )
        .toEqual([SEED.taglio]);
    } finally {
      await cleanup(api, { barbers: (await findBarbers(api, name)).map((row) => row.id) });
    }
  });

  // SPEC §3.4: "una o più fasce (es. 09:00–13:00 e 15:00–19:30)", in ora locale del negozio
  test('orari a due fasce salvati e ricaricati; fasce sovrapposte rifiutate', async ({ page }) => {
    const api = await adminApi(page.request);
    const barberId = await createBarber(api, uniqueName('Barbiere orari'));

    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/barbieri/${barberId}/orari`);
      await expectPath(page, `/admin/barbieri/${barberId}/orari`);

      const tuesday = dayGroup(page, 2);
      await expect(tuesday.getByLabel(s('admin.hours.startLabel'), { exact: true })).toHaveCount(0);
      await tuesday.getByRole('button', { name: s('admin.hours.addSlot'), exact: true }).click();
      await tuesday.getByRole('button', { name: s('admin.hours.addSlot'), exact: true }).click();
      const starts = tuesday.getByLabel(s('admin.hours.startLabel'), { exact: true });
      const ends = tuesday.getByLabel(s('admin.hours.endLabel'), { exact: true });
      await expect(starts).toHaveCount(2);
      await starts.nth(0).fill('09:00');
      await ends.nth(0).fill('13:00');
      await starts.nth(1).fill('15:00');
      await ends.nth(1).fill('19:30');
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.saved'))).toBeVisible();

      expect(await hoursOf(api, barberId)).toEqual(['2 09:00-13:00', '2 15:00-19:30']);

      // Ricaricando la pagina le fasce sono quelle salvate
      await page.reload();
      await expect(starts).toHaveCount(2);
      await expect(starts.nth(0)).toHaveValue(/^09:00/);
      await expect(ends.nth(0)).toHaveValue(/^13:00/);
      await expect(starts.nth(1)).toHaveValue(/^15:00/);
      await expect(ends.nth(1)).toHaveValue(/^19:30/);
      await expect(dayGroup(page, 1).getByLabel(s('admin.hours.startLabel'), { exact: true })).toHaveCount(0);

      // Fascia sovrapposta nello stesso giorno: errore e nessuna modifica
      await tuesday.getByRole('button', { name: s('admin.hours.addSlot'), exact: true }).click();
      await expect(starts).toHaveCount(3);
      await starts.nth(2).fill('12:00');
      await ends.nth(2).fill('14:00');
      await disableNativeValidation(page);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.hours.overlap'))).toBeVisible();
      expect(await hoursOf(api, barberId)).toEqual(['2 09:00-13:00', '2 15:00-19:30']);
      await page.reload();
      await expect(starts).toHaveCount(2);

      // Fine prima dell'inizio: errore
      await dayGroup(page, 3).getByRole('button', { name: s('admin.hours.addSlot'), exact: true }).click();
      await dayGroup(page, 3).getByLabel(s('admin.hours.startLabel'), { exact: true }).fill('18:00');
      await dayGroup(page, 3).getByLabel(s('admin.hours.endLabel'), { exact: true }).fill('10:00');
      await disableNativeValidation(page);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.invalid')).or(page.getByText(s('admin.hours.overlap')))).toBeVisible();
      expect(await hoursOf(api, barberId)).toEqual(['2 09:00-13:00', '2 15:00-19:30']);

      // Rimozione di una fascia
      await page.reload();
      await tuesday.getByRole('button', { name: s('admin.hours.removeSlot'), exact: true }).nth(1).click();
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.saved'))).toBeVisible();
      expect(await hoursOf(api, barberId)).toEqual(['2 09:00-13:00']);
    } finally {
      await cleanup(api, { barbers: [barberId] });
    }
  });

  // Decisione fetta 3: avviso con il numero di prenotazioni future, nessuna cancellazione
  test('disattivare un barbiere con prenotazioni future avvisa col numero e non le cancella', async ({ page }) => {
    const api = await adminApi(page.request);
    const name = uniqueName('Barbiere in uscita');
    const serviceId = await createService(api, { name: uniqueName('Servizio barbiere'), durationMin: 20 });
    const barberId = await createBarber(api, name, [serviceId]);
    const date = randomWinterDate();
    const bookings = [
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '09:30') }),
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '11:00') }),
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '16:00') }),
    ];
    // Non vanno contate: una cancellata e una passata
    await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '17:00'), status: 'cancelled_by_shop' });
    await createBooking(api, { barberId, serviceId, startsAt: '2024-01-16T10:00:00+01:00' });

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/barbieri');
      await rowWith(page, name).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
      await field(page, 'admin.barbers.activeLabel').uncheck();
      await saveButton(page).click();

      await expect(page.getByText(sf('admin.barbers.deactivatedWithBookings', { count: 3 }))).toBeVisible();
      expect((await findBarbers(api, name))[0]?.is_active).toBe(false);
      expect(await bookingStatuses(api, bookings)).toEqual(['confirmed', 'confirmed', 'confirmed']);

      await page.goto('/admin/barbieri');
      await expect(rowWith(page, name)).toContainText(s('admin.common.inactive'));
    } finally {
      await cleanup(api, { barbers: [barberId], services: [serviceId] });
    }
  });

  // SPEC §2: barbieri e orari sono solo dell'admin
  test('il barbiere non raggiunge l\'elenco dei barbieri né gli orari', async ({ page }) => {
    await loginAsBarber(page);
    for (const path of ['/admin/barbieri', `/admin/barbieri/${SEED.luca}/orari`, `/admin/barbieri/${SEED.sara}/orari`]) {
      await page.goto(path);
      await expectPath(page, '/admin');
    }
  });
});
