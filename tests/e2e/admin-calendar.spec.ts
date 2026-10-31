// Test di accettazione e2e – FETTA 6 (SPEC §11: "Staff gestisce una giornata intera").
// Flussi principali e controlli di accesso: SPEC §2 (il barbiere vede il proprio calendario e segna
// completata / no-show), §3.6, §3.7.1, §3.7.5, §6.1 (calendario, click su slot vuoto → manuale, click
// su prenotazione → dettaglio e cambio stato), §6.2 (ospite: nome + telefono), §6.3 (spostamento con
// verifica sovrapposizioni) + decisioni approvate per la fetta 6 (punti 4 e 5).
//
// Rotte attese:
//   /admin?data=YYYY-MM-DD&vista=giorno|settimana&barbiere=<uuid>
//     vista giorno: una colonna per barbiere (il barbiere vede solo la propria); vista settimana: un
//     barbiere alla volta (il barbiere sempre il proprio, il parametro barbiere non vale per lui).
//     Ogni slot vuoto è un link con nome accessibile it.admin.calendar.newAt ({barber}, {time} HH:MM)
//     verso /admin/calendario/nuova?barbiere=<id>&data=<data>&ora=<HH:MM>.
//     Ogni prenotazione è un link verso /admin/calendario/<id> il cui nome accessibile contiene il
//     nome del cliente o dell'ospite.
//   /admin/calendario/nuova – modulo precompilato dai parametri. Campi (label da it.admin.calendar.form):
//     barberLabel (select, value = id barbiere), serviceLabel (select, value = id servizio), dateLabel
//     (YYYY-MM-DD), timeLabel (HH:MM), radio registeredOption / guestOption, guestNameLabel,
//     guestPhoneLabel, staffNoteLabel; invio con it.admin.common.save. Con avvisi (si salva quando gli
//     avvisi ricalcolati sono un sottoinsieme, anche vuoto, di quelli confermati): testi di
//     it.admin.calendar.warnings.* e pulsante it.admin.calendar.form.confirmAnyway; nulla è salvato
//     finché non si conferma. Sovrapposizioni: it.admin.calendar.errors.barberBusy / customerBusy.
//   /admin/calendario/<id> – dettaglio; pulsanti di stato it.admin.calendar.status.*; solo per l'admin
//     un form con nome accessibile it.admin.calendar.edit.title (stessi campi barbiere, servizio, data,
//     ora + edit.durationLabel, edit.priceLabel; invio con it.admin.calendar.edit.saveChanges). Prenotazione non
//     visibile all'utente o id non valido → 404.
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* (ambiente o .env.local). Dati
// unici per test (nomi degli ospiti e date casuali), creati e rimossi con l'API dell'admin demo.
// Barbiere demo: barber@demo.local → scheda "Luca". Orari del seed: martedì–sabato 09:00–13:00 e
// 15:00–19:30.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  cleanup,
  expectPath,
  field,
  instant,
  loginAsAdmin,
  loginAsBarber,
  romeWinter,
  s,
  saveButton,
  sf,
  uniqueName,
  type AdminApi,
} from './admin-helpers';

// ---------------------------------------------------------------------------
// Utilità locali
// ---------------------------------------------------------------------------
const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/** Mercoledì di gennaio/febbraio (ora solare, giorno lavorativo per il seed) fra gli anni dati. */
const randomWinterWednesday = (fromYear: number, toYear: number): string => {
  const day = new Date(Date.UTC(randomInt(fromYear, toYear), randomInt(0, 1), randomInt(5, 25), 12));
  day.setUTCDate(day.getUTCDate() + ((3 - day.getUTCDay() + 7) % 7));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
};
const futureDay = (): string => randomWinterWednesday(2032, 2049);
const pastDay = (): string => randomWinterWednesday(2012, 2024);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type BookingRow = {
  id: string;
  barber_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  guest_name: string | null;
  guest_phone: string | null;
  customer_id: string | null;
  duration_min: number;
  price_cents: number;
};
const COLUMNS =
  'id,barber_id,service_id,starts_at,ends_at,status,source,guest_name,guest_phone,customer_id,duration_min,price_cents';

const bookingsOfGuest = (api: AdminApi, guestName: string): Promise<BookingRow[]> =>
  api.get<BookingRow[]>(`/rest/v1/bookings?select=${COLUMNS}&guest_name=eq.${encodeURIComponent(guestName)}`);

const createGuestBooking = async (
  api: AdminApi,
  values: { barberId: string; guestName: string; startsAt: string },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: values.guestName,
    guest_phone: '+393330000600',
    barber_id: values.barberId,
    service_id: SEED.taglio,
    starts_at: values.startsAt,
    source: 'manual',
    status: 'confirmed',
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const calendarLink = (page: Page, guestName: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(escapeRegExp(guestName)) });

const editForm = (page: Page): Locator => page.getByRole('form', { name: s('admin.calendar.edit.title') });

const fillGuest = async (page: Page, guestName: string): Promise<void> => {
  await field(page, 'admin.calendar.form.serviceLabel').selectOption(SEED.taglio);
  await page.getByRole('radio', { name: s('admin.calendar.form.guestOption'), exact: true }).check();
  await field(page, 'admin.calendar.form.guestNameLabel').fill(guestName);
  await field(page, 'admin.calendar.form.guestPhoneLabel').fill('333 123 4567');
};

const confirmAnyway = (page: Page): Locator =>
  page.getByRole('button', { name: s('admin.calendar.form.confirmAnyway'), exact: true });

test.describe('Calendario dello staff (SPEC §6.1–6.3)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §6.1, §6.2, §6.3
  test('l\'admin crea una manuale per un ospite da uno slot vuoto, la vede nella griglia, la apre e la sposta', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const guestName = uniqueName('Ospite manuale');

    try {
      await loginAsAdmin(page);

      // Id non valido o inesistente → 404 (decisione fetta 6)
      expect((await page.goto('/admin/calendario/non-un-uuid'))?.status()).toBe(404);
      expect((await page.goto('/admin/calendario/bd000000-0000-4000-8000-0000000006ff'))?.status()).toBe(404);

      // SPEC §6.1: click su uno slot vuoto → nuova manuale precompilata
      await page.goto(`/admin?data=${date}&vista=giorno`);
      await page
        .locator('main')
        .getByRole('link', { name: sf('admin.calendar.newAt', { barber: 'Luca', time: '10:00' }), exact: true })
        .click();
      await expectPath(page, '/admin/calendario/nuova');
      const params = new URL(page.url()).searchParams;
      expect(Object.fromEntries(params)).toMatchObject({ barbiere: SEED.luca, data: date, ora: '10:00' });
      await expect(field(page, 'admin.calendar.form.barberLabel')).toHaveValue(SEED.luca);
      await expect(field(page, 'admin.calendar.form.dateLabel')).toHaveValue(date);
      await expect(field(page, 'admin.calendar.form.timeLabel')).toHaveValue('10:00');

      // SPEC §6.2: ospite con nome e telefono; nessun avviso (dentro l'orario) → salvata subito
      await fillGuest(page, guestName);
      await saveButton(page).click();
      await expect.poll(async () => (await bookingsOfGuest(api, guestName)).length).toBe(1);
      const [created] = await bookingsOfGuest(api, guestName);
      expect(created).toMatchObject({
        barber_id: SEED.luca,
        service_id: SEED.taglio,
        status: 'confirmed',
        source: 'manual',
        customer_id: null,
        guest_phone: '+393331234567',
        duration_min: 30,
      });
      expect(instant(created?.starts_at ?? '')).toBe(instant(romeWinter(date, '10:00')));

      // La prenotazione compare nella griglia del giorno e porta al dettaglio
      await page.goto(`/admin?data=${date}&vista=giorno`);
      await expect(calendarLink(page, guestName)).toHaveCount(1);
      await calendarLink(page, guestName).click();
      await expectPath(page, `/admin/calendario/${created?.id}`);

      // SPEC §6.3: spostamento (barbiere e orario) dal modulo di modifica dell'admin
      const form = editForm(page);
      await expect(form).toBeVisible();
      await field(form, 'admin.calendar.form.barberLabel').selectOption(SEED.mario);
      await field(form, 'admin.calendar.form.timeLabel').fill('11:00');
      await form.getByRole('button', { name: s('admin.calendar.edit.saveChanges'), exact: true }).click();
      await expect
        .poll(async () => {
          const [row] = await bookingsOfGuest(api, guestName);
          return row === undefined ? null : [row.barber_id, instant(row.starts_at)];
        })
        .toEqual([SEED.mario, instant(romeWinter(date, '11:00'))]);
      const [moved] = await bookingsOfGuest(api, guestName);
      expect(moved).toMatchObject({
        id: created?.id,
        status: 'confirmed',
        duration_min: created?.duration_min,
        price_cents: created?.price_cents,
      });
      expect(instant(moved?.ends_at ?? '')).toBe(instant(romeWinter(date, '11:30')));
    } finally {
      const ids = (await bookingsOfGuest(api, guestName)).map((row) => row.id);
      await cleanup(api, { bookings: ids });
    }
  });

  // SPEC §3.7.5 + decisione fetta 4: avvisi ricalcolati a ogni invio, la conferma non deroga mai
  // alle sovrapposizioni (SPEC §3.7.1)
  test('avvisi: fuori orario → Conferma comunque → salvata; con orario occupato la conferma non basta', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const first = uniqueName('Ospite fuori orario');
    const second = uniqueName('Ospite occupato');
    const blocker = uniqueName('Ospite già presente');
    const timeOffReason = uniqueName('Permesso serale');
    const newForm = (time: string): string => `/admin/calendario/nuova?barbiere=${SEED.luca}&data=${date}&ora=${time}`;

    try {
      await loginAsAdmin(page);

      // 1. Fuori orario (Luca lavora fino alle 19:30): avviso, nulla salvato
      await page.goto(newForm('20:00'));
      await fillGuest(page, first);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.calendar.warnings.outsideHours'))).toBeVisible();
      await expect(confirmAnyway(page)).toBeVisible();
      expect(await bookingsOfGuest(api, first)).toHaveLength(0);

      // 2. Nel frattempo compare un'assenza: alla conferma il server ricalcola e mostra il nuovo avviso
      await api.post('/rest/v1/time_off?select=id', {
        barber_id: SEED.luca,
        starts_at: romeWinter(date, '19:45'),
        ends_at: romeWinter(date, '20:45'),
        reason: timeOffReason,
      });
      await confirmAnyway(page).click();
      await expect(page.getByText(s('admin.calendar.warnings.timeOff'))).toBeVisible();
      await expect(page.getByText(s('admin.calendar.warnings.outsideHours'))).toBeVisible();
      expect(await bookingsOfGuest(api, first)).toHaveLength(0);

      // 3. L'assenza viene rimossa prima del secondo invio: un avviso confermato è sparito e non ne
      //    compaiono di nuovi (decisione dell'utente: avvisi attuali ⊆ confermati) → salvata
      await api.del(`/rest/v1/time_off?reason=eq.${encodeURIComponent(timeOffReason)}`);
      await confirmAnyway(page).click();
      await expect.poll(async () => (await bookingsOfGuest(api, first)).length).toBe(1);
      const [saved] = await bookingsOfGuest(api, first);
      expect(saved).toMatchObject({ barber_id: SEED.luca, status: 'confirmed', source: 'manual' });
      expect(instant(saved?.starts_at ?? '')).toBe(instant(romeWinter(date, '20:00')));

      // Decisione dell'utente: la griglia si estende alle prenotazioni del giorno, la manuale fuori
      // orario è visibile
      await page.goto(`/admin?data=${date}&vista=giorno`);
      await expect(calendarLink(page, first)).toHaveCount(1);

      // 4. Fuori orario, poi l'orario viene occupato prima della conferma → errore di sovrapposizione
      await page.goto(newForm('21:00'));
      await fillGuest(page, second);
      await saveButton(page).click();
      await expect(confirmAnyway(page)).toBeVisible();
      await createGuestBooking(api, { barberId: SEED.luca, guestName: blocker, startsAt: romeWinter(date, '21:15') });
      await confirmAnyway(page).click();
      await expect(page.getByText(s('admin.calendar.errors.barberBusy'))).toBeVisible();
      expect(await bookingsOfGuest(api, second)).toHaveLength(0);
    } finally {
      const ids = [
        ...(await bookingsOfGuest(api, first)),
        ...(await bookingsOfGuest(api, second)),
        ...(await bookingsOfGuest(api, blocker)),
      ].map((row) => row.id);
      await cleanup(api, { bookings: ids, timeOffReasons: [timeOffReason] });
    }
  });

  // SPEC §2: "vede il proprio calendario", "segna completata / no-show"
  test('il barbiere vede solo la propria colonna e segna no-show una propria prenotazione passata', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = pastDay();
    const own = uniqueName('Ospite di Luca');
    const others = uniqueName('Ospite di Mario');
    const ownId = await createGuestBooking(api, { barberId: SEED.luca, guestName: own, startsAt: romeWinter(date, '10:00') });
    const otherId = await createGuestBooking(api, { barberId: SEED.mario, guestName: others, startsAt: romeWinter(date, '10:00') });

    try {
      await loginAsBarber(page);

      // Vista giorno: solo la propria colonna
      await page.goto(`/admin?data=${date}&vista=giorno`);
      await expect(calendarLink(page, own)).toHaveCount(1);
      await expect(page.locator('main').getByText(others)).toHaveCount(0);
      for (const name of ['Mario', 'Sara']) {
        await expect(page.locator('main').getByText(name, { exact: true })).toHaveCount(0);
      }
      // Vista settimana: il parametro barbiere non mostra il calendario di un altro
      await page.goto(`/admin?data=${date}&vista=settimana&barbiere=${SEED.mario}`);
      await expect(page.locator('main').getByText(others)).toHaveCount(0);
      await expect(calendarLink(page, own)).toHaveCount(1);

      // Dettaglio: cambio di stato sì, modifica no
      await calendarLink(page, own).click();
      await expectPath(page, `/admin/calendario/${ownId}`);
      await expect(editForm(page)).toHaveCount(0);
      await page.getByRole('button', { name: s('admin.calendar.status.markNoShow'), exact: true }).click();
      await expect
        .poll(async () => (await api.get<Array<{ status: string }>>(`/rest/v1/bookings?select=status&id=eq.${ownId}`))[0]?.status)
        .toBe('no_show');

      // Stato finale: il barbiere non ripristina
      await page.reload();
      await expect(page.getByRole('button', { name: s('admin.calendar.status.restore'), exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: s('admin.calendar.status.markNoShow'), exact: true })).toHaveCount(0);
    } finally {
      await cleanup(api, { bookings: [ownId, otherId] });
    }
  });

  // SPEC §2, §3.7.4: il barbiere non vede le prenotazioni degli altri barbieri
  test('il barbiere che apre la prenotazione di un altro barbiere riceve 404 e nessun modulo', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const others = uniqueName('Ospite riservato');
    const otherId = await createGuestBooking(api, { barberId: SEED.mario, guestName: others, startsAt: romeWinter(date, '10:00') });

    try {
      await loginAsBarber(page);
      const response = await page.goto(`/admin/calendario/${otherId}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(others)).toHaveCount(0);
      await expect(editForm(page)).toHaveCount(0);
      for (const key of ['markCompleted', 'markNoShow', 'cancelByCustomer', 'cancelByShop', 'restore']) {
        await expect(page.getByRole('button', { name: s(`admin.calendar.status.${key}`), exact: true })).toHaveCount(0);
      }
      const status = (await api.get<Array<{ status: string }>>(`/rest/v1/bookings?select=status&id=eq.${otherId}`))[0]?.status;
      expect(status).toBe('confirmed');
    } finally {
      await cleanup(api, { bookings: [otherId] });
    }
  });
});
