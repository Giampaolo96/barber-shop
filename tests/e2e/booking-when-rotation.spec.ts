// Test di accettazione e2e – FETTA 8g ("Quando?": rotazione del telefono; decisioni approvate
// dall'utente il 2026-10-25). SPEC §5.2: "Ridimensionando (rotazione, finestra, testo ingrandito) resta
// la stessa colonna a sinistra e lo stesso giorno". Gira su Chromium mobile (progetto mobile-chromium) e
// su WebKit (progetto mobile-webkit, iPhone 14), contesto con hasTouch e isMobile.
//
// Sequenza: 390×844 → 844×390 (sotto i 600 px di altezza scorre la pagina) → 390×844, con
// page.setViewportSize. Dopo ogni passaggio, a layout stabile:
//   - stesso giorno selezionato nella striscia (aria-current) e stesso ?giorno= nell'URL;
//   - stessa colonna più a sinistra visibile (stessa <section data-day data-barber>), misurata dal bordo
//     dopo lo scroll-padding della fila (16 px): al bordo ±1 px se lo era, altrimenti con la stessa
//     frazione della sua larghezza già uscita a sinistra (±2 px);
//   - durante il ridimensionamento la striscia non passa per altri giorni e non ci sono replaceState
//     della pagina (escluse quelle con lo stato __NA di Next, ADR 013).
// Casi: A) apertura con ?giorno= di un giorno ad almeno 10 giorni da oggi, prima colonna al bordo;
//       B) fila ferma a metà dell'ultima colonna di un giorno (aggancio spento con uno stile in linea,
//          come in booking-when-row.spec.ts: altrimenti lo snap riaggancerebbe la fila a una colonna).
// La posizione verticale (scrollTop delle colonne, scrollY della pagina) qui non si verifica.
// Dati: servizio e 4 barbieri propri, tutti i giorni 06:00–23:00; shop_settings solo letto
// (max_horizon_days ≥ 14). Cliente nuovo con email univoca.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatInTimeZone } from 'date-fns-tz';

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
import { expectAtEdge, leftOf, scrollRow, selectedDate, settle, whenColumn, whenRow } from './when-row-helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];
const EDGE = 16;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

type Created = { services: string[]; barbers: string[]; bookings: string[] };
type Barber = { id: string; name: string };

const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

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

const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');

const rotationService = async (api: AdminApi, data: Created): Promise<{ serviceId: string; barbers: Barber[] }> => {
  const [row] = await api.get<Array<{ max_horizon_days: number }>>('/rest/v1/shop_settings?select=max_horizon_days');
  expect(row?.max_horizon_days ?? 0, 'periodo prenotabile sufficiente per il test').toBeGreaterThanOrEqual(14);
  const serviceId = await createService(api, { name: uniqueName('Rotazione'), durationMin: 30, priceCents: 2000 });
  data.services.push(serviceId);
  const barbers: Barber[] = [];
  for (const label of ['Alfa', 'Beta', 'Delta', 'Gamma']) {
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

const urlDay = (page: Page): string | null => new URL(page.url()).searchParams.get('giorno');

/** Colonna più a sinistra visibile (dopo lo scroll-padding) e quanto ne è uscito a sinistra. */
type Anchor = { key: string; hidden: number; width: number };

/**
 * Attende che il layout della fila sia stabile (30 frame, circa mezzo secondo, senza cambiamenti di
 * misure, scrollLeft e colonna a sinistra) e restituisce la colonna più a sinistra visibile.
 */
const stableAnchor = (page: Page): Promise<{ anchor: Anchor | null; stable: boolean }> =>
  page.evaluate(
    () =>
      new Promise<{ anchor: Anchor | null; stable: boolean }>((done) => {
        const read = (): { anchor: Anchor | null; signature: string } => {
          const row = document.querySelector<HTMLElement>('[data-when-columns]');
          if (!row) return { anchor: null, signature: 'nessuna fila' };
          const rowBox = row.getBoundingClientRect();
          const edge = rowBox.left + (parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0);
          const sections = [...row.querySelectorAll<HTMLElement>('section[data-day][data-barber]')]
            .map((section) => ({ section, box: section.getBoundingClientRect() }))
            .sort((a, b) => a.box.left - b.box.left);
          const first = sections.find(({ box }) => box.right > edge + 0.5);
          const anchor = first
            ? { key: `${first.section.dataset.day}|${first.section.dataset.barber}`, hidden: edge - first.box.left, width: first.box.width }
            : null;
          const signature = JSON.stringify([
            window.innerWidth,
            window.innerHeight,
            row.clientWidth,
            Math.round(row.scrollLeft * 2),
            anchor?.key,
            Math.round((anchor?.hidden ?? 0) * 2),
            Math.round((anchor?.width ?? 0) * 2),
          ]);
          return { anchor, signature };
        };
        let last = '';
        let still = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          const { anchor, signature } = read();
          still = signature === last ? still + 1 : 0;
          last = signature;
          if (still >= 30) done({ anchor, stable: true });
          else if (frames > 1200) done({ anchor, stable: false });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

/** Avvia il conteggio: giorni attraversati dalla striscia e replaceState della pagina (senza __NA). */
const watchDuringResize = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as { __rotationDays: string[]; __rotationReplaceState: number };
    w.__rotationDays = [];
    w.__rotationReplaceState = 0;
    const nav = document.querySelector('nav a[data-day]')?.closest('nav');
    new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as HTMLElement;
        if (el.getAttribute('aria-current') === 'date') w.__rotationDays.push(el.dataset.day ?? '');
      }
    }).observe(nav ?? document.body, { attributes: true, attributeFilter: ['aria-current'], subtree: true });
    const replaceState = history.replaceState;
    history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      const state = args[0] as { __NA?: boolean } | null;
      if (!state?.__NA) w.__rotationReplaceState += 1;
      return replaceState.apply(this, args);
    };
  });

const watched = (page: Page): Promise<{ days: string[]; replaceState: number }> =>
  page.evaluate(() => {
    const w = window as unknown as { __rotationDays: string[]; __rotationReplaceState: number };
    return { days: w.__rotationDays, replaceState: w.__rotationReplaceState };
  });

/** Ruota e confronta con la posizione prima della rotazione. */
const rotateAndExpect = async (
  page: Page,
  size: { width: number; height: number },
  before: Anchor,
  day: string,
  aligned: boolean,
  label: string,
): Promise<void> => {
  await page.setViewportSize(size);
  const { anchor, stable } = await stableAnchor(page);
  expect(stable, `${label}: layout stabile dopo il ridimensionamento`).toBe(true);
  expect(anchor?.key, `${label}: stessa colonna più a sinistra visibile`).toBe(before.key);
  if (aligned) {
    expect(Math.abs(anchor?.hidden ?? Infinity), `${label}: colonna ancora al bordo (±1 px)`).toBeLessThanOrEqual(1);
  } else {
    const expected = (before.hidden / before.width) * (anchor?.width ?? 0);
    expect(Math.abs((anchor?.hidden ?? Infinity) - expected), `${label}: stessa frazione uscita a sinistra (±2 px)`).toBeLessThanOrEqual(2);
  }
  expect(await selectedDate(page), `${label}: stesso giorno nella striscia`).toBe(day);
  expect(urlDay(page), `${label}: stesso giorno nell'URL`).toBe(day);
};

test('rotazione 390×844 → 844×390 → 390×844: stessa colonna a sinistra, stesso giorno in striscia e URL (al bordo e a metà colonna)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers } = await rotationService(api, data);
    const first = barbers[0] as Barber;
    const last = barbers.at(-1) as Barber;
    const day = plusDays(today(), 10);
    await signUpCustomer(page, 'rotazione');

    await test.step('A: apertura con ?giorno= a 10 giorni da oggi, prima colonna al bordo', async () => {
      await page.setViewportSize(PORTRAIT);
      await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${day}`);
      await expectAtEdge(whenColumn(page, first.name, day), EDGE, "all'apertura la prima colonna del giorno è al bordo");
      await expect.poll(() => urlDay(page)).toBe(day);
      await settle(page);
      const { anchor, stable } = await stableAnchor(page);
      expect(stable).toBe(true);
      expect(anchor?.key).toBe(`${day}|${first.id}`);
      expect(Math.abs(anchor?.hidden ?? Infinity)).toBeLessThanOrEqual(1);
      expect(await selectedDate(page)).toBe(day);

      await watchDuringResize(page);
      await rotateAndExpect(page, LANDSCAPE, anchor as Anchor, day, true, 'A, in orizzontale');
      await rotateAndExpect(page, PORTRAIT, anchor as Anchor, day, true, 'A, di nuovo in verticale');
      await expectAtEdge(whenColumn(page, first.name, day), EDGE, 'A: di nuovo a x = 16');
      const seen = await watched(page);
      expect(seen.days.filter((d) => d !== day), 'A: la striscia non è passata per altri giorni').toEqual([]);
      expect(seen.replaceState, 'A: nessuna replaceState della pagina durante la rotazione').toBe(0);
    });

    await test.step("B: fila ferma a metà dell'ultima colonna di un giorno", async () => {
      await page.setViewportSize(PORTRAIT);
      await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${day}`);
      await expectAtEdge(whenColumn(page, first.name, day), EDGE, "all'apertura la prima colonna del giorno è al bordo");
      await expect.poll(() => urlDay(page)).toBe(day);
      await whenRow(page).evaluate((el) => {
        el.style.scrollSnapType = 'none';
      });
      const lastColumn = whenColumn(page, last.name, day);
      const width = await lastColumn.evaluate((el) => el.getBoundingClientRect().width);
      await scrollRow(page, { by: (await leftOf(lastColumn)) - EDGE + width / 2 });
      await settle(page);
      const { anchor, stable } = await stableAnchor(page);
      expect(stable).toBe(true);
      expect(anchor?.key, "ultima colonna del giorno a sinistra").toBe(`${day}|${last.id}`);
      expect(Math.abs((anchor?.hidden ?? 0) - width / 2), 'metà della colonna uscita a sinistra').toBeLessThanOrEqual(1);
      await expect.poll(() => selectedDate(page)).toBe(day);
      expect(urlDay(page)).toBe(day);

      await watchDuringResize(page);
      await rotateAndExpect(page, LANDSCAPE, anchor as Anchor, day, false, 'B, in orizzontale');
      await rotateAndExpect(page, PORTRAIT, anchor as Anchor, day, false, 'B, di nuovo in verticale');
      const seen = await watched(page);
      expect(seen.days.filter((d) => d !== day), 'B: la striscia non è passata per altri giorni').toEqual([]);
      expect(seen.replaceState, 'B: nessuna replaceState della pagina durante la rotazione').toBe(0);
    });
  } finally {
    await cleanup(api, data);
  }
});
