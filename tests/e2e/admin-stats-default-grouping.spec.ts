// Raggruppamento predefinito in base al periodo (fetta 9a, SPEC §6.9): senza una scelta in "Mostra
// per" la settimana e il mese vanno per giorno, gli ultimi 3 mesi per settimana, l'anno per mese.
// Una scelta esplicita vale anche cambiando periodo; "Automatico" torna al predefinito.
//
// Le righe della tabella dell'andamento sono i bucket del grafico: si contano quelle, che ci sono
// anche senza prenotazioni. Per vedere le barre dell'anno serve almeno un appuntamento: uno su Luca
// in un giorno di gennaio dell'anno in corso, alle 7, fuori dagli orari usati dagli altri e2e.
// Pulizia nel finally.

import { expect, test, type Page } from '@playwright/test';

import { DESKTOP, SEED, adminApi, cleanup, loginAsAdmin, romeWinter, s } from './admin-helpers';

const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const pad = (value: number): string => String(value).padStart(2, '0');

const trendRows = (page: Page) =>
  page.getByRole('table', { name: s('admin.stats.trendTitle') }).locator('tbody tr');
const groupBy = (page: Page) => page.getByLabel(s('admin.stats.groupByLabel'), { exact: true });
const shortcut = (page: Page, key: string) =>
  page.getByRole('navigation', { name: s('admin.stats.shortcutsLabel') }).getByRole('link', {
    name: s(`admin.stats.shortcuts.${key}`),
    exact: true,
  });
const raggruppa = (page: Page): string | null => new URL(page.url()).searchParams.get('raggruppa');

/** Apre un periodo rapido e aspetta la pagina del suo link. */
const openShortcut = async (page: Page, key: string): Promise<void> => {
  const link = shortcut(page, key);
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  await link.click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
};

/** Giorni del mese corrente secondo il calendario di Roma. */
const daysInCurrentMonth = (): number => {
  const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year ?? 2026, month ?? 1, 0)).getUTCDate();
};

test.describe('Statistiche: raggruppamento predefinito in base al periodo', () => {
  test("a 390 px Quest'anno apre per mese con 12 barre visibili", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date()));

    try {
      const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
        guest_name: 'E2E Raggruppamento',
        guest_phone: '+393330000000',
        barber_id: SEED.luca,
        service_id: SEED.taglio,
        starts_at: romeWinter(`${year}-01-${pad(randomInt(2, 28))}`, `07:${pad(randomInt(0, 29))}`),
        source: 'manual',
        status: 'confirmed',
      });
      bookings.push(rows[0]?.id ?? '');

      await loginAsAdmin(page);
      await page.goto('/admin/statistiche');
      await openShortcut(page, 'thisYear');

      await expect.poll(() => new URL(page.url()).searchParams.get('dal')).toBe(`${year}-01-01`);
      expect(raggruppa(page), 'il predefinito resta fuori dall\'URL').toBeNull();
      await expect(groupBy(page)).toHaveValue('');
      await expect(trendRows(page)).toHaveCount(12);

      const bars = page.getByTestId('trend-chart').locator('[data-bar]');
      await expect(bars).toHaveCount(12);
      for (const bar of await bars.all()) {
        const box = await bar.boundingBox();
        expect(box?.width ?? 0, 'barra troppo stretta per vedersi').toBeGreaterThanOrEqual(15);
      }
      // Un'etichetta del mese sotto la barra di gennaio, con l'anno
      await expect(page.getByTestId('trend-chart').locator(`[data-axis-x="${year}-01-01"]`)).toHaveText(`gen ${year}`);
    } finally {
      await cleanup(api, { bookings });
    }
  });

  test('ogni periodo rapido ha il suo predefinito; una scelta esplicita vale finché non si torna ad Automatico', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page);
    await page.goto('/admin/statistiche');

    // Predefiniti: mese → per giorno, 3 mesi → per settimana, anno → per mese, settimana → per giorno
    await expect(trendRows(page)).toHaveCount(daysInCurrentMonth());
    await openShortcut(page, 'last3Months');
    await expect.poll(() => raggruppa(page)).toBeNull();
    await expect(groupBy(page)).toHaveValue('');
    const weeks = await trendRows(page).count();
    expect(weeks).toBeGreaterThanOrEqual(13);
    expect(weeks).toBeLessThanOrEqual(15);
    await openShortcut(page, 'thisYear');
    await expect(trendRows(page)).toHaveCount(12);
    await openShortcut(page, 'thisWeek');
    await expect(trendRows(page)).toHaveCount(7);

    // Scelta esplicita "Giorno" sull'anno: vale, e resta passando a un altro periodo rapido
    await openShortcut(page, 'thisYear');
    await expect(trendRows(page)).toHaveCount(12);
    await groupBy(page).selectOption('giorno');
    await page.getByRole('button', { name: s('admin.stats.apply'), exact: true }).click();
    await expect.poll(() => raggruppa(page)).toBe('giorno');
    expect(await trendRows(page).count()).toBeGreaterThanOrEqual(365);
    await openShortcut(page, 'last3Months');
    await expect.poll(() => raggruppa(page)).toBe('giorno');
    await expect(groupBy(page)).toHaveValue('giorno');
    expect(await trendRows(page).count()).toBeGreaterThanOrEqual(89);

    // "Automatico" toglie la scelta: torna il predefinito del periodo
    await groupBy(page).selectOption('');
    await page.getByRole('button', { name: s('admin.stats.apply'), exact: true }).click();
    await expect(groupBy(page)).toHaveValue('');
    const automatic = await trendRows(page).count();
    expect(automatic).toBeGreaterThanOrEqual(13);
    expect(automatic).toBeLessThanOrEqual(15);
  });
});
