// Regressione della prova su iPhone (fetta 8, scritta durante la correzione, non da spec-qa).
// Con il service worker installato e senza rete, la navigazione a / mostra la pagina offline e la
// pagina resta lì: niente idratazione di Next, niente script mancanti, niente schermata d'errore.
// In CI gira sulla build di produzione (che registra il worker da sé); in sviluppo il worker non
// si registra, quindi lo registra il test.
import { expect, test } from '@playwright/test';

import { s } from './admin-helpers';

test('offline: la navigazione a / mostra la pagina offline e resta visibile, senza errori', async ({ page, context }) => {
  await page.goto('/accedi');
  await page.evaluate(async () => {
    if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Solo la cache dell'installazione: la pagina offline, nessuno script delle pagine visitate.
  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (path === '/offline') paths.push(path);
        else await cache.delete(request);
      }
    }
    return paths;
  });
  expect(cached).toEqual(['/offline']);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await context.setOffline(true);
  await page.goto('/').catch(() => undefined);
  const title = page.getByRole('heading', { name: s('offline.title') });
  await expect(title).toBeVisible();
  await expect(page.getByRole('button', { name: s('offline.retry') })).toBeVisible();

  // La schermata d'errore di Next compariva dopo circa un secondo: si osserva per qualche secondo.
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(500);
    await expect(title).toBeVisible();
    await expect(page.getByText(/couldn.t load|Application error/i)).toHaveCount(0);
  }
  expect(page.url()).toMatch(/\/$/);
  expect(errors).toEqual([]);

  // "Riprova" senza rete ricarica e resta sulla pagina offline
  await page.getByRole('button', { name: s('offline.retry') }).click();
  await expect(title).toBeVisible();
  await context.setOffline(false);
});
