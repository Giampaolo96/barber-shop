// Test di accettazione e2e – FETTA 0 (SPEC §11: "Pagina vuota online, test che girano in CI").
// Usa `baseURL` e `webServer` di playwright.config.ts.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test } from '@playwright/test';

// Percorso relativo voluto: non dipende dalla risoluzione dell'alias `@/*` in Playwright.
import { it } from '../../src/i18n/it';

test.describe('Home cliente – fumo (SPEC §11 fetta 0)', () => {
  // SPEC §11 fetta 0: "Pagina vuota online"
  test('la home risponde 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
  });

  // SPEC §9: "Lingua: italiano"
  test('<html> dichiara lang="it"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  });

  // SPEC §5.1 (Home: info negozio) + SPEC §9 (testi centralizzati in src/i18n/it.ts)
  test('mostra il nome del negozio in un heading', async ({ page }) => {
    expect(it.shop.name.trim()).not.toBe('');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: it.shop.name })).toBeVisible();
  });

  // SPEC §11 fetta 0: la pagina si carica senza errori
  test('nessun errore in console e nessun pageerror durante il caricamento', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    await page.goto('/');
    // Attende il rendering dell'heading, così eventuali errori di idratazione vengono raccolti.
    await expect(page.getByRole('heading', { name: it.shop.name })).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
