// Test di accettazione e2e – FETTA 6c ("Spostamento con trascinamento sul calendario"), con il mouse.
// Sezioni: SPEC §2 (ruoli: l'admin sposta qualunque confirmed futura, anche tra colonne; il barbiere
// solo le proprie, nella propria colonna), §3.6 (durata e prezzo non cambiano spostando), §3.7.5
// (avvisi e conferma esplicita), §6.1 (vista giorno), §6.3 (spostamento) + decisioni approvate per la
// fetta 6c:
//   1. admin: qualunque confirmed non iniziata, anche tra colonne; barbiere: solo le proprie;
//   3. trascinabili solo le confirmed future; aggancio alle righe della griglia; solo vista giorno;
//   5. moveBooking: durata e prezzo mai cambiati;
//   6. mouse dopo 5 px; spostamento ottimistico; avvisi → dialogo "Conferma comunque"/"Annulla" (move.cancel);
//      dopo il salvataggio "Annulla spostamento" (move.undo) per 8 s;
//   7. "Annulla spostamento" = moveBooking all'indietro; esito annunciato in una regione role="status";
//      schede trascinabili con data-draggable="true", colonne con data-barber-id="<uuid>";
//   9. testi in it.admin.calendar.move.
//
// Interfaccia attesa (rotta /admin?data=YYYY-MM-DD&vista=giorno):
//   - ogni scheda trascinabile (confirmed futura e consentita all'utente) è, o contiene, un elemento
//     con data-draggable="true" che include il nome dell'ospite; le altre schede non hanno
//     data-draggable="true";
//   - ogni colonna di barbiere ha un elemento con data-barber-id="<id della scheda barbiere>";
//   - le righe della griglia sono i link di slot vuoto esistenti (nome accessibile
//     it.admin.calendar.newAt): il test li usa per le coordinate di destinazione;
//   - trascinamento: pressione sulla prima riga della scheda, movimento di oltre 5 px, rilascio al
//     centro della riga di destinazione (scarto = numero intero di righe);
//   - esito: regione role="status" con it.admin.calendar.move.saved, poi pulsante
//     it.admin.calendar.move.undo; dopo l'annullamento it.admin.calendar.move.undone;
//   - con avvisi: role="alertdialog" (AlertDialog, decisione dell'utente) con nome it.admin.calendar.move.dialogTitle, testo dell'avviso
//     (it.admin.calendar.warnings.outsideHours), pulsanti it.admin.calendar.move.cancel e
//     it.admin.calendar.form.confirmAnyway.
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* (ambiente o .env.local). Dati
// unici per test (nomi degli ospiti e date casuali di mercoledì d'inverno), creati e rimossi con l'API
// dell'admin demo. Barbiere demo: barber@demo.local → scheda "Luca". Orari del seed: martedì–sabato
// 09:00–13:00 e 15:00–19:30; la griglia del giorno va dalle 09:00 alle 19:30 (pausa 13:00–15:00
// visibile, fuori fascia).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  cleanup,
  instant,
  loginAsAdmin,
  loginAsBarber,
  romeWinter,
  s,
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

type BookingRow = {
  id: string;
  barber_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  duration_min: number;
  price_cents: number;
};
const COLUMNS = 'id,barber_id,starts_at,ends_at,status,duration_min,price_cents';

const readBooking = async (api: AdminApi, id: string): Promise<BookingRow | undefined> =>
  (await api.get<BookingRow[]>(`/rest/v1/bookings?select=${COLUMNS}&id=eq.${id}`))[0];

/** [barbiere, inizio in ms] della prenotazione, per le attese sul database. */
const position = async (api: AdminApi, id: string): Promise<[string, number] | null> => {
  const row = await readBooking(api, id);
  return row === undefined ? null : [row.barber_id, instant(row.starts_at)];
};

const createGuestBooking = async (
  api: AdminApi,
  values: {
    barberId: string;
    guestName: string;
    startsAt: string;
    status?: 'confirmed' | 'cancelled_by_shop';
  },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: values.guestName,
    guest_phone: '+393330000660',
    barber_id: values.barberId,
    service_id: SEED.taglio,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status ?? 'confirmed',
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const dayView = (date: string, extra = ''): string => `/admin?data=${date}&vista=giorno${extra}`;

/** Scheda trascinabile (decisione 7) che contiene il nome dell'ospite. */
const draggableCard = (page: Page, guestName: string): Locator =>
  page.locator('main [data-draggable="true"]').filter({ hasText: guestName });

/** Scheda della prenotazione nella griglia (link al dettaglio con il nome dell'ospite). */
const bookingCard = (page: Page, guestName: string): Locator =>
  page.locator('main').getByRole('link', { name: new RegExp(guestName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

/** Riga della griglia: link di slot vuoto (it.admin.calendar.newAt). */
const gridRow = (page: Page, barber: string, time: string): Locator =>
  page.locator('main').getByRole('link', { name: sf('admin.calendar.newAt', { barber, time }), exact: true });

const statusWith = (page: Page, key: string): Locator => page.getByRole('status').filter({ hasText: s(key) });

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const value = await locator.boundingBox();
  expect(value, 'elemento senza area visibile').not.toBeNull();
  return value ?? { x: 0, y: 0, width: 0, height: 0 };
};

/**
 * Trascina la scheda con il mouse fino al centro della riga di destinazione. La pressione avviene al
 * centro della prima riga occupata dalla scheda, così lo scarto verticale è un numero intero di righe
 * (aggancio alla griglia, decisione 3); il primo movimento supera i 5 px di attivazione (decisione 6).
 * Con `centerTarget` la colonna di destinazione viene portata al centro prima di trascinare: con molte
 * colonne (barbieri creati dagli altri test) potrebbe stare vicino al bordo, dove l'autoscroll farebbe
 * scorrere la griglia sotto il puntatore (modifica approvata dall'utente dopo l'indagine sull'e2e
 * instabile).
 */
const dragTo = async (page: Page, card: Locator, target: Locator, options: { centerTarget?: boolean } = {}): Promise<void> => {
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  if (options.centerTarget) await target.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'center' }));
  const from = await box(card);
  const to = await box(target);
  const viewport = page.viewportSize();
  expect(to.y + to.height, 'la riga di destinazione deve essere nello schermo').toBeLessThanOrEqual(viewport?.height ?? 0);
  expect(to.y, 'la riga di destinazione deve essere nello schermo').toBeGreaterThanOrEqual(0);

  const startX = from.x + from.width / 2;
  const startY = from.y + to.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
};

test.describe('Spostamento con trascinamento sul calendario (SPEC §6.3, fetta 6c)', () => {
  // Desktop con il mouse: niente emulazione touch del profilo mobile (il touch si verifica a mano,
  // decisione 8).
  test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false });

  // SPEC §2, §3.6, §6.3 + decisioni 1, 5, 6, 7: l'admin sposta fra colonne, poi annulla entro 8 s
  test('l\'admin trascina una confermata futura di Luca nella colonna di Mario e poi annulla', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const guestName = uniqueName('Ospite da spostare');
    const id = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName,
      startsAt: romeWinter(date, '10:00'),
    });

    try {
      // Durata e prezzo diversi da quelli del servizio: spostando non devono essere ricopiati (§3.6)
      await api.patch(`/rest/v1/bookings?id=eq.${id}&select=id`, { duration_min: 40, price_cents: 2345 });
      const original = await readBooking(api, id);
      expect(original).toMatchObject({ barber_id: SEED.luca, duration_min: 40, price_cents: 2345 });

      await loginAsAdmin(page);
      await page.goto(dayView(date));

      // Decisione 7: colonne con data-barber-id, scheda trascinabile
      await expect(page.locator(`main [data-barber-id="${SEED.luca}"]`)).not.toHaveCount(0);
      await expect(page.locator(`main [data-barber-id="${SEED.mario}"]`)).not.toHaveCount(0);
      await expect(draggableCard(page, guestName)).toHaveCount(1);

      // Luca 10:00 → Mario 11:00, dentro la fascia: nessun avviso, salvata subito
      await dragTo(page, draggableCard(page, guestName), gridRow(page, 'Mario', '11:00'), { centerTarget: true });
      await expect(statusWith(page, 'admin.calendar.move.saved')).not.toHaveCount(0);
      await expect.poll(() => position(api, id)).toEqual([SEED.mario, instant(romeWinter(date, '11:00'))]);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);

      const moved = await readBooking(api, id);
      expect(moved).toMatchObject({ status: 'confirmed', duration_min: 40, price_cents: 2345 });
      expect(instant(moved?.ends_at ?? '')).toBe(instant(romeWinter(date, '11:40')));

      // Decisione 6 e 7: "Annulla" entro 8 s → posizione originale
      await page.getByRole('button', { name: s('admin.calendar.move.undo'), exact: true }).click();
      await expect(statusWith(page, 'admin.calendar.move.undone')).not.toHaveCount(0);
      await expect.poll(() => position(api, id)).toEqual([SEED.luca, instant(romeWinter(date, '10:00'))]);
      const restored = await readBooking(api, id);
      expect(restored).toMatchObject({ status: 'confirmed', duration_min: 40, price_cents: 2345 });
      expect(instant(restored?.ends_at ?? '')).toBe(instant(romeWinter(date, '10:40')));
    } finally {
      await cleanup(api, { bookings: [id] });
    }
  });

  // SPEC §3.7.5 + decisione 6: fuori fascia → dialogo; "Annulla" non salva, "Conferma comunque" salva
  test('fuori fascia compare il dialogo: Annulla lascia tutto com\'era, Conferma comunque salva', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const guestName = uniqueName('Ospite in pausa');
    const id = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName,
      startsAt: romeWinter(date, '12:00'),
    });

    try {
      await loginAsAdmin(page);
      await page.goto(dayView(date));
      await expect(draggableCard(page, guestName)).toHaveCount(1);

      // 1. Luca 12:00 → Luca 13:30 (pausa pranzo, fuori fascia): dialogo con l'avviso, nulla salvato
      await draggableCard(page, guestName).evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const before = await box(draggableCard(page, guestName));
      await dragTo(page, draggableCard(page, guestName), gridRow(page, 'Luca', '13:30'));
      const dialog = page.getByRole('alertdialog', { name: s('admin.calendar.move.dialogTitle') });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(s('admin.calendar.warnings.outsideHours'))).toBeVisible();
      await expect(dialog.getByRole('button', { name: s('admin.calendar.form.confirmAnyway'), exact: true })).toBeVisible();
      expect(await position(api, id)).toEqual([SEED.luca, instant(romeWinter(date, '12:00'))]);

      // "Annulla": nessun salvataggio, la scheda torna al suo posto
      await dialog.getByRole('button', { name: s('admin.calendar.move.cancel'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(async () => {
          const now = await box(draggableCard(page, guestName));
          return [Math.round(now.x), Math.round(now.y)];
        })
        .toEqual([Math.round(before.x), Math.round(before.y)]);
      expect(await position(api, id)).toEqual([SEED.luca, instant(romeWinter(date, '12:00'))]);
      await expect(statusWith(page, 'admin.calendar.move.saved')).toHaveCount(0);

      // 2. Di nuovo, con "Conferma comunque": salvata fuori fascia
      await dragTo(page, draggableCard(page, guestName), gridRow(page, 'Luca', '13:30'));
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: s('admin.calendar.form.confirmAnyway'), exact: true }).click();
      await expect(statusWith(page, 'admin.calendar.move.saved')).not.toHaveCount(0);
      await expect.poll(() => position(api, id)).toEqual([SEED.luca, instant(romeWinter(date, '13:30'))]);
      expect(await readBooking(api, id)).toMatchObject({ status: 'confirmed', duration_min: 30, price_cents: 2000 });
    } finally {
      await cleanup(api, { bookings: [id] });
    }
  });

  // SPEC §2 + decisioni 1 e 3: il barbiere sposta le proprie confermate future; le altre non si trascinano
  test('il barbiere sposta una propria confermata futura; cancellate e passate non sono trascinabili', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = futureDay();
    const past = pastDay();
    const movable = uniqueName('Ospite di Luca mobile');
    const cancelled = uniqueName('Ospite di Luca cancellato');
    const old = uniqueName('Ospite di Luca passato');
    const movableId = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName: movable,
      startsAt: romeWinter(date, '10:00'),
    });
    const cancelledId = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName: cancelled,
      startsAt: romeWinter(date, '16:00'),
      status: 'cancelled_by_shop',
    });
    const oldId = await createGuestBooking(api, {
      barberId: SEED.luca,
      guestName: old,
      startsAt: romeWinter(past, '10:00'),
    });

    try {
      await loginAsBarber(page);

      // Le cancellate sono visibili con ?cancellate=1: la scheda c'è ma non è trascinabile
      await page.goto(dayView(date, '&cancellate=1'));
      await expect(page.locator(`main [data-barber-id="${SEED.luca}"]`)).not.toHaveCount(0);
      await expect(draggableCard(page, movable)).toHaveCount(1);
      await expect(bookingCard(page, cancelled)).toHaveCount(1);
      await expect(draggableCard(page, cancelled)).toHaveCount(0);

      // Propria confermata futura: Luca 10:00 → Luca 11:00, dentro la fascia → salvata
      await dragTo(page, draggableCard(page, movable), gridRow(page, 'Luca', '11:00'));
      await expect(statusWith(page, 'admin.calendar.move.saved')).not.toHaveCount(0);
      await expect.poll(() => position(api, movableId)).toEqual([SEED.luca, instant(romeWinter(date, '11:00'))]);
      expect(await readBooking(api, movableId)).toMatchObject({ status: 'confirmed', duration_min: 30, price_cents: 2000 });

      // Propria confermata passata: visibile, non trascinabile
      await page.goto(dayView(past));
      await expect(bookingCard(page, old)).toHaveCount(1);
      await expect(draggableCard(page, old)).toHaveCount(0);
      expect(await position(api, oldId)).toEqual([SEED.luca, instant(romeWinter(past, '10:00'))]);
    } finally {
      await cleanup(api, { bookings: [movableId, cancelledId, oldId] });
    }
  });
});
