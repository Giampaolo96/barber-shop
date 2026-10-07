// Regressione dall'indagine sull'e2e instabile della fetta 6c (ADR 008): con molte colonne la griglia
// scorre in orizzontale e, trascinando verso il bordo, l'autoscroll la fa scorrere sotto il puntatore.
// Durante il trascinamento la scheda mostra barbiere e orario di arrivo ("Mario, 10:30") e la colonna
// di arrivo è evidenziata, anche durante l'autoscroll; al rilascio la prenotazione finisce proprio lì.
//
// Prerequisiti: Supabase locale con il seed. Le colonne extra sono barbieri "E2E …" (in ordine
// alfabetico prima di Luca), creati e rimossi da questo test.

import { expect, test, type Page } from '@playwright/test';

import { DESKTOP, SEED, adminApi, cleanup, createBarber, instant, loginAsAdmin, romeWinter, s, uniqueName } from './admin-helpers';

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/** Mercoledì di gennaio/febbraio futuro (giorno lavorativo per il seed). */
const futureWednesday = (): string => {
  const day = new Date(Date.UTC(randomInt(2032, 2049), randomInt(0, 1), randomInt(5, 25), 12));
  day.setUTCDate(day.getUTCDate() + ((3 - day.getUTCDay() + 7) % 7));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
};

const EXTRA_COLUMNS = 6;

/** Contenitore della griglia che scorre in orizzontale. */
const scroller = (page: Page) => page.locator('main .overflow-x-auto').first();

test.use({ viewport: DESKTOP, isMobile: false, hasTouch: false });

test('trascinando verso il bordo la griglia scorre e la prenotazione finisce nella colonna indicata', async ({ page }) => {
  const api = await adminApi(page.request);
  const date = futureWednesday();
  const names = Array.from({ length: EXTRA_COLUMNS }, (_, index) => uniqueName(`Colonna extra ${index + 1}`));
  const extras: string[] = [];
  for (const name of names) extras.push(await createBarber(api, name, [SEED.taglio]));
  const idByName = new Map<string, string>([
    ['Luca', SEED.luca],
    ['Mario', SEED.mario],
    ['Sara', SEED.sara],
    ...names.map((name, index): [string, string] => [name, extras[index] ?? '']),
  ]);
  const guestName = uniqueName('Ospite autoscroll');
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: guestName,
    guest_phone: '+393330000661',
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: romeWinter(date, '10:00'),
    source: 'manual',
    status: 'confirmed',
  });
  const id = rows[0]?.id ?? '';

  try {
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    const card = page.locator('main [data-draggable="true"]').filter({ hasText: guestName });
    await expect(card).toHaveCount(1);

    // La griglia è più larga del contenitore; si parte con la scheda di Luca appena visibile a destra,
    // così restano da scorrere le colonne successive (Mario, Sara).
    const container = scroller(page);
    const overflow = await container.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'con le colonne extra la griglia deve scorrere in orizzontale').toBeGreaterThan(0);
    await card.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'end' }));
    const startScroll = await container.evaluate((element) => element.scrollLeft);
    expect(startScroll, 'deve restare spazio per scorrere a destra').toBeLessThan(overflow);

    // Trascina verso il bordo destro del contenitore e resta lì: l'autoscroll porta la griglia in fondo.
    const from = await card.boundingBox();
    const area = await container.boundingBox();
    expect(from).not.toBeNull();
    expect(area).not.toBeNull();
    const startX = (from?.x ?? 0) + (from?.width ?? 0) / 2;
    const startY = (from?.y ?? 0) + 10;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY, { steps: 4 });
    const edgeX = (area?.x ?? 0) + (area?.width ?? 0) - 10;
    await page.mouse.move(edgeX, startY, { steps: 20 });
    await expect
      .poll(() => container.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft), {
        message: 'l\'autoscroll deve portare la griglia in fondo',
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(1);
    await page.mouse.move(edgeX - 1, startY);

    // Destinazione mostrata durante il trascinamento: "Barbiere, 10:00" e colonna evidenziata
    const preview = page.locator('[data-drop-preview]');
    await expect(preview).toHaveCount(1);
    const text = (await preview.textContent()) ?? '';
    const match = /^(.*), 10:00$/.exec(text.trim());
    expect(match, `anteprima inattesa: "${text}"`).not.toBeNull();
    const shownBarber = idByName.get(match?.[1] ?? '');
    expect(shownBarber, `barbiere dell'anteprima sconosciuto: "${match?.[1]}"`).toBeDefined();
    expect(shownBarber).not.toBe(SEED.luca);
    await expect(page.locator(`main [data-drop-target="true"]`)).toHaveAttribute('data-barber-id', shownBarber ?? '');

    await page.mouse.up();

    // Le colonne extra non hanno orari: se compare l'avviso si conferma
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: s('admin.calendar.form.confirmAnyway'), exact: true });
    const saved = page.getByRole('status').filter({ hasText: s('admin.calendar.move.saved') });
    await expect(confirm.or(saved)).toBeVisible();
    if (await confirm.isVisible()) await confirm.click();
    await expect(saved).toBeVisible();

    await expect
      .poll(async () => {
        const [row] = await api.get<Array<{ barber_id: string; starts_at: string }>>(
          `/rest/v1/bookings?select=barber_id,starts_at&id=eq.${id}`,
        );
        return row ? [row.barber_id, instant(row.starts_at)] : null;
      })
      .toEqual([shownBarber, instant(romeWinter(date, '10:00'))]);
  } finally {
    await cleanup(api, { bookings: [id], barbers: extras });
  }
});
