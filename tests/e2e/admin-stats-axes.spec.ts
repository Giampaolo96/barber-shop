// Assi di riferimento del grafico delle statistiche (fetta 9a, miglioria del disegno): per ogni
// periodo offerto dalla pagina (settimana, mese, 3 mesi, anno) compaiono le etichette attese
// sull'asse X (nomi dei giorni, date dei lunedì, mesi con l'anno sul primo) e l'ultima tacca
// dell'asse Y è ≥ del valore più alto della serie, letto dalla tabella dell'andamento. A 390 px
// le etichette visibili non si sovrappongono e restano dentro il grafico. Ogni linea verticale cade
// sul confine fra due barre (nello spazio fra la barra precedente e quella che inizia lì) e non le
// interseca, con qualunque raggruppamento.
//
// Dati: prenotazioni completate su Luca / Taglio in un lunedì di gennaio fra il 1991 e il 1999,
// anni che nessun altro e2e usa. Pulizia nel finally.

import { expect, test, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  cleanup,
  loginAsAdmin,
  plusDays,
  romeWinter,
  s,
  type AdminApi,
} from './admin-helpers';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const weekday = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = domenica

/** Lunedì dal giorno dato in avanti (compreso). */
const mondayFrom = (day: string): string => plusDays(day, (8 - weekday(day)) % 7);

/** "1.234,50 €" o "12" → numero intero (centesimi per gli importi). */
const parseCell = (text: string): number => Number(text.replace(/[^\d]/g, ''));

const xLabels = (page: Page) => page.getByTestId('trend-chart').locator('[data-axis-x]').allTextContents();

/** Valore più alto della colonna dell'andamento (1 = appuntamenti, 2 = incasso). */
const trendMax = async (page: Page, column: 1 | 2): Promise<number> => {
  const rows = page.getByRole('table', { name: s('admin.stats.trendTitle') }).locator('tbody tr');
  const cells = await rows.evaluateAll((trs, index) => trs.map((tr) => tr.children[index]?.textContent ?? ''), column);
  return Math.max(...cells.map(parseCell));
};

const lastYTick = async (page: Page): Promise<number> => {
  const values = await page
    .getByTestId('trend-chart')
    .locator('[data-axis-y]')
    .evaluateAll((spans) => spans.map((span) => Number(span.getAttribute('data-axis-y'))));
  expect(values.length).toBeGreaterThanOrEqual(3);
  expect(values.length).toBeLessThanOrEqual(5);
  return Math.max(...values);
};

/**
 * Ogni linea verticale [data-axis-line] sta fra la barra precedente e la barra del giorno indicato,
 * senza toccarle. Restituisce il numero di linee.
 */
const expectLinesBetweenBars = async (page: Page): Promise<number> => {
  const lines = await page.getByTestId('trend-chart').evaluate((chart) => {
    const bars = [...chart.querySelectorAll('[data-bar]')];
    return [...chart.querySelectorAll('[data-axis-line]')].map((line) => {
      const day = line.getAttribute('data-axis-line');
      const index = bars.findIndex((bar) => bar.getAttribute('data-bar') === day);
      const drawn = (line.firstElementChild ?? line).getBoundingClientRect();
      return {
        day,
        index,
        left: drawn.left,
        right: drawn.right,
        width: drawn.width,
        previousRight: bars[index - 1]?.getBoundingClientRect().right ?? Number.NaN,
        nextLeft: bars[index]?.getBoundingClientRect().left ?? Number.NaN,
      };
    });
  });
  for (const line of lines) {
    expect(line.index, `linea ${line.day} senza la sua barra`).toBeGreaterThan(0);
    expect(line.width, `linea ${line.day} invisibile`).toBeGreaterThan(0);
    expect(line.left, `linea ${line.day} dentro la barra precedente`).toBeGreaterThanOrEqual(line.previousRight - 0.01);
    expect(line.right, `linea ${line.day} dentro la barra del confine`).toBeLessThanOrEqual(line.nextLeft + 0.01);
  }
  return lines.length;
};

/**
 * Prenotazioni completate di un ospite nel giorno dato, una all'ora dalle 9:00. `utcOffset` è
 * l'offset di Roma in quel giorno ("+01:00" d'inverno, "+02:00" con l'ora legale).
 */
const completedBookings = async (
  api: AdminApi,
  day: string,
  count: number,
  utcOffset = '+01:00',
): Promise<string[]> => {
  const ids: string[] = [];
  for (let hour = 9; hour < 9 + count; hour += 1) {
    const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
      guest_name: 'E2E Assi statistiche',
      guest_phone: '+393330000000',
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(day, `${String(hour).padStart(2, '0')}:00`).replace('+01:00', utcOffset),
      source: 'manual',
      status: 'completed',
    });
    ids.push(rows[0]?.id ?? '');
  }
  return ids;
};

test.describe('Statistiche: assi di riferimento del grafico', () => {
  test.use({ viewport: DESKTOP });

  test('ogni periodo mostra le etichette attese e una scala Y che contiene il massimo', async ({ page }) => {
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const year = randomInt(1991, 1999);
    const monday = mondayFrom(`${year}-01-08`);

    try {
      bookings.push(...(await completedBookings(api, monday, 3)));

      const mondaysOfJanuary: string[] = [];
      for (let day = mondayFrom(`${year}-01-01`); day <= `${year}-01-31`; day = plusDays(day, 7)) {
        mondaysOfJanuary.push(`${Number(day.slice(8))} gen`);
      }

      const periods = [
        { name: 'settimana', from: monday, to: plusDays(monday, 6), labels: ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'] },
        { name: 'mese', from: `${year}-01-01`, to: `${year}-01-31`, labels: mondaysOfJanuary },
        { name: '3 mesi', from: `${year}-01-01`, to: `${year}-03-31`, labels: [`gen ${year}`, 'feb', 'mar'] },
        { name: 'anno', from: `${year}-01-01`, to: `${year}-12-31`, labels: [`gen ${year}`, ...MONTHS.slice(1)] },
      ];

      await loginAsAdmin(page);
      for (const period of periods) {
        for (const [chart, column] of [['prenotazioni', 1], ['incasso', 2]] as const) {
          await test.step(`${period.name}, ${chart}`, async () => {
            await page.goto(`/admin/statistiche?dal=${period.from}&al=${period.to}&raggruppa=giorno&grafico=${chart}`);
            await expect(page.getByTestId('trend-chart')).toBeVisible();
            // Il disegno è decorativo: per lo screen reader c'è il riepilogo (e la tabella)
            await expect(page.getByTestId('trend-chart')).toHaveAttribute('aria-hidden', 'true');
            await expect(page.locator('figure .sr-only')).toContainText(s('admin.stats.trendTitle'));
            expect(await xLabels(page)).toEqual(period.labels);
            const max = await trendMax(page, column);
            expect(max).toBeGreaterThan(0);
            expect(await lastYTick(page)).toBeGreaterThanOrEqual(max);
            await expectLinesBetweenBars(page);
          });
        }
      }

      // Barre per settimana (l'inizio del mese cade a metà settimana) e per mese (una linea fra due
      // anni): le linee restano sui confini fra due barre.
      const grouped = [
        { from: `${year}-01-01`, to: `${year}-03-31`, granularity: 'settimana', lines: 2 },
        { from: `${year}-01-01`, to: `${year}-12-31`, granularity: 'settimana', lines: 11 },
        { from: `${year - 1}-11-01`, to: `${year}-02-28`, granularity: 'mese', lines: 1 },
        { from: `${year}-01-01`, to: `${year}-01-31`, granularity: 'mese', lines: 0 },
      ];
      for (const period of grouped) {
        await test.step(`${period.from} – ${period.to} per ${period.granularity}`, async () => {
          await page.goto(`/admin/statistiche?dal=${period.from}&al=${period.to}&raggruppa=${period.granularity}`);
          await expect(page.getByTestId('trend-chart')).toBeVisible();
          expect(await expectLinesBetweenBars(page)).toBe(period.lines);
        });
      }
    } finally {
      await cleanup(api, { bookings });
    }
  });

  test("a 390 px le etichette visibili dell'asse X non si sovrappongono e restano nel grafico", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const year = randomInt(1991, 1999);
    // A maggio le date dei lunedì sono fra le più larghe ("18 mag", "25 mag"): il caso peggiore
    const monday = mondayFrom(`${year}-05-15`);

    try {
      // 12 appuntamenti in un giorno: l'asse Y dell'incasso arriva alle centinaia di euro e si allarga
      bookings.push(...(await completedBookings(api, monday, 12, '+02:00')));
      await loginAsAdmin(page);

      // 41 giorni: 5 lunedì tutti visibili; 47 giorni: 6 lunedì, uno sì e uno no; un anno: mesi alternati
      const periods = [
        [plusDays(monday, -20), plusDays(monday, 20)],
        [plusDays(monday, -20), plusDays(monday, 26)],
        [`${year}-01-01`, `${year}-12-31`],
      ];
      for (const [from, to] of periods) {
        for (const chart of ['prenotazioni', 'incasso']) {
          await test.step(`${from} – ${to}, ${chart}`, async () => {
            await page.goto(`/admin/statistiche?dal=${from}&al=${to}&grafico=${chart}`);
            await expectLinesBetweenBars(page);
            const area = await page.getByTestId('trend-chart').boundingBox();
            expect(area).not.toBeNull();
            const boxes = [];
            for (const label of await page.getByTestId('trend-chart').locator('[data-axis-x]').all()) {
              if (await label.isVisible()) boxes.push(await label.boundingBox());
            }
            expect(boxes.length).toBeGreaterThanOrEqual(3);
            for (const [index, box] of boxes.entries()) {
              expect(box).not.toBeNull();
              if (!box || !area) continue;
              expect(box.x).toBeGreaterThanOrEqual(area.x - 0.5);
              expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
              const previous = boxes[index - 1];
              if (previous) expect(box.x, 'etichette sovrapposte').toBeGreaterThanOrEqual(previous.x + previous.width + 4);
            }
          });
        }
      }
    } finally {
      await cleanup(api, { bookings });
    }
  });
});
