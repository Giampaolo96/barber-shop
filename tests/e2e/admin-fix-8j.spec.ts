// Correzioni dopo la review della fetta 8j: sfondo delle righe occupate (M2), voce attiva del menu,
// spazio sopra la griglia, area di tocco delle schede da 15 minuti.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  adminApi,
  adminNavLink,
  cleanup,
  DESKTOP,
  loginAsAdmin,
  romeWinter,
  s,
  SEED,
  uniqueName,
  type AdminApi,
} from './admin-helpers';

const PHONE = { width: 390, height: 844 };

/** Mercoledì d'inverno del test numero `slot`, anni che nessun altro e2e usa: niente collisioni. */
const ownDate = (slot: number): string => {
  const day = new Date(Date.UTC(2051 + slot, 0, 15, 12));
  day.setUTCDate(day.getUTCDate() + ((10 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
};

/** Trascina la scheda di `rows` righe in basso. */
const dragDown = async (page: Page, card: Locator, rows: number): Promise<void> => {
  const box = await card.boundingBox();
  const x = (box?.x ?? 0) + 40;
  const y = (box?.y ?? 0) + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 20, { steps: 5 });
  await page.mouse.move(x, y + rows * 36, { steps: 10 });
  await page.mouse.up();
};

const booking = async (api: AdminApi, guestName: string, startsAt: string, durationMin?: number): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: guestName,
    guest_phone: '+393330000000',
    barber_id: SEED.luca,
    service_id: SEED.barba,
    starts_at: startsAt,
    source: 'manual',
    status: 'confirmed',
  });
  const id = rows[0]?.id ?? '';
  if (durationMin !== undefined) await api.patch(`/rest/v1/bookings?id=eq.${id}&select=id`, { duration_min: durationMin });
  return id;
};

test('settimana: una riga occupata fuori orario resta segnata come fuori orario (M2)', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownDate(0);
  const id = await booking(api, uniqueName('Fuori orario'), romeWinter(date, '13:30'));
  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?vista=settimana&data=${date}&barbiere=${SEED.luca}`);
    const busy = page.locator(`main [title="${s('admin.calendar.bufferBlock')}"]`).first();
    await expect(busy).toBeAttached();
    await expect(busy).toHaveClass(/\bbg-disabled\b/);
  } finally {
    await cleanup(api, { bookings: [id] });
  }
});

test('voce attiva del menu: niente pieno né bagliore, filetto a sinistra su desktop e sotto su telefono', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await loginAsAdmin(page);
  await page.goto('/admin/servizi');
  const link = adminNavLink(page, 'admin.nav.services');
  await expect(link).toHaveAttribute('aria-current', 'page');

  const look = () =>
    link.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        shadow: style.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?/g, '') || 'none',
        left: style.borderLeftWidth,
        bottom: style.borderBottomWidth,
      };
    });
  expect(await look()).toEqual({ background: 'rgba(0, 0, 0, 0)', shadow: 'none', left: '2px', bottom: '0px' });

  await page.setViewportSize(PHONE);
  expect(await look()).toEqual({ background: 'rgba(0, 0, 0, 0)', shadow: 'none', left: '0px', bottom: '2px' });
});

test('su desktop la griglia parte subito sotto la barra del calendario', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownDate(1);
  const id = await booking(api, uniqueName('Spazio'), romeWinter(date, '10:00'));
  try {
    await loginAsAdmin(page);
    for (const view of ['giorno', 'settimana']) {
      await page.goto(`/admin?data=${date}&vista=${view}`);
      const newBooking = page.getByRole('link', { name: s('admin.calendar.newBooking'), exact: true });
      const bar = await newBooking.boundingBox();
      const header = await page.getByText(s('admin.calendar.timeColumn'), { exact: true }).first().boundingBox();
      expect((header?.y ?? 0) - ((bar?.y ?? 0) + (bar?.height ?? 0)), `spazio nella vista ${view}`).toBeLessThanOrEqual(24);
    }
  } finally {
    await cleanup(api, { bookings: [id] });
  }
});

const notice = (page: Page): Locator => page.locator('[data-move-notice="true"]');

test('su desktop il riquadro di spostamento non sposta la griglia, sta lontano dalle intestazioni e sparisce da solo', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownDate(10);
  const guest = uniqueName('Avviso');
  const id = await booking(api, guest, romeWinter(date, '09:15'));
  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    const header = page.locator('main').getByRole('heading', { name: 'Luca', exact: true });
    const headerBefore = await header.boundingBox();
    await dragDown(page, page.locator('main').getByRole('link', { name: new RegExp(guest) }), 2);

    await expect(notice(page)).toContainText(s('admin.calendar.move.saved'));
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(headerBefore?.y);
    await expect(notice(page)).toHaveCSS('pointer-events', 'none');
    const undo = notice(page).getByRole('button', { name: s('admin.calendar.move.undo'), exact: true });
    await expect(undo).toHaveCSS('pointer-events', 'auto');
    expect((await notice(page).boundingBox())?.y ?? 0, 'in basso, lontano dalle intestazioni').toBeGreaterThan(
      (headerBefore?.y ?? 0) + 44,
    );

    // "Annulla" scade dopo 8 s, il messaggio dopo altri 8
    await expect(undo).toHaveCount(0, { timeout: 10_000 });
    await expect(notice(page)).toContainText(s('admin.calendar.move.saved'));
    await expect(notice(page)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await cleanup(api, { bookings: [id] });
  }
});

test('un errore di spostamento resta finché non si preme "Chiudi", da 44 px', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownDate(11);
  const guest = uniqueName('Errore');
  const ids = [
    await booking(api, guest, romeWinter(date, '09:15')),
    await booking(api, uniqueName('Occupa'), romeWinter(date, '09:45')),
  ];
  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    await dragDown(page, page.locator('main').getByRole('link', { name: new RegExp(guest) }), 2);

    await expect(notice(page)).toContainText(s('admin.calendar.errors.barberBusy'));
    await page.waitForTimeout(8_500);
    const close = notice(page).getByRole('button', { name: s('admin.calendar.move.close'), exact: true });
    await expect(close).toBeVisible();
    expect((await close.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(notice(page)).toHaveCount(0);
  } finally {
    await cleanup(api, { bookings: ids });
  }
});

test('cambiando giorno o settimana l\'avviso sparisce', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownDate(12);
  const guest = uniqueName('Cambio giorno');
  const id = await booking(api, guest, romeWinter(date, '09:15'));
  try {
    await loginAsAdmin(page);
    for (const [view, name] of [
      ['giorno', 'admin.calendar.nextDay'],
      ['settimana', 'admin.calendar.nextWeek'],
    ] as const) {
      await page.goto(`/admin?data=${date}&vista=${view}&barbiere=${SEED.luca}`);
      await dragDown(page, page.locator('main').getByRole('link', { name: new RegExp(guest) }), 1);
      await expect(notice(page)).toContainText(s('admin.calendar.move.saved'));
      await page.getByRole('link', { name: s(name), exact: true }).click();
      await expect(notice(page)).toHaveCount(0);
    }
  } finally {
    await cleanup(api, { bookings: [id] });
  }
});

test('scheda da 15 minuti su telefono: altezza reale, area di tocco da 44 px, nessuna sovrapposizione', async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const api = await adminApi(page.request);
  const date = ownDate(2);
  const first = uniqueName('Quindici');
  const second = uniqueName('Successiva');
  const ids = [
    await booking(api, first, romeWinter(date, '10:00'), 15),
    await booking(api, second, romeWinter(date, '10:15')),
  ];
  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    const next = page.locator('main').getByRole('link', { name: new RegExp(second) });

    await expect(next).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // Misure e tocchi nello stesso passaggio: nulla si sposta fra gli uni e gli altri
    const measured = await page.evaluate(
      ([firstId, secondId]) => {
        const first = document.querySelector(`main a[href$="${firstId}"]`) as HTMLElement;
        const second = document.querySelector(`main a[href$="${secondId}"]`) as HTMLElement;
        first.scrollIntoView({ block: 'center' });
        const box = first.getBoundingClientRect();
        const nextBox = second.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const hrefAt = (y: number) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') ?? null;
        return {
          height: box.height,
          tapArea: Number.parseFloat(getComputedStyle(first, '::after').height),
          gap: hrefAt(box.bottom + 0.5),
          next: hrefAt(nextBox.top + 0.5),
        };
      },
      [ids[0], ids[1]],
    );
    expect(measured.height).toBeCloseTo(42, 0);
    expect(measured.tapArea).toBeGreaterThanOrEqual(44);
    expect(measured.gap).toContain(ids[0]);
    expect(measured.next).toContain(ids[1]);
  } finally {
    await cleanup(api, { bookings: ids });
  }
});
