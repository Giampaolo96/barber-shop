// Test di accettazione e2e – FETTA 8c ("Vista settimana a griglia per singolo barbiere").
// Sezioni: SPEC §2 (il barbiere vede solo il proprio calendario e sposta le proprie confirmed future),
// §3.7.1 (sovrapposizioni rifiutate), §3.7.5 (fuori orario: avvisi e conferma esplicita), §6.1 (vista
// settimanale a griglia: 7 colonne lunedì–domenica, stesse righe della vista giorno, click su slot
// vuoto, giorni di chiusura totale attenuati, su telefono scorrimento orizzontale nel proprio
// contenitore con ore e intestazioni fisse, all'apertura mostra oggi), §6.3 (trascinamento verso un
// altro giorno o orario, sempre per lo stesso barbiere) + decisioni approvate per la fetta 8c (1–11).
// I casi limite (cambio d'ora, precedenze degli stati, buffer, passato, bordi della griglia) sono in
// tests/acceptance/calendar-week-grid.test.ts.
//
// Interfaccia attesa (rotta /admin?data=YYYY-MM-DD&vista=settimana[&barbiere=<uuid>][&cancellate=1]):
//   - un solo contenitore della griglia [data-week-scroll], con scorrimento orizzontale e verticale
//     proprio su telefono; nessun elenco per giorno;
//   - per ogni giorno della settimana un solo elemento [data-date="YYYY-MM-DD"] che copre la colonna
//     delle righe (area di rilascio del trascinamento), con data-closed="true" se una o più chiusure
//     coprono l'intera giornata locale, data-today="true" per oggi (timezone del negozio) e
//     data-drop-target="true" quando è la colonna di arrivo durante un trascinamento;
//   - intestazione di ogni giorno: link con nome accessibile formatDayLabel(date) ("gio 15 gen",
//     come nel titolo della pagina) verso la vista giorno (/admin?data=<date>, senza vista=settimana);
//   - etichette delle ore nella colonna fissa a sinistra con l'attributo data-week-hours;
//   - ogni riga cliccabile è un link con nome accessibile it.admin.calendar.week.newAt ({day} =
//     formatDayLabel(date), {time} = HH:MM) e href newBookingPath({ barberId, date, time }); anche fuori
//     orario, in assenza e in chiusura; non sono link le righe occupate fino a blocked_until di una
//     confirmed;
//   - ogni prenotazione è un link al dettaglio il cui nome accessibile contiene il nome del cliente;
//     le trascinabili hanno data-draggable="true";
//   - durante il trascinamento la copia trascinata mostra [data-drop-preview] con
//     it.admin.calendar.move.dropPreviewDay ({day} = formatDayLabel, {time} = HH:MM);
//   - esiti come nella vista giorno: role="status" con it.admin.calendar.move.saved o
//     it.admin.calendar.errors.barberBusy; avvisi in role="alertdialog" (move.dialogTitle) con
//     move.cancel e form.confirmAnyway;
//   - "mostra cancellate" come nella vista giorno: senza cancellate=1 le cancellate sono nascoste e la
//     barra mostra it.admin.calendar.cancelledCount; con cancellate=1 sono visibili e, se condividono
//     l'orario con una confermata, le schede stanno in corsie affiancate della colonna del giorno
//     (overlapLayout per colonna) con l'attributo data-lane; l'intestazione del giorno mantiene
//     l'impostazione (cancellate=1 nel link alla vista giorno, decisione approvata);
//   - su telefono: touch-action diverso da none sul contenitore [data-week-scroll] e sulla griglia al
//     suo interno (lo scorrimento con il dito resta del browser), touch-action: manipulation sulle schede
//     trascinabili (come nella vista giorno); altezza del contenitore in dvh, mai oltre window.innerHeight.
// Decisioni approvate dopo la stesura: una prenotazione oltre la mezzanotte si taglia alle 24:00 e si
// disegna solo nel giorno di inizio; una settimana con sole prenotazioni ha l'asse che copre solo
// quelle; l'ora ripetuta del ritorno all'ora solare è un limite noto; linea dell'ora attuale e resa
// estetica delle cancellate si verificano con gli screenshot.
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* (ambiente o .env.local). Dati unici
// per test (nomi degli ospiti e settimane casuali d'inverno), creati e rimossi con l'API dell'admin demo.
// Barbiere demo: barber@demo.local → scheda "Luca". Orari del seed: martedì–sabato 09:00–13:00 e
// 15:00–19:30 (lunedì e domenica a riposo); passo della griglia 15 minuti, buffer 0.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Locator, type Page } from '@playwright/test';
import { it as itLocale } from 'date-fns/locale/it';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

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
  plusDays,
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
const TZ = 'Europe/Rome';
const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Settimana futura di gennaio/febbraio (ora solare): date da lunedì a domenica. */
const futureWinterWeek = (): { mon: string; tue: string; wed: string; thu: string; fri: string; sat: string; sun: string; all: string[] } => {
  const day = new Date(Date.UTC(randomInt(2032, 2049), randomInt(0, 1), randomInt(5, 22), 12));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const mon = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
  const all = Array.from({ length: 7 }, (_, index) => plusDays(mon, index));
  const [, tue, wed, thu, fri, sat, sun] = all;
  return { mon, tue: tue ?? '', wed: wed ?? '', thu: thu ?? '', fri: fri ?? '', sat: sat ?? '', sun: sun ?? '', all };
};

/** Etichetta del giorno come formatDayLabel (src/lib/booking/format.ts): "gio 15 gen". */
const dayLabel = (date: string): string =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), 'UTC', 'EEE d MMM', { locale: itLocale });

const weekUrl = (date: string, barberId?: string): string =>
  `/admin?data=${date}&vista=settimana${barberId ? `&barbiere=${barberId}` : ''}`;

const scroller = (page: Page): Locator => page.locator('main [data-week-scroll]');
const column = (page: Page, date: string): Locator => page.locator(`main [data-date="${date}"]`);

/** Riga cliccabile (slot) della griglia settimanale. */
const weekSlot = (page: Page, date: string, time: string): Locator =>
  page.locator('main').getByRole('link', { name: sf('admin.calendar.week.newAt', { day: dayLabel(date), time }), exact: true });

/** Scheda della prenotazione (link al dettaglio con il nome dell'ospite). */
const card = (page: Page, guestName: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(escapeRegExp(guestName)) });

const draggableCard = (page: Page, guestName: string): Locator =>
  page.locator('main [data-draggable="true"]').filter({ hasText: guestName });

const statusWith = (page: Page, text: string): Locator => page.getByRole('status').filter({ hasText: text });

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => {
  const value = await locator.boundingBox();
  expect(value, 'elemento senza area visibile').not.toBeNull();
  return value ?? { x: 0, y: 0, width: 0, height: 0 };
};
const centerX = (value: Box): number => value.x + value.width / 2;
const inside = (x: number, area: Box): boolean => x >= area.x && x <= area.x + area.width;

type BookingRow = { id: string; barber_id: string; starts_at: string; status: string; duration_min: number; price_cents: number };
const COLUMNS = 'id,barber_id,starts_at,status,duration_min,price_cents';

const readBooking = async (api: AdminApi, id: string): Promise<BookingRow | undefined> =>
  (await api.get<BookingRow[]>(`/rest/v1/bookings?select=${COLUMNS}&id=eq.${id}`))[0];

const bookingsOfGuest = (api: AdminApi, guestName: string): Promise<BookingRow[]> =>
  api.get<BookingRow[]>(`/rest/v1/bookings?select=${COLUMNS}&guest_name=eq.${encodeURIComponent(guestName)}`);

/** [barbiere, inizio in ms] della prenotazione. */
const position = async (api: AdminApi, id: string): Promise<[string, number] | null> => {
  const row = await readBooking(api, id);
  return row === undefined ? null : [row.barber_id, instant(row.starts_at)];
};

const createGuestBooking = async (
  api: AdminApi,
  values: { barberId: string; guestName: string; startsAt: string; status?: 'confirmed' | 'cancelled_by_shop' },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: values.guestName,
    guest_phone: '+393330000880',
    barber_id: values.barberId,
    service_id: SEED.taglio,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status ?? 'confirmed',
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const fillGuest = async (page: Page, guestName: string): Promise<void> => {
  await field(page, 'admin.calendar.form.serviceLabel').selectOption(SEED.taglio);
  await page.getByRole('radio', { name: s('admin.calendar.form.guestOption'), exact: true }).check();
  await field(page, 'admin.calendar.form.guestNameLabel').fill(guestName);
  await field(page, 'admin.calendar.form.guestPhoneLabel').fill('333 123 4567');
};

/**
 * Riga di arrivo nella colonna del giorno `date`: orizzontalmente il centro dell'area [data-date],
 * verticalmente il link di uno slot libero alla stessa ora in un altro giorno (`freeDate`), perché le
 * righe sono comuni ai 7 giorni (decisione 6). Serve quando la riga di arrivo è occupata (non è un link).
 */
const slotInColumn = async (page: Page, date: string, time: string, freeDate: string): Promise<Box> => {
  const row = await box(weekSlot(page, freeDate, time));
  const day = await box(column(page, date));
  return { x: day.x, y: row.y, width: day.width, height: row.height };
};

/**
 * Trascina la scheda con il mouse fino al centro della riga di arrivo. La pressione avviene al centro
 * della prima riga occupata dalla scheda, così lo scarto verticale è un numero intero di righe; il primo
 * movimento supera i 5 px di attivazione (decisione 10). Partenza e arrivo devono essere visibili
 * insieme nel contenitore della griglia (si rilascia solo su ciò che si vede). `beforeDrop` gira con il
 * puntatore fermo sull'arrivo, prima del rilascio.
 */
const dragToRow = async (
  page: Page,
  source: Locator,
  targetRow: () => Promise<Box>,
  beforeDrop?: () => Promise<void>,
): Promise<void> => {
  await source.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const from = await box(source);
  const to = await targetRow();
  const area = await box(scroller(page));
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const start = { x: centerX(from), y: from.y + to.height / 2 };
  const end = { x: centerX(to), y: to.y + to.height / 2 };
  for (const [label, point] of [
    ['partenza', start],
    ['arrivo', end],
  ] as const) {
    expect(inside(point.x, area), `${label} visibile nel contenitore della griglia`).toBe(true);
    expect(point.y >= Math.max(area.y, 0) && point.y <= Math.min(area.y + area.height, viewport.height), `${label} visibile`).toBe(true);
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 12, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 20 });
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
};

const dragTo = (page: Page, source: Locator, targetRow: Locator, beforeDrop?: () => Promise<void>): Promise<void> =>
  dragToRow(page, source, () => box(targetRow), beforeDrop);

test.describe('Vista settimana a griglia (SPEC §6.1, §6.3, fetta 8c)', () => {
  test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false });

  // SPEC §6.1 + decisioni 1, 2, 3, 6: griglia di 7 giorni, slot vuoto → nuova manuale precompilata
  test('l\'admin crea una manuale da uno slot della settimana di Luca e la ritrova nel giorno e alla riga giusti', async ({ page }) => {
    const api = await adminApi(page.request);
    const week = futureWinterWeek();
    const guestName = uniqueName('Ospite settimana');

    try {
      await loginAsAdmin(page);
      await page.goto(weekUrl(week.wed, SEED.luca));

      // Decisione 1: una griglia, una colonna per ciascuno dei 7 giorni
      await expect(scroller(page)).toHaveCount(1);
      for (const date of week.all) await expect(column(page, date), date).toHaveCount(1);
      await expect(page.locator('main [data-date]')).toHaveCount(7);

      // Intestazione del giorno: link alla vista giorno
      const header = page.locator('main').getByRole('link', { name: dayLabel(week.thu), exact: true });
      await expect(header).toHaveCount(1);
      const headerHref = new URL((await header.getAttribute('href')) ?? '', 'http://x');
      expect(headerHref.pathname).toBe('/admin');
      expect(headerHref.searchParams.get('data')).toBe(week.thu);
      expect(headerHref.searchParams.get('vista')).not.toBe('settimana');

      // Decisione 3: lunedì (riposo di Luca) e pausa pranzo sono sfondo ma restano cliccabili
      await expect(weekSlot(page, week.mon, '10:00')).toHaveCount(1);
      await expect(weekSlot(page, week.thu, '13:30')).toHaveCount(1);

      // Click su uno slot vuoto → nuova manuale precompilata (barbiere, data, ora)
      await weekSlot(page, week.thu, '17:15').click();
      await expectPath(page, '/admin/calendario/nuova');
      expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ barbiere: SEED.luca, data: week.thu, ora: '17:15' });
      await expect(field(page, 'admin.calendar.form.barberLabel')).toHaveValue(SEED.luca);
      await expect(field(page, 'admin.calendar.form.dateLabel')).toHaveValue(week.thu);
      await expect(field(page, 'admin.calendar.form.timeLabel')).toHaveValue('17:15');

      await fillGuest(page, guestName);
      await saveButton(page).click();
      await expect.poll(async () => (await bookingsOfGuest(api, guestName)).length).toBe(1);
      const [created] = await bookingsOfGuest(api, guestName);
      expect(created).toMatchObject({ barber_id: SEED.luca, status: 'confirmed', duration_min: 30 });
      expect(instant(created?.starts_at ?? '')).toBe(instant(romeWinter(week.thu, '17:15')));

      // Di nuovo nella settimana: la scheda è nella colonna di giovedì, alla riga delle 17:15
      await page.goto(weekUrl(week.wed, SEED.luca));
      const booked = card(page, guestName);
      await expect(booked).toHaveCount(1);
      await booked.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const bookedBox = await box(booked);
      expect(inside(centerX(bookedBox), await box(column(page, week.thu))), 'scheda nella colonna di giovedì').toBe(true);
      const sameRow = await box(weekSlot(page, week.fri, '17:15'));
      expect(Math.abs(bookedBox.y - sameRow.y), 'scheda alla riga delle 17:15').toBeLessThanOrEqual(3);

      // Righe occupate (30 minuti) non cliccabili, la successiva sì
      await expect(weekSlot(page, week.thu, '17:15')).toHaveCount(0);
      await expect(weekSlot(page, week.thu, '17:30')).toHaveCount(0);
      await expect(weekSlot(page, week.thu, '17:45')).toHaveCount(1);
    } finally {
      const ids = (await bookingsOfGuest(api, guestName)).map((row) => row.id);
      await cleanup(api, { bookings: ids });
    }
  });

  // SPEC §6.3, §3.7.1, §3.7.5 + decisioni 2, 3, 10: altro giorno libero, slot occupato, fuori orario
  test('l\'admin trascina su un altro giorno: libero salva, occupato rifiuta, fuori orario chiede conferma', async ({ page }) => {
    const api = await adminApi(page.request);
    const week = futureWinterWeek();
    const guestName = uniqueName('Ospite da spostare in settimana');
    const blockerName = uniqueName('Ospite che occupa');
    const id = await createGuestBooking(api, { barberId: SEED.luca, guestName, startsAt: romeWinter(week.wed, '10:30') });
    const blockerId = await createGuestBooking(api, { barberId: SEED.luca, guestName: blockerName, startsAt: romeWinter(week.fri, '11:00') });

    try {
      await loginAsAdmin(page);
      await page.goto(weekUrl(week.wed, SEED.luca));
      await expect(draggableCard(page, guestName)).toHaveCount(1);

      // 1. Mercoledì 10:30 → giovedì 11:15 (in fascia): anteprima giorno+ora e colonna evidenziata
      await dragTo(page, draggableCard(page, guestName), weekSlot(page, week.thu, '11:15'), async () => {
        await expect(page.locator('[data-drop-preview]')).toHaveText(
          sf('admin.calendar.move.dropPreviewDay', { day: dayLabel(week.thu), time: '11:15' }),
        );
        await expect(page.locator('main [data-drop-target="true"]')).toHaveCount(1);
        await expect(column(page, week.thu)).toHaveAttribute('data-drop-target', 'true');
      });
      await expect(statusWith(page, s('admin.calendar.move.saved'))).not.toHaveCount(0);
      await expect.poll(() => position(api, id)).toEqual([SEED.luca, instant(romeWinter(week.thu, '11:15'))]);
      expect(await readBooking(api, id)).toMatchObject({ status: 'confirmed', duration_min: 30, price_cents: 2000 });

      // Persiste dopo il ricaricamento, nella colonna di giovedì
      await page.reload();
      await expect(draggableCard(page, guestName)).toHaveCount(1);
      expect(inside(centerX(await box(draggableCard(page, guestName))), await box(column(page, week.thu)))).toBe(true);

      // 2. Giovedì 11:15 → venerdì 11:00, occupato: il server rifiuta, la scheda resta al suo posto
      await draggableCard(page, guestName).evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const before = await box(draggableCard(page, guestName));
      await dragToRow(page, draggableCard(page, guestName), () => slotInColumn(page, week.fri, '11:00', week.thu));
      await expect(statusWith(page, s('admin.calendar.errors.barberBusy'))).not.toHaveCount(0);
      await expect
        .poll(async () => {
          const now = await box(draggableCard(page, guestName));
          return [Math.round(now.x), Math.round(now.y)];
        })
        .toEqual([Math.round(before.x), Math.round(before.y)]);
      expect(await position(api, id)).toEqual([SEED.luca, instant(romeWinter(week.thu, '11:15'))]);
      expect(await position(api, blockerId)).toEqual([SEED.luca, instant(romeWinter(week.fri, '11:00'))]);

      // 3. Giovedì 11:15 → lunedì 11:15 (Luca a riposo): dialogo con l'avviso; "Annulla" non salva
      await dragTo(page, draggableCard(page, guestName), weekSlot(page, week.mon, '11:15'));
      const dialog = page.getByRole('alertdialog', { name: s('admin.calendar.move.dialogTitle') });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(s('admin.calendar.warnings.outsideHours'))).toBeVisible();
      await expect(dialog.getByRole('button', { name: s('admin.calendar.form.confirmAnyway'), exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: s('admin.calendar.move.cancel'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(async () => {
          const now = await box(draggableCard(page, guestName));
          return [Math.round(now.x), Math.round(now.y)];
        })
        .toEqual([Math.round(before.x), Math.round(before.y)]);
      expect(await position(api, id)).toEqual([SEED.luca, instant(romeWinter(week.thu, '11:15'))]);
    } finally {
      await cleanup(api, { bookings: [id, blockerId] });
    }
  });

  // SPEC §6.1 + decisioni 3, 4: chiusura dell'intera giornata → colonna attenuata, righe cliccabili
  test('giorno di chiusura totale: colonna data-closed con l\'etichetta; chiusura parziale no', async ({ page }) => {
    const api = await adminApi(page.request);
    const week = futureWinterWeek();
    const reason = uniqueName('Chiusura settimana');
    await api.post('/rest/v1/shop_closures?select=id', [
      { starts_at: romeWinter(week.thu, '00:00'), ends_at: romeWinter(week.fri, '00:00'), reason },
      { starts_at: romeWinter(week.fri, '10:00'), ends_at: romeWinter(week.fri, '12:00'), reason },
    ]);

    try {
      await loginAsAdmin(page);
      await page.goto(weekUrl(week.wed, SEED.luca));

      await expect(column(page, week.thu)).toHaveAttribute('data-closed', 'true');
      for (const date of [week.mon, week.wed, week.fri, week.sun]) {
        await expect(column(page, date), date).not.toHaveAttribute('data-closed', 'true');
      }
      await expect(
        page.locator('main').getByText(new RegExp(`${escapeRegExp(s('admin.calendar.closureBlock'))}.*${escapeRegExp(reason)}`)).first(),
      ).toBeVisible();
      // Come nella vista giorno: la chiusura è sfondo, la riga resta un link (gli avvisi dopo, §3.7.5)
      await expect(weekSlot(page, week.thu, '10:00')).toHaveCount(1);
      await expect(weekSlot(page, week.fri, '10:30')).toHaveCount(1);
    } finally {
      await cleanup(api, { closureReasons: [reason] });
    }
  });

  // SPEC §2, §6.1, §6.3 + decisione 2: il barbiere vede solo la propria settimana e la gestisce
  test('il barbiere vede solo la propria settimana, crea da uno slot e sposta una propria prenotazione su un altro giorno', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const week = futureWinterWeek();
    const own = uniqueName('Ospite di Luca in settimana');
    const others = uniqueName('Ospite di Mario in settimana');
    const created = uniqueName('Ospite creato dal barbiere');
    const ownId = await createGuestBooking(api, { barberId: SEED.luca, guestName: own, startsAt: romeWinter(week.wed, '10:30') });
    const otherId = await createGuestBooking(api, { barberId: SEED.mario, guestName: others, startsAt: romeWinter(week.wed, '10:30') });

    try {
      await loginAsBarber(page);
      await page.goto(weekUrl(week.wed, SEED.mario));

      // Sempre la propria settimana, nessun selettore dei barbieri
      await expect(scroller(page)).toHaveCount(1);
      await expect(page.getByRole('navigation', { name: s('admin.calendar.barberFilterLabel') })).toHaveCount(0);
      await expect(draggableCard(page, own)).toHaveCount(1);
      await expect(page.locator('main').getByText(others)).toHaveCount(0);

      // Slot vuoto → nuova manuale per sé
      await weekSlot(page, week.thu, '12:15').click();
      await expectPath(page, '/admin/calendario/nuova');
      expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ barbiere: SEED.luca, data: week.thu, ora: '12:15' });
      await fillGuest(page, created);
      await saveButton(page).click();
      await expect.poll(async () => (await bookingsOfGuest(api, created)).length).toBe(1);
      const [row] = await bookingsOfGuest(api, created);
      expect(row?.barber_id).toBe(SEED.luca);
      expect(instant(row?.starts_at ?? '')).toBe(instant(romeWinter(week.thu, '12:15')));

      // Trascinamento della propria su un altro giorno, stessa ora: barbiere invariato
      await page.goto(weekUrl(week.wed));
      await expect(draggableCard(page, own)).toHaveCount(1);
      await dragTo(page, draggableCard(page, own), weekSlot(page, week.tue, '10:30'));
      await expect(statusWith(page, s('admin.calendar.move.saved'))).not.toHaveCount(0);
      await expect.poll(() => position(api, ownId)).toEqual([SEED.luca, instant(romeWinter(week.tue, '10:30'))]);
      expect(await position(api, otherId)).toEqual([SEED.mario, instant(romeWinter(week.wed, '10:30'))]);
    } finally {
      const ids = (await bookingsOfGuest(api, created)).map((booking) => booking.id);
      await cleanup(api, { bookings: [ownId, otherId, ...ids] });
    }
  });

  // SPEC §6.1 (cancellate nascoste, con conteggio e link per mostrarle) + decisione 7
  test('"mostra cancellate": nascosta e contata, poi visibile in una corsia affiancata alla confermata', async ({ page }) => {
    const api = await adminApi(page.request);
    const week = futureWinterWeek();
    const confirmedName = uniqueName('Confermata in settimana');
    const cancelledName = uniqueName('Cancellata in settimana');
    // Orario poco usato dagli altri spec; la cancellata prima, come nel caso reale (posto poi riassegnato)
    const startsAt = romeWinter(week.wed, '15:45');
    const cancelledId = await createGuestBooking(api, { barberId: SEED.luca, guestName: cancelledName, startsAt, status: 'cancelled_by_shop' });
    const confirmedId = await createGuestBooking(api, { barberId: SEED.luca, guestName: confirmedName, startsAt });

    try {
      await loginAsAdmin(page);

      // Senza cancellate=1: solo la confermata, e la barra mostra il conteggio
      await page.goto(weekUrl(week.wed, SEED.luca));
      await expect(card(page, confirmedName)).toHaveCount(1);
      await expect(card(page, cancelledName)).toHaveCount(0);
      await expect(page.locator('main').getByText(sf('admin.calendar.cancelledCount', { count: 1 }))).toBeVisible();

      // Con cancellate=1: entrambe visibili, in corsie affiancate nella colonna di mercoledì
      const weekWithCancelled = `${weekUrl(week.wed, SEED.luca)}&cancellate=1`;
      await page.goto(weekWithCancelled);
      const confirmed = card(page, confirmedName);
      const cancelled = card(page, cancelledName);
      await expect(confirmed).toBeVisible();
      await expect(cancelled).toBeVisible();
      await expect(confirmed).toHaveAttribute('data-lane', /.+/);
      await expect(cancelled).toHaveAttribute('data-lane', /.+/);
      await confirmed.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const confirmedBox = await box(confirmed);
      const cancelledBox = await box(cancelled);
      const wednesday = await box(column(page, week.wed));
      expect(inside(centerX(confirmedBox), wednesday), 'confermata nella colonna di mercoledì').toBe(true);
      expect(inside(centerX(cancelledBox), wednesday), 'cancellata nella colonna di mercoledì').toBe(true);
      const apart =
        confirmedBox.x + confirmedBox.width <= cancelledBox.x + 0.5 || cancelledBox.x + cancelledBox.width <= confirmedBox.x + 0.5;
      expect(apart, 'le due schede non si sovrappongono in orizzontale').toBe(true);

      // Entrambe cliccabili: ognuna apre il proprio dettaglio
      await cancelled.click();
      await expectPath(page, `/admin/calendario/${cancelledId}`);
      await page.goBack();
      await expect(confirmed).toBeVisible();
      await confirmed.click();
      await expectPath(page, `/admin/calendario/${confirmedId}`);
      await page.goBack();
      await expect(cancelled).toBeVisible();
    } finally {
      await cleanup(api, { bookings: [cancelledId, confirmedId] });
    }
  });
});

// SPEC §6.1 + decisioni 9, 11: su telefono la griglia scorre nel proprio contenitore e apre su oggi
test.describe('Vista settimana su telefono (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('scorrimento nel contenitore, oggi visibile all\'apertura, ore e giorni fissi, tocco, navigazione fra settimane', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    // Una confermata futura nella settimana successiva (sempre futura, qualunque sia l'ora del giro):
    // serve una scheda trascinabile per il controllo del tocco.
    const guestName = uniqueName('Ospite tocco');
    const nextWeekDay = plusDays(today, 7);
    const bookingId = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName,
      startsAt: fromZonedTime(`${nextWeekDay}T18:45:00`, TZ).toISOString(),
    });

    try {
      await loginAsAdmin(page);
      await page.goto(weekUrl(today, SEED.luca));

      const container = scroller(page);
      await expect(container).toHaveCount(1);

      // Altezza del contenitore in dvh: mai oltre l'altezza della finestra
      expect(await container.evaluate((element) => element.getBoundingClientRect().height <= window.innerHeight)).toBe(true);

      // Tocco: lo scorrimento con il dito resta al browser sul contenitore e sulla griglia al suo interno
      const touchActions = await container.evaluate((element) => [
        getComputedStyle(element).touchAction,
        ...Array.from(element.querySelectorAll('*'), (child) => getComputedStyle(child).touchAction),
      ]);
      expect(touchActions[0], 'touch-action del contenitore').not.toBe('none');
      expect(touchActions.filter((value) => value === 'none'), 'nessun elemento della griglia con touch-action: none').toEqual([]);

      // Nessuno scorrimento orizzontale della pagina; il contenitore scorre in orizzontale e in verticale
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const overflow = await container.evaluate((element) => ({
        x: element.scrollWidth - element.clientWidth,
        y: element.scrollHeight - element.clientHeight,
      }));
      expect(overflow.x, 'la settimana scorre in orizzontale nel contenitore').toBeGreaterThan(0);
      expect(overflow.y, 'la settimana scorre in verticale nel contenitore').toBeGreaterThan(0);

      // Oggi: una sola colonna data-today, visibile accanto alla colonna delle ore già all'apertura
      await expect(page.locator('main [data-today="true"]')).toHaveCount(1);
      await expect(column(page, today)).toHaveAttribute('data-today', 'true');
      const hours = page.locator('main [data-week-hours]').first();
      await expect
        .poll(async () => {
          const area = await box(container);
          const hoursBox = await box(hours);
          const todayBox = await box(column(page, today));
          return (
            todayBox.x >= hoursBox.x + hoursBox.width - 2 &&
            todayBox.x + todayBox.width <= area.x + area.width + 2
          );
        }, { message: 'la colonna di oggi è interamente visibile, a destra della colonna delle ore' })
        .toBe(true);

      // Colonna delle ore fissa a sinistra anche dopo lo scorrimento orizzontale fino in fondo
      await container.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect
        .poll(async () => Math.round((await box(hours)).x - (await box(container)).x), { message: 'colonna delle ore fissa a sinistra' })
        .toBeLessThanOrEqual(4);
      expect((await box(hours)).x).toBeGreaterThanOrEqual((await box(container)).x - 1);

      // Intestazioni dei giorni fisse in alto anche dopo lo scorrimento verticale fino in fondo
      const sundayHeader = page.locator('main').getByRole('link', { name: dayLabel(plusDays(today, 7 - isoWeekday(today))), exact: true });
      await container.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(async () => {
          const area = await box(container);
          const headerBox = await box(sundayHeader);
          return headerBox.y >= area.y - 1 && headerBox.y + headerBox.height <= area.y + 80;
        }, { message: 'intestazione del giorno fissa in alto nel contenitore' })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Navigazione: settimana successiva e precedente mantengono vista e barbiere
      await page.getByRole('link', { name: s('admin.calendar.nextWeek'), exact: true }).click();
      await expect
        .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
        .toMatchObject({ data: plusDays(today, 7), vista: 'settimana', barbiere: SEED.luca });
      await expect(scroller(page)).toHaveCount(1);

      // Schede trascinabili: touch-action: manipulation, come nella vista giorno
      const draggable = draggableCard(page, guestName);
      await expect(draggable).toHaveCount(1);
      expect(await draggable.evaluate((element) => getComputedStyle(element).touchAction)).toBe('manipulation');

      await page.getByRole('link', { name: s('admin.calendar.previousWeek'), exact: true }).click();
      await expect
        .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
        .toMatchObject({ data: today, vista: 'settimana', barbiere: SEED.luca });
      await expect(column(page, today)).toHaveAttribute('data-today', 'true');
    } finally {
      await cleanup(api, { bookings: [bookingId] });
    }
  });
});

/** Giorno della settimana ISO (1 = lunedì … 7 = domenica) di una data `YYYY-MM-DD`. */
function isoWeekday(date: string): number {
  return ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}
