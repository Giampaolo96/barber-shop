// Servizi su telefono (390 px), riscritto per la fetta 8j (intervento 6): al posto della tabella una
// lista come quella di Clienti (<ul data-testid="services-list">). Ogni riga ha nome, durata e prezzo
// su una riga, azioni da almeno 44 px dentro lo schermo, Su e Giù affiancati; la pagina non scorre in
// orizzontale.

import { expect, test } from '@playwright/test';

import { adminApi, cleanup, createService, loginAsAdmin, s, uniqueName, type AdminApi } from './admin-helpers';

test.describe('Servizi, lista su telefono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let api: AdminApi;
  const services: string[] = [];

  test.beforeEach(async ({ request }) => {
    api = await adminApi(request);
  });

  test.afterEach(async () => {
    await cleanup(api, { services: services.splice(0) });
  });

  test('a 390 px una lista invece della tabella: durata e prezzo su una riga, azioni da 44 px, Su e Giù affiancati', async ({
    page,
  }) => {
    const name = uniqueName('Taglio e Barba');
    // Dopo i servizi del seed e prima di un altro: ha sia "Su" sia "Giù", oltre a Modifica ed Elimina
    services.push(await createService(api, { name, durationMin: 45, priceCents: 2000, sortOrder: 999 }));
    services.push(await createService(api, { name: uniqueName('Ultimo'), sortOrder: 1000 }));

    await loginAsAdmin(page);
    await page.goto('/admin/servizi');

    await expect(page.locator('main table')).toBeHidden();
    const item = page.getByTestId('services-list').getByRole('listitem').filter({ hasText: name });
    await expect(item).toHaveCount(1);

    const lines = (text: RegExp): Promise<number> =>
      item.getByText(text).first().evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        ).size;
      });
    await expect(item).toContainText('45 min');
    await expect(item).toContainText(/20,00\s€/);
    expect(await lines(/45 min/), 'durata su una riga').toBe(1);
    expect(await lines(/20,00\s€/), 'prezzo su una riga').toBe(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'nessuno scroll orizzontale della pagina').toBeLessThanOrEqual(0);

    const viewportWidth = page.viewportSize()?.width ?? 390;
    const up = item.getByRole('button', { name: s('admin.common.moveUp'), exact: true });
    const down = item.getByRole('button', { name: s('admin.common.moveDown'), exact: true });
    const actions = [
      item.getByRole('link', { name: s('admin.common.edit'), exact: true }),
      up,
      down,
      item.getByRole('button', { name: s('admin.common.delete'), exact: true }),
    ];
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.height, 'area di tocco').toBeGreaterThanOrEqual(44);
      expect(box.width, 'area di tocco').toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
    }

    const upBox = await up.boundingBox();
    const downBox = await down.boundingBox();
    expect(Math.abs((upBox?.y ?? 0) - (downBox?.y ?? 1)), 'Su e Giù sulla stessa riga').toBeLessThanOrEqual(1);
  });
});
