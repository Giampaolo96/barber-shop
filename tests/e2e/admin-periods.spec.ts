// Test di accettazione e2e – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze,
// chiusure" – fatta quando: "CRUD completi"). Assenze dei barbieri (lato admin) e chiusure.
// Sezioni: SPEC §3.5 (assenze anche parziali, chiusure del negozio), §6.5, §6.6, §9 (UTC nel
// database, ora di Roma a video), §12 ("Assenza parziale a metà mattina", cambio d'ora)
// + decisioni approvate per la fetta 3 (punti A ed E).
// Contratto dell'interfaccia (decisione fetta 3), uguale per /admin/barbieri/<id>/assenze,
// /admin/chiusure e /admin/assenze:
// - modulo con due radio: it.admin.period.allDay (campi date it.admin.period.fromDateLabel /
//   toDateLabel, "dal X al Y" con Y incluso) e it.admin.period.timed (campi datetime-local
//   it.admin.period.startLabel / endLabel); motivo it.admin.period.reasonLabel; salva con
//   it.admin.common.save; errori con it.admin.common.invalid;
// - se il periodo si sovrappone a prenotazioni confermate compare it.admin.period.overlapsBookings
//   con {count} = numero di prenotazioni `confirmed` il cui intervallo [starts_at, ends_at) (buffer
//   escluso) si sovrappone al periodo [inizio, fine): solo quelle del barbiere per le assenze,
//   quelle di tutti i barbieri per le chiusure (decisione fetta 3, utente);
// - elenco in tabella, una riga per periodo, con il motivo, le date gg/mm/aaaa e, per i periodi
//   orari, le ore HH:MM in ora di Roma; azioni di riga it.admin.common.edit / delete.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP,
  SEED,
  acceptDialogs,
  adminApi,
  bookingStatuses,
  cleanup,
  countConfirmedOverlapping,
  createBarber,
  createBooking,
  createService,
  disableNativeValidation,
  expectPath,
  field,
  instant,
  itDate,
  loginAsAdmin,
  loginAsBarber,
  plusDays,
  randomWinterDate,
  romeWinter,
  rowWith,
  s,
  saveButton,
  sf,
  uniqueName,
} from './admin-helpers';

type PeriodRow = { id: string; starts_at: string; ends_at: string; reason: string | null };

const chooseMode = async (page: Page, mode: 'allDay' | 'timed'): Promise<void> => {
  await page.getByRole('radio', { name: s(`admin.period.${mode}`), exact: true }).check();
};

const fillAllDay = async (page: Page, from: string, to: string, reason: string): Promise<void> => {
  await chooseMode(page, 'allDay');
  await field(page, 'admin.period.fromDateLabel').fill(from);
  await field(page, 'admin.period.toDateLabel').fill(to);
  await field(page, 'admin.period.reasonLabel').fill(reason);
};

const fillTimed = async (page: Page, start: string, end: string, reason: string): Promise<void> => {
  await chooseMode(page, 'timed');
  await field(page, 'admin.period.startLabel').fill(start);
  await field(page, 'admin.period.endLabel').fill(end);
  await field(page, 'admin.period.reasonLabel').fill(reason);
};

test.describe('Admin – assenze dei barbieri (SPEC §3.5, §6.5)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §12: "Assenza parziale a metà mattina"; decisione fetta 3: avviso col numero delle sole
  // prenotazioni confermate dello stesso barbiere che si sovrappongono a [10:00, 11:30)
  test('assenza parziale 10:00–11:30 sopra due prenotazioni: salvata in UTC, elencata in ora di Roma, con avviso', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const serviceId = await createService(api, { name: uniqueName('Servizio assenza'), durationMin: 20 });
    const barberId = await createBarber(api, uniqueName('Barbiere assenza'), [serviceId]);
    const otherBarber = await createBarber(api, uniqueName('Barbiere altro'), [serviceId]);
    const date = randomWinterDate();
    const bookings = [
      // 10:00–10:20: dentro l'assenza
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '10:00') }),
      // 11:20–11:40: sovrapposta solo in parte (finisce dopo l'assenza)
      await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '11:20') }),
    ];
    // Non vanno contate: 09:40–10:00 finisce quando l'assenza inizia, 10:30 è cancellata,
    // 10:30 di un altro barbiere
    const outside = await createBooking(api, { barberId, serviceId, startsAt: romeWinter(date, '09:40') });
    const cancelled = await createBooking(api, {
      barberId,
      serviceId,
      startsAt: romeWinter(date, '10:30'),
      status: 'cancelled_by_shop',
    });
    const otherBarbers = await createBooking(api, { barberId: otherBarber, serviceId, startsAt: romeWinter(date, '10:30') });
    const reason = uniqueName('Visita medica');

    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/barbieri/${barberId}/assenze`);
      await expectPath(page, `/admin/barbieri/${barberId}/assenze`);
      await fillTimed(page, `${date}T10:00`, `${date}T11:30`, reason);
      await saveButton(page).click();

      await expect(page.getByText(sf('admin.period.overlapsBookings', { count: 2 }))).toBeVisible();

      // SPEC §9: salvata in UTC (gennaio/febbraio: Roma = UTC+1)
      const saved = await api.get<Array<PeriodRow & { barber_id: string }>>(
        `/rest/v1/time_off?select=id,barber_id,starts_at,ends_at,reason&reason=eq.${encodeURIComponent(reason)}`,
      );
      expect(saved).toHaveLength(1);
      expect(saved[0]?.barber_id).toBe(barberId);
      expect(instant(saved[0]?.starts_at ?? '')).toBe(instant(`${date}T09:00:00Z`));
      expect(instant(saved[0]?.ends_at ?? '')).toBe(instant(`${date}T10:30:00Z`));

      // Decisione fetta 3: nessuna cancellazione automatica
      expect(await bookingStatuses(api, [outside, ...bookings])).toEqual(['confirmed', 'confirmed', 'confirmed']);
      expect(await bookingStatuses(api, [cancelled, otherBarbers]).then((list) => [...list].sort())).toEqual([
        'cancelled_by_shop',
        'confirmed',
      ]);

      // Elenco: ora di Roma, non UTC
      await page.reload();
      const row = rowWith(page, reason);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(itDate(date));
      await expect(row).toContainText('10:00');
      await expect(row).toContainText('11:30');
      await expect(row).not.toContainText('09:00');
    } finally {
      await cleanup(api, { barbers: [barberId, otherBarber], services: [serviceId], timeOffReasons: [reason] });
    }
  });

  test('assenza a giornata intera senza prenotazioni: nessun avviso, elencata con le date', async ({ page }) => {
    acceptDialogs(page);
    const api = await adminApi(page.request);
    const barberId = await createBarber(api, uniqueName('Barbiere ferie'));
    const from = randomWinterDate();
    const to = plusDays(from, 4);
    const reason = uniqueName('Ferie');

    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/barbieri/${barberId}/assenze`);
      await fillAllDay(page, from, to, reason);
      await saveButton(page).click();

      const row = rowWith(page, reason);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(itDate(from));
      await expect(row).toContainText(itDate(to));
      await expect(page.getByText(sf('admin.period.overlapsBookings', { count: 0 }))).toHaveCount(0);

      // Decisione fetta 3: "dal X al Y" include tutto Y: fine alle 00:00 del giorno dopo, ora di Roma
      const [saved] = await api.get<PeriodRow[]>(
        `/rest/v1/time_off?select=id,starts_at,ends_at,reason&reason=eq.${encodeURIComponent(reason)}`,
      );
      expect(instant(saved?.starts_at ?? '')).toBe(instant(`${from}T00:00:00+01:00`));
      expect(instant(saved?.ends_at ?? '')).toBe(instant(`${plusDays(to, 1)}T00:00:00+01:00`));

      // Eliminazione
      await row.getByRole('button', { name: s('admin.common.delete'), exact: true }).click();
      await expect(rowWith(page, reason)).toHaveCount(0);
      await expect
        .poll(async () => (await api.get(`/rest/v1/time_off?select=id&reason=eq.${encodeURIComponent(reason)}`)).length)
        .toBe(0);
    } finally {
      await cleanup(api, { barbers: [barberId], timeOffReasons: [reason] });
    }
  });

  test('periodo con fine prima dell\'inizio: errore e nessuna assenza salvata', async ({ page }) => {
    const api = await adminApi(page.request);
    const barberId = await createBarber(api, uniqueName('Barbiere errore'));
    const date = randomWinterDate();
    const reason = uniqueName('Errata');

    try {
      await loginAsAdmin(page);
      await page.goto(`/admin/barbieri/${barberId}/assenze`);
      await fillAllDay(page, date, plusDays(date, -2), reason);
      await disableNativeValidation(page);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.invalid'))).toBeVisible();

      await fillTimed(page, `${date}T11:30`, `${date}T10:00`, reason);
      await disableNativeValidation(page);
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.invalid'))).toBeVisible();

      expect(await api.get(`/rest/v1/time_off?select=id&reason=eq.${encodeURIComponent(reason)}`)).toEqual([]);
    } finally {
      await cleanup(api, { barbers: [barberId], timeOffReasons: [reason] });
    }
  });
});

test.describe('Admin – chiusure del negozio (SPEC §3.5, §6.6)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §12: "Giorno del passaggio all'ora legale" (domenica 28 marzo 2038)
  test('chiusura "dal X al Y" a giornata intera a cavallo dell\'ora legale: elencata e salvata fino a fine Y', async ({
    page,
  }) => {
    acceptDialogs(page);
    const api = await adminApi(page.request);
    const reason = uniqueName('Chiusura ora legale');
    const from = '2038-03-27';
    const to = '2038-03-29';

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/chiusure');
      await expect(page.getByRole('heading', { name: s('admin.nav.closures') })).toBeVisible();
      await fillAllDay(page, from, to, reason);
      await saveButton(page).click();

      const row = rowWith(page, reason);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(itDate(from));
      await expect(row).toContainText(itDate(to));
      await expect(row).not.toContainText(itDate('2038-03-30'));

      const saved = await api.get<PeriodRow[]>(
        `/rest/v1/shop_closures?select=id,starts_at,ends_at,reason&reason=eq.${encodeURIComponent(reason)}`,
      );
      expect(saved).toHaveLength(1);
      // 00:00 del 27/03 (UTC+1) → 00:00 del 30/03 (UTC+2): 71 ore
      expect(instant(saved[0]?.starts_at ?? '')).toBe(instant('2038-03-26T23:00:00Z'));
      expect(instant(saved[0]?.ends_at ?? '')).toBe(instant('2038-03-29T22:00:00Z'));

      // Modifica del motivo
      const renamed = `${reason} bis`;
      await row.getByRole('link', { name: s('admin.common.edit'), exact: true })
        .or(row.getByRole('button', { name: s('admin.common.edit'), exact: true }))
        .click();
      await expect(field(page, 'admin.period.reasonLabel')).toHaveValue(reason);
      await field(page, 'admin.period.reasonLabel').fill(renamed);
      await saveButton(page).click();
      await page.goto('/admin/chiusure');
      await expect(rowWith(page, renamed)).toHaveCount(1);
      const afterEdit = await api.get<PeriodRow[]>(
        `/rest/v1/shop_closures?select=id,starts_at,ends_at,reason&reason=eq.${encodeURIComponent(renamed)}`,
      );
      expect(afterEdit).toHaveLength(1);
      expect(afterEdit[0]?.id).toBe(saved[0]?.id);
      expect(instant(afterEdit[0]?.ends_at ?? '')).toBe(instant('2038-03-29T22:00:00Z'));

      // Eliminazione
      await rowWith(page, renamed).getByRole('button', { name: s('admin.common.delete'), exact: true }).click();
      await expect(rowWith(page, renamed)).toHaveCount(0);
      await cleanup(api, { closureReasons: [renamed] });
    } finally {
      await cleanup(api, { closureReasons: [reason, `${reason} bis`] });
    }
  });

  // Decisione fetta 3: avviso col numero di prenotazioni confermate coinvolte (tutti i barbieri)
  test('chiusura sopra prenotazioni confermate: avviso col numero, prenotazioni intatte', async ({ page }) => {
    const api = await adminApi(page.request);
    const serviceId = await createService(api, { name: uniqueName('Servizio chiusura'), durationMin: 20 });
    const firstBarber = await createBarber(api, uniqueName('Barbiere chiusura A'), [serviceId]);
    const secondBarber = await createBarber(api, uniqueName('Barbiere chiusura B'), [serviceId]);
    const date = randomWinterDate();
    const bookings = [
      await createBooking(api, { barberId: firstBarber, serviceId, startsAt: romeWinter(date, '10:00') }),
      await createBooking(api, { barberId: secondBarber, serviceId, startsAt: romeWinter(date, '15:00') }),
    ];
    // Cancellata e del giorno prima (finisce alle 23:40): non vanno contate
    await createBooking(api, { barberId: firstBarber, serviceId, startsAt: romeWinter(date, '16:00'), status: 'cancelled_by_shop' });
    await createBooking(api, { barberId: secondBarber, serviceId, startsAt: romeWinter(plusDays(date, -1), '23:20') });
    const reason = uniqueName('Chiusura straordinaria');

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/chiusure');
      // Numero atteso letto subito prima: comprende eventuali prenotazioni di altri test sullo stesso giorno
      const expected = await countConfirmedOverlapping(
        api,
        new Date(`${date}T00:00:00+01:00`).toISOString(),
        new Date(`${plusDays(date, 1)}T00:00:00+01:00`).toISOString(),
      );
      expect(expected).toBeGreaterThanOrEqual(2);
      await fillAllDay(page, date, date, reason);
      await saveButton(page).click();

      await expect(page.getByText(sf('admin.period.overlapsBookings', { count: expected }))).toBeVisible();
      expect(await bookingStatuses(api, bookings)).toEqual(['confirmed', 'confirmed']);
    } finally {
      await cleanup(api, { barbers: [firstBarber, secondBarber], services: [serviceId], closureReasons: [reason] });
    }
  });

  // Decisione fetta 3 (utente): /admin/assenze per l'admin collegato a una scheda (seed: Mario)
  // mostra le assenze della sua scheda; senza scheda rimanda a /admin/barbieri (non coperto qui:
  // l'admin demo è sempre collegato)
  test('l\'admin collegato a Mario vede su /admin/assenze solo le assenze di Mario', async ({ page }) => {
    const api = await adminApi(page.request);
    const date = randomWinterDate();
    const mine = uniqueName('Assenza di Mario');
    const others = uniqueName('Assenza di Sara');
    for (const [barberId, reason] of [[SEED.mario, mine], [SEED.sara, others]] as const) {
      await api.post('/rest/v1/time_off?select=id', {
        barber_id: barberId,
        starts_at: romeWinter(date, '09:00'),
        ends_at: romeWinter(date, '10:00'),
        reason,
      });
    }

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/assenze');
      await expectPath(page, '/admin/assenze');
      await expect(rowWith(page, mine)).toHaveCount(1);
      await expect(page.getByText(others)).toHaveCount(0);
    } finally {
      await cleanup(api, { timeOffReasons: [mine, others] });
    }
  });

  // SPEC §2: chiusure e assenze altrui sono solo dell'admin
  test('il barbiere non raggiunge le chiusure né le assenze dei barbieri dall\'area admin', async ({ page }) => {
    await loginAsBarber(page);
    for (const path of ['/admin/chiusure', `/admin/barbieri/${SEED.luca}/assenze`, `/admin/barbieri/${SEED.sara}/assenze`]) {
      await page.goto(path);
      await expectPath(page, '/admin');
    }
  });
});
