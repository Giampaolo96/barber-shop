// Helper condivisi dagli e2e di "Quando?" a fila continua (fetta 8f, approvata dall'utente il
// 2026-10-25; SPEC §5.2). Non è un file di test.
//
// Contratto del DOM:
//   - fila: role="region", aria-label it.booking.when.rowLabel, attributi data-when-columns e
//     data-initial-day; è l'elemento che scorre in orizzontale (scroll-padding-left 16 px);
//   - colonna disegnata: <section role="group" aria-label=it.booking.when.columnLabel ("Orari di {name},
//     {day}", day = formatDayLabel, es. "mer 21 ott")> con data-day="YYYY-MM-DD" e data-barber="<id>";
//   - segnaposto dei giorni non disegnati: aria-hidden, con data-day;
//   - striscia: link a[data-day] con aria-current="date" sul giorno selezionato.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, type Locator, type Page } from '@playwright/test';
import { it as itLocale } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

import { s, sf } from './admin-helpers';

/** Come formatDayLabel di src/lib/booking/format.ts: "mer 21 ott". */
export const dayLabel = (date: string): string =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), 'UTC', 'EEE d MMM', { locale: itLocale });

/** Come dayParts di src/lib/booking/format.ts: { weekday: "mer", day: "21" }. */
export const dayPartsOf = (date: string): { weekday: string; day: string } => {
  const noon = new Date(`${date}T12:00:00Z`);
  return {
    weekday: formatInTimeZone(noon, 'UTC', 'EEE', { locale: itLocale }),
    day: formatInTimeZone(noon, 'UTC', 'd', { locale: itLocale }),
  };
};

const main = (page: Page): Locator => page.locator('main');

export const daysStrip = (page: Page): Locator =>
  page.getByRole('navigation', { name: s('booking.time.daysLabel'), exact: true });

/** La fila orizzontale delle colonne. */
export const whenRow = (page: Page): Locator => main(page).getByRole('region', { name: s('booking.when.rowLabel'), exact: true });

/** Colonna del barbiere `name` nel giorno `day`. */
export const whenColumn = (page: Page, name: string, day: string): Locator =>
  main(page).getByRole('group', { name: sf('booking.when.columnLabel', { name, day: dayLabel(day) }), exact: true });

/** Colonne disegnate di un giorno, nell'ordine del DOM. */
export const dayColumns = (page: Page, day: string): Locator => whenRow(page).locator(`section[data-day="${day}"]`);

/** Giorno selezionato nella striscia (data-day del link con aria-current="date"). */
export const selectedDate = async (page: Page): Promise<string> => {
  const current = daysStrip(page).locator('a[aria-current="date"]');
  await expect(current).toHaveCount(1);
  return (await current.getAttribute('data-day')) ?? '';
};

/** Giorni selezionabili della striscia (link), nell'ordine. */
export const stripDays = (page: Page): Promise<string[]> =>
  daysStrip(page)
    .locator('a[data-day]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('data-day') ?? ''));

/** x (bordo sinistro nel viewport) di un elemento. */
export const leftOf = async (locator: Locator): Promise<number> =>
  locator.evaluate((el) => el.getBoundingClientRect().left);

/** Attende che la colonna sia al bordo sinistro della fila (x atteso ±1). */
export const expectAtEdge = async (column: Locator, x: number, message: string): Promise<void> => {
  await expect.poll(async () => Math.abs((await leftOf(column)) - x), { message }).toBeLessThanOrEqual(1);
};

export const rowScrollLeft = (page: Page): Promise<number> => whenRow(page).evaluate((el) => el.scrollLeft);

/** Scorrimento istantaneo della fila e attesa di due frame (gli effetti per frame sono applicati). */
export const scrollRow = async (page: Page, to: { left?: number; by?: number }): Promise<void> => {
  await whenRow(page).evaluate(async (el, { left, by }) => {
    if (left !== undefined) el.scrollTo({ left, behavior: 'instant' });
    if (by !== undefined) el.scrollBy({ left: by, behavior: 'instant' });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, to);
};

/**
 * Attende la fine dello scorrimento della fila: 18 frame (circa 300 ms) senza cambiamenti di
 * scrollLeft, più del ripiego di ~150 ms dell'implementazione. Serve per verificare che qualcosa NON
 * cambi, o che l'URL sia stato aggiornato a scorrimento fermo.
 */
export const settle = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = -1;
        let still = 0;
        const tick = () => {
          const row = document.querySelector<HTMLElement>('[data-when-columns]');
          const now = row?.scrollLeft ?? 0;
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 18) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** Stato dell'elemento che scorre in verticale dentro una colonna (overflow-y auto). */
export const columnScroller = (column: Locator) =>
  column.evaluate((section) => {
    const list = [...section.querySelectorAll<HTMLElement>('*')].find((el) => getComputedStyle(el).overflowY === 'auto');
    if (!list) return null;
    return {
      scrollTop: list.scrollTop,
      scrollable: list.scrollHeight > list.clientHeight,
      overscrollY: getComputedStyle(list).overscrollBehaviorY,
    };
  });

/** Porta la lista di orari di una colonna a `top` px dall'inizio. */
export const scrollColumnTo = (column: Locator, top: number): Promise<void> =>
  column.evaluate((section, value) => {
    const list = [...section.querySelectorAll<HTMLElement>('*')].find((el) => getComputedStyle(el).overflowY === 'auto');
    list?.scrollTo({ top: value, behavior: 'instant' });
  }, top);
