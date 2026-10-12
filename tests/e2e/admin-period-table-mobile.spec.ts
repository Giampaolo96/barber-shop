// Tabella di riepilogo delle assenze su telefono (390 px): colonne distanziate come nelle altre
// tabelle admin (Clienti), nessuno scroll orizzontale della pagina (con testi lunghi scorre solo la
// tabella), azioni raggiungibili con aree di tocco di almeno 44 px. La tabella è la stessa di
// Chiusure e delle assenze del singolo barbiere.

import { expect, test } from '@playwright/test';

import { SEED, adminApi, cleanup, createBarber, loginAsAdmin, romeWinter, s, uniqueName, type AdminApi } from './admin-helpers';

test.describe('Assenze, tabella su telefono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let api: AdminApi;
  const barbers: string[] = [];
  const reasons: string[] = [];

  test.beforeEach(async ({ request }) => {
    api = await adminApi(request);
  });

  test.afterEach(async () => {
    await cleanup(api, { timeOffReasons: reasons.splice(0), barbers: barbers.splice(0) });
  });

  test('a 390 px le colonne non si toccano, la pagina non scorre in orizzontale e le azioni sono da 44 px', async ({
    page,
  }) => {
    const barberId = await createBarber(api, uniqueName('Assente'), [SEED.taglio]);
    barbers.push(barberId);
    const reason = uniqueName('Visita');
    reasons.push(reason);
    await api.post('/rest/v1/time_off?select=id', {
      barber_id: barberId,
      starts_at: romeWinter('2041-02-05', '14:30'),
      ends_at: romeWinter('2041-02-06', '11:00'),
      reason,
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/assenze?barbiere=${barberId}`);
    const row = page.locator('main').getByRole('row').filter({ hasText: reason });
    await expect(row).toBeVisible();

    // Fra il testo di una cella e quello della successiva resta spazio (prima "BarbierePeriodo").
    const gaps = await row.locator('td').evaluateAll((cells) =>
      cells.slice(0, -1).map((cell, index) => {
        const textRight = (element: Element): number => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return Math.max(...Array.from(range.getClientRects(), (rect) => rect.right));
        };
        const textLeft = (element: Element): number => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return Math.min(...Array.from(range.getClientRects(), (rect) => rect.left));
        };
        return textLeft(cells[index + 1]) - textRight(cell);
      }),
    );
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'nessuno scroll orizzontale della pagina').toBeLessThanOrEqual(0);

    const viewportWidth = page.viewportSize()?.width ?? 390;
    for (const name of [s('admin.common.edit'), s('admin.common.delete')]) {
      const action = row.getByRole(name === s('admin.common.edit') ? 'link' : 'button', { name, exact: true });
      // Con nome e motivo lunghi le azioni possono stare oltre il bordo: si raggiungono scorrendo la tabella.
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      expect(box, `azione ${name}`).not.toBeNull();
      if (!box) continue;
      expect(box.height, `area di tocco di ${name}`).toBeGreaterThanOrEqual(44);
      expect(box.x, `${name} raggiungibile`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} raggiungibile`).toBeLessThanOrEqual(viewportWidth);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      'nemmeno dopo lo scorrimento della tabella',
    ).toBeLessThanOrEqual(0);
  });
});
