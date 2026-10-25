// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25)
// "Quando?" a colonne per barbiere (modifica alla fetta 8e approvata dall'utente il 2026-10-18;
// SPEC §5.2, ADR 012). A 390×844 come booking-when.spec.ts.
// Fetta 8f: le colonne stanno in una fila orizzontale continua (regione it.booking.when.rowLabel), un
// gruppo per barbiere e per giorno ("Orari di <nome>, <giorno>"); contratto in ./when-row-helpers.ts.
//   - 4 barbieri: le 4 colonne del giorno affiancate di larghezza uguale dentro il viewport, senza
//     overflow della pagina; ogni colonna scorre da sola (overscroll-behavior-y "contain", che su iPhone
//     ferma lo scorrimento della pagina): scorrerne una non sposta le altre né la pagina; il tocco su
//     un orario apre il riepilogo con barbiere e ora giusti;
//   - 5 barbieri: le 5 colonne del giorno sono contigue nella fila e larghe come con 4 barbieri (4
//     visibili nella larghezza utile), scorrendo si arriva alla quinta e poi alla prima del giorno dopo,
//     dopo uno spazio-giorno più largo; la fila è l'unico elemento che scorre di lato.
//   (Il caso "cambio di giorno: colonne in cima" è passato in booking-when-row.spec.ts, tocco sulla
//   striscia.)
// Dati creati tramite l'admin demo (RLS attiva) e rimossi alla fine; clienti nuovi con email univoche.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  adminApi,
  cleanup,
  createBarber,
  createService,
  expectPath,
  plusDays,
  s,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import { columnScroller as scroller, expectAtEdge, leftOf, selectedDate, whenColumn, whenRow } from './when-row-helpers';

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

type Created = { services: string[]; barbers: string[]; bookings: string[] };

const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato in `page`. */
const signUpCustomer = async (page: Page, label: string): Promise<void> => {
  const email = uniqueEmail(label);
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(uniqueName('Cliente'));
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
};

/** Servizio di 30' con `count` barbieri che lavorano tutti i giorni 06:00–23:00 (molti orari per colonna). */
const serviceWithBarbers = async (
  api: AdminApi,
  data: Created,
  count: number,
): Promise<{ serviceId: string; barbers: Array<{ id: string; name: string }> }> => {
  const serviceId = await createService(api, { name: uniqueName('Colonne'), durationMin: 30, priceCents: 2000 });
  data.services.push(serviceId);
  const barbers: Array<{ id: string; name: string }> = [];
  // Nomi in ordine alfabetico: l'ordine delle colonne (per nome) è quello di creazione.
  for (const label of ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon'].slice(0, count).sort()) {
    const name = uniqueName(label);
    const id = await createBarber(api, name, [serviceId]);
    data.barbers.push(id);
    await api.post(
      '/rest/v1/working_hours?select=id',
      ALL_WEEK.map((weekday) => ({ barber_id: id, weekday, start_time: '06:00', end_time: '23:00' })),
    );
    barbers.push({ id, name });
  }
  return { serviceId, barbers };
};

const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
const main = (page: Page): Locator => page.locator('main');

const pageMetrics = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
  }));

test('4 barbieri a 390 px: colonne affiancate senza overflow; una colonna scorre da sola; tocco su un orario → riepilogo giusto', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers } = await serviceWithBarbers(api, data, 4);
    await signUpCustomer(page, 'colonne');
    const day = plusDays(today(), 1);
    await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${day}`);
    const column = (name: string): Locator => whenColumn(page, name, day);
    // La fila si apre sul giorno dell'URL: la sua prima colonna al bordo sinistro (x = 16)
    await expectAtEdge(column(barbers[0]?.name ?? ''), 16, 'prima colonna del giorno al bordo');

    // Quattro colonne affiancate: stessa riga, stessa larghezza, tutte dentro il viewport
    const boxes = [];
    for (const barber of barbers) {
      const col = column(barber.name);
      await expect(col).toBeVisible();
      boxes.push(await col.boundingBox());
    }
    const [first] = boxes;
    for (const box of boxes) {
      expect(box, 'colonna con dimensioni').not.toBeNull();
      expect(Math.abs((box?.y ?? 0) - (first?.y ?? 0)), 'colonne sulla stessa riga').toBeLessThanOrEqual(1);
      expect(Math.abs((box?.width ?? 0) - (first?.width ?? 0)), 'colonne larghe uguali').toBeLessThanOrEqual(1);
      expect(box?.x ?? -1, 'colonna dentro il viewport').toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 1000), 'colonna dentro il viewport').toBeLessThanOrEqual(390);
    }
    for (let i = 1; i < boxes.length; i++) {
      expect((boxes[i]?.x ?? 0) > (boxes[i - 1]?.x ?? 0), 'colonne nell\'ordine, affiancate').toBe(true);
    }

    // Nessun overflow della pagina, né orizzontale né verticale: scorrono solo le colonne
    const before = await pageMetrics(page);
    expect(before.scrollWidth, 'nessun overflow orizzontale').toBeLessThanOrEqual(before.clientWidth);
    expect(before.scrollHeight, 'la pagina non scorre in verticale').toBeLessThanOrEqual(before.innerHeight);

    // Ogni colonna scorre da sola con overscroll-behavior-y "contain"
    for (const barber of barbers) {
      const state = await scroller(column(barber.name));
      expect(state, `lista di orari che scorre in ${barber.name}`).not.toBeNull();
      expect(state?.scrollable, `${barber.name}: più orari di quanti ne stanno`).toBe(true);
      expect(state?.overscrollY, `${barber.name}: overscroll-behavior-y`).toBe('contain');
    }

    // Scorrere la seconda colonna non sposta le altre, né la pagina, né la striscia e "Primo libero"
    const target = barbers[1] ?? { id: '', name: '' };
    const nav = page.getByRole('navigation', { name: s('booking.time.daysLabel'), exact: true });
    const firstOtherSlot = column(barbers[0]?.name ?? '').getByRole('link').first();
    const navBefore = await nav.boundingBox();
    const otherSlotBefore = await firstOtherSlot.boundingBox();
    const targetBox = await column(target.name).boundingBox();
    await page.mouse.move((targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2, (targetBox?.y ?? 0) + (targetBox?.height ?? 0) - 100);
    await page.mouse.wheel(0, 600);
    await expect.poll(async () => (await scroller(column(target.name)))?.scrollTop ?? 0).toBeGreaterThan(0);
    for (const barber of barbers.filter((b) => b.id !== target.id)) {
      expect((await scroller(column(barber.name)))?.scrollTop, `${barber.name} resta in cima`).toBe(0);
    }
    // Anche scorrendo oltre la fine della colonna la pagina resta ferma
    await page.mouse.wheel(0, 20_000);
    expect((await pageMetrics(page)).scrollY, 'la pagina non scorre').toBe(0);
    expect(await nav.boundingBox(), 'striscia dei giorni ferma').toEqual(navBefore);
    expect(await firstOtherSlot.boundingBox(), 'orari delle altre colonne fermi').toEqual(otherSlotBefore);

    // Tocco su un orario visibile della colonna scrollata → riepilogo con quel barbiere e quell'ora
    const slots = column(target.name).getByRole('link', { name: new RegExp(` con ${target.name}$`) });
    const label = await slots.evaluateAll((links) => {
      const visible = links.find((link) => {
        const box = link.getBoundingClientRect();
        const list = link.closest('ul')?.parentElement?.getBoundingClientRect();
        return list && box.top >= list.top && box.bottom <= Math.min(list.bottom, window.innerHeight);
      });
      return visible?.getAttribute('aria-label') ?? null;
    });
    expect(label, 'un orario visibile dopo lo scorrimento').not.toBeNull();
    const time = (label ?? '').split(' ')[0] ?? '';
    await column(target.name).getByRole('link', { name: label ?? '', exact: true }).click();
    await expectPath(page, '/prenota/riepilogo');
    const params = new URL(page.url()).searchParams;
    expect(params.get('servizio')).toBe(serviceId);
    expect(params.get('barbiere')).toBe(target.id);
    expect(new Date(params.get('inizio') ?? '').getTime()).toBe(fromZonedTime(`${day}T${time.padStart(5, '0')}:00`, TZ).getTime());
    await expect(main(page)).toContainText(target.name);
    await expect(main(page)).toContainText(time);
  } finally {
    await cleanup(api, data);
  }
});

test("5 barbieri a 390 px: colonne del giorno contigue e larghe come con 4, poi il giorno dopo oltre uno spazio più largo; la fila è l'unico elemento che scorre di lato", async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers } = await serviceWithBarbers(api, data, 5);
    await signUpCustomer(page, 'cinque');
    const day = plusDays(today(), 1);
    const next = plusDays(day, 1);
    await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${day}`);
    const columns = barbers.map((barber) => whenColumn(page, barber.name, day));
    for (const col of columns) await expect(col).toHaveCount(1);
    await expectAtEdge(columns[0] as Locator, 16, 'prima colonna del giorno al bordo');

    // Le 5 colonne del giorno: larghe uguali, separate dallo stesso gap, la quinta subito dopo la quarta
    const boxes = await Promise.all(columns.map((col) => col.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect)));
    const width = boxes[0]?.width ?? 0;
    const gap = (boxes[1]?.left ?? 0) - (boxes[0]?.right ?? 0);
    expect(gap, 'gap fra le colonne').toBeGreaterThanOrEqual(0);
    for (let i = 1; i < boxes.length; i++) {
      expect(Math.abs((boxes[i]?.width ?? 0) - width), `colonna ${i + 1} larga come la prima`).toBeLessThanOrEqual(1);
      expect(Math.abs((boxes[i]?.left ?? 0) - (boxes[i - 1]?.right ?? 0) - gap), `colonna ${i + 1} subito dopo la precedente`).toBeLessThanOrEqual(1);
    }
    // Larghe come con 4 barbieri: 4 colonne e 3 gap riempiono la larghezza utile (390 − 2·16 = 358)
    expect(Math.abs(width - (358 - 3 * gap) / 4), `larghezza ${width} con gap ${gap}`).toBeLessThanOrEqual(1);
    expect(boxes[3]?.right ?? 1000, 'la quarta colonna è dentro il viewport').toBeLessThanOrEqual(390);
    expect(boxes[4]?.right ?? 0, 'la quinta colonna esce dal bordo').toBeGreaterThan(390);

    // Nessun overflow orizzontale della pagina: fuori dalla striscia scorre di lato solo la fila
    const metrics = await pageMetrics(page);
    expect(metrics.scrollWidth, 'nessun overflow orizzontale della pagina').toBeLessThanOrEqual(metrics.clientWidth);
    const row = whenRow(page);
    expect(await row.evaluate((el) => ({ overflowX: getComputedStyle(el).overflowX, scrollable: el.scrollWidth > el.clientWidth }))).toEqual({
      overflowX: 'auto',
      scrollable: true,
    });
    const sideScrollers = await main(page).evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('*')]
        .filter((el) => !el.closest('nav'))
        .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.hasAttribute('data-when-columns') ? 'fila' : `${el.tagName} ${el.className}`)),
    );
    expect(sideScrollers, 'elementi che scorrono di lato (striscia esclusa)').toEqual(['fila']);

    // Scorrendo di lato si arriva alla quinta colonna, ancora del giorno scelto…
    const fifth = columns[4] as Locator;
    await row.evaluate((el, by) => el.scrollBy({ left: by, behavior: 'instant' }), (boxes[4]?.left ?? 0) - 16);
    await expectAtEdge(fifth, 16, 'quinta colonna al bordo');
    expect(await selectedDate(page), 'con la quinta colonna visibile il giorno resta quello').toBe(day);

    // …e subito dopo alla prima colonna del giorno dopo, oltre uno spazio più largo del gap normale
    const firstNext = whenColumn(page, barbers[0]?.name ?? '', next);
    await expect(firstNext).toHaveCount(1);
    const fifthRight = await fifth.evaluate((el) => el.getBoundingClientRect().right);
    const dayGap = (await leftOf(firstNext)) - fifthRight;
    expect(dayGap, 'spazio fra due giorni più largo del gap').toBeGreaterThan(gap + 2);
    await row.evaluate((el, by) => el.scrollBy({ left: by, behavior: 'instant' }), (await leftOf(firstNext)) - 16);
    await expectAtEdge(firstNext, 16, 'prima colonna del giorno dopo al bordo');
    await expect.poll(() => selectedDate(page), 'giorno selezionato').toBe(next);
    expect(await page.evaluate(() => window.scrollX), 'la pagina non scorre di lato').toBe(0);
  } finally {
    await cleanup(api, data);
  }
});
