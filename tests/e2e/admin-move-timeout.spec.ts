// Spostamento senza risposta dal server (fetta 8h, ADR 008): dopo 15 s i comandi del calendario
// tornano attivi, la scheda torna al suo posto e compare un errore con "Chiudi".
import { expect, test } from '@playwright/test';

import {
  adminApi,
  cleanup,
  clearBookings,
  createBooking,
  DESKTOP,
  loginAsAdmin,
  romeWinter,
  s,
  SEED,
  testDate,
} from './admin-helpers';

test('nessuna risposta entro 15 s: errore con "Chiudi" e comandi di nuovo attivi', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = testDate();
  await clearBookings(api, [SEED.luca], date);
  const id = await createBooking(api, { barberId: SEED.luca, serviceId: SEED.barba, startsAt: romeWinter(date, '09:15') });
  // La risposta non arriva mai.
  const never = new Promise<void>(() => undefined);
  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    await page.route(
      (url) => url.pathname === '/admin',
      async (route) => {
        if (route.request().method() === 'POST') await never;
        await route.fallback();
      },
    );

    const card = page.locator('main').getByRole('link', { name: /E2E Ospite/ });
    const before = await card.boundingBox();
    const x = (before?.x ?? 0) + 40;
    const y = (before?.y ?? 0) + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 20, { steps: 5 });
    await page.mouse.move(x, y + 72, { steps: 10 });
    await page.mouse.up();

    const notice = page.locator('[data-move-notice="true"]');
    const nextDay = page.getByRole('link', { name: s('admin.calendar.nextDay'), exact: true });
    await expect(notice).toContainText(s('admin.calendar.move.saving'));
    await expect(nextDay).toHaveAttribute('aria-disabled', 'true');

    await expect(notice).toContainText(s('admin.calendar.move.timeout'), { timeout: 20_000 });
    await expect(nextDay).not.toHaveAttribute('aria-disabled');
    expect((await card.boundingBox())?.y).toBe(before?.y);
    await notice.getByRole('button', { name: s('admin.calendar.move.close'), exact: true }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await cleanup(api, { bookings: [id] });
  }
});
