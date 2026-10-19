// "Indietro" dal riepilogo riapre "Quando?" sul giorno da cui si è scelto l'orario (correzione del
// 2026-10-19, segnalata da iPhone): scelto un giorno diverso da quello iniziale e toccato un orario,
// il ritorno non deve riaprire il primo giorno disponibile. Due modi di tornare:
//   (a) il link "Indietro" della testata del riepilogo;
//   (b) page.goBack(), come il gesto indietro di iPhone e la freccia del browser.
// Da un orario di colonna e da "Primo libero", con e senza barbiere preferito; il preferito resta.
// A 390×844 come booking-when-columns.spec.ts. Dati creati tramite l'admin demo e rimossi alla fine.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { formatInTimeZone } from 'date-fns-tz';

import {
  adminApi,
  cleanup,
  createBarber,
  createService,
  expectPath,
  plusDays,
  s,
  sf,
  uniqueEmail,
  uniqueName,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

type Created = { services: string[]; barbers: string[] };

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

const main = (page: Page): Locator => page.locator('main');
const dayStrip = (page: Page): Locator => page.getByRole('navigation', { name: s('booking.time.daysLabel'), exact: true });
const column = (page: Page, name: string): Locator =>
  main(page).getByRole('region', { name: sf('booking.when.columnLabel', { name }), exact: true });
const firstFreeLink = (page: Page): Locator => main(page).getByRole('link', { name: /^Primo libero:/ });
const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
/** Giorno locale dell'orario nell'href di un link al riepilogo. */
const dayOfHref = (href: string | null): string =>
  formatInTimeZone(new Date(new URL(href ?? '', 'http://x').searchParams.get('inizio') ?? ''), TZ, 'yyyy-MM-dd');

/** "Quando?" mostra `day`: selezionato nella striscia, "Primo libero" e orari di quel giorno. */
const expectWhenOn = async (page: Page, day: string, preferredId: string | undefined): Promise<void> => {
  await expectPath(page, WHEN_PATH);
  await expect(dayStrip(page).locator('a[aria-current="date"]')).toHaveAttribute('data-day', day);
  await expect.poll(async () => dayOfHref(await firstFreeLink(page).getAttribute('href'))).toBe(day);
  await expect.poll(() => new URL(page.url()).searchParams.get('giorno'), "giorno nell'URL").toBe(day);
  expect(new URL(page.url()).searchParams.get('barbiere'), "preferito nell'URL").toBe(preferredId ?? null);
};

const ways = ['link', 'history'] as const;
const sources = ['slot', 'firstFree'] as const;

for (const preferred of [false, true]) {
  test(`indietro dal riepilogo torna sul giorno scelto (${preferred ? 'con' : 'senza'} preferito)`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const api = await adminApi(request);
    const data: Created = { services: [], barbers: [] };
    try {
      const serviceId = await createService(api, { name: uniqueName('Indietro'), durationMin: 30, priceCents: 2000 });
      data.services.push(serviceId);
      const barbers: Array<{ id: string; name: string }> = [];
      for (const label of ['Alfa', 'Beta']) {
        const name = uniqueName(label);
        const id = await createBarber(api, name, [serviceId]);
        data.barbers.push(id);
        barbers.push({ id, name });
        await api.post(
          '/rest/v1/working_hours?select=id',
          ALL_WEEK.map((weekday) => ({ barber_id: id, weekday, start_time: '06:00', end_time: '23:00' })),
        );
      }
      // Con il preferito l'orario si sceglie nella colonna dell'altro barbiere
      const preferredId = preferred ? barbers[0]?.id : undefined;
      await signUpCustomer(page, 'indietro');

      for (const way of ways) {
        for (const source of sources) {
          await test.step(`${way} da ${source}`, async () => {
            // Apertura senza giorno: il primo giorno disponibile (oggi o domani)
            await page.goto(`${WHEN_PATH}?servizio=${serviceId}${preferredId ? `&barbiere=${preferredId}` : ''}`);
            const opened = await dayStrip(page).locator('a[aria-current="date"]').getAttribute('data-day');
            // Un giorno selezionabile almeno 2 giorni dopo (salta le chiusure del negozio)
            const selectable = await dayStrip(page).locator('a[data-day]').evaluateAll((links) =>
              links.map((link) => link.getAttribute('data-day') ?? ''),
            );
            const day = selectable.find((d) => d >= plusDays(opened ?? today(), 2)) ?? '';
            expect(day, 'giorno selezionabile diverso da quello iniziale').not.toBe('');

            await dayStrip(page).locator(`a[data-day="${day}"]`).click();
            await expectWhenOn(page, day, preferredId);

            const target =
              source === 'firstFree'
                ? firstFreeLink(page)
                : column(page, barbers[1]?.name ?? '').getByRole('link').nth(2);
            expect(dayOfHref(await target.getAttribute('href')), 'orario del giorno scelto').toBe(day);
            await target.click();
            await expectPath(page, '/prenota/riepilogo');

            if (way === 'link') {
              await main(page).getByRole('link', { name: s('booking.back'), exact: true }).click();
            } else {
              await page.goBack();
            }
            await expectWhenOn(page, day, preferredId);
          });
        }
      }
    } finally {
      await cleanup(api, data);
    }
  });
}
