// Tabella dei servizi su telefono (390 px), come quella delle assenze: colonne distanziate (prima
// "45 min20,00 €"), durata e prezzo su una riga, nessuno scroll orizzontale della pagina e azioni
// con aree di tocco di almeno 44 px.

import { expect, test } from '@playwright/test';

import { adminApi, cleanup, createService, loginAsAdmin, s, uniqueName, type AdminApi } from './admin-helpers';

test.describe('Servizi, tabella su telefono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let api: AdminApi;
  const services: string[] = [];

  test.beforeEach(async ({ request }) => {
    api = await adminApi(request);
  });

  test.afterEach(async () => {
    await cleanup(api, { services: services.splice(0) });
  });

  test('a 390 px le colonne non si toccano, durata e prezzo stanno su una riga e le azioni sono da 44 px', async ({
    page,
  }) => {
    const name = uniqueName('Taglio e Barba');
    // Dopo i servizi del seed: ha almeno "Su", oltre a Modifica ed Elimina
    services.push(await createService(api, { name, durationMin: 45, priceCents: 2000, sortOrder: 999 }));

    await loginAsAdmin(page);
    await page.goto('/admin/servizi');
    const row = page.locator('main').getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();

    const cells = await row.locator('td').evaluateAll((tds) => {
      const rects = (element: Element): DOMRect[] => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
      };
      return tds.map((td) => {
        const list = rects(td);
        return {
          left: Math.min(...list.map((rect) => rect.left)),
          right: Math.max(...list.map((rect) => rect.right)),
          lines: new Set(list.map((rect) => Math.round(rect.top))).size,
        };
      });
    });
    expect(cells).toHaveLength(4);
    // Fra il testo di una cella e quello della successiva resta spazio
    for (let index = 0; index < 3; index += 1) {
      expect(cells[index + 1].left - cells[index].right, `spazio dopo la colonna ${index + 1}`).toBeGreaterThanOrEqual(12);
    }
    expect(cells[1].lines, 'durata su una riga').toBe(1);
    expect(cells[2].lines, 'prezzo su una riga').toBe(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'nessuno scroll orizzontale della pagina').toBeLessThanOrEqual(0);

    const viewportWidth = page.viewportSize()?.width ?? 390;
    const actions = [
      row.getByRole('link', { name: s('admin.common.edit'), exact: true }),
      row.getByRole('button', { name: s('admin.common.moveUp'), exact: true }),
      row.getByRole('button', { name: s('admin.common.delete'), exact: true }),
    ];
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.height, 'area di tocco').toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      'nemmeno dopo lo scorrimento della tabella',
    ).toBeLessThanOrEqual(0);
  });
});
