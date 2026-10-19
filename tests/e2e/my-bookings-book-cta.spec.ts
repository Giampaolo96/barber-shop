// "Le mie prenotazioni": "Prenota" compare quando non ci sono prenotazioni future confermate, anche
// con passate o cancellate (correzione del 2026-10-19). Con solo passate/cancellate il testo è
// it.booking.list.noUpcoming e il pulsante (≥ 44 px) porta al listino; con una futura confermata
// il pulsante non c'è. Dati creati tramite l'admin demo e rimossi alla fine.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  adminApi,
  cleanup,
  createBarber,
  createService,
  expectPath,
  plusDays,
  romeWinter,
  s,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';

test.use({ viewport: { width: 390, height: 844 } });

const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato in `page`; restituisce l'id del profilo. */
const signUpCustomer = async (page: Page, api: AdminApi, label: string): Promise<string> => {
  const email = uniqueEmail(label);
  const fullName = uniqueName('Cliente');
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
  const rows = await api.get<Array<{ id: string }>>(`/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`);
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

/** Prenotazione di un cliente inserita dall'admin (anche passata o cancellata, ADR 001). */
const customerBooking = async (
  api: AdminApi,
  values: { customerId: string; barberId: string; serviceId: string; startsAt: string; status: string },
): Promise<string> => {
  const [row] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    customer_id: values.customerId,
    barber_id: values.barberId,
    service_id: values.serviceId,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status,
  });
  return row?.id ?? '';
};

const main = (page: Page): Locator => page.locator('main');
const bookCta = (page: Page): Locator => main(page).getByRole('link', { name: s('booking.list.emptyCta'), exact: true });
const todayRome = (): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());

test('"Prenota" in Le mie prenotazioni: c\'è con solo passate o cancellate, sparisce con una futura confermata', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data = { services: [] as string[], barbers: [] as string[], bookings: [] as string[] };
  try {
    const serviceId = await createService(api, { name: uniqueName('Prenota'), durationMin: 30, priceCents: 2000 });
    data.services.push(serviceId);
    const barberId = await createBarber(api, uniqueName('Barbiere'), [serviceId]);
    data.barbers.push(barberId);
    const customerId = await signUpCustomer(page, api, 'prenota-cta');
    const today = todayRome();
    const base = { customerId, barberId, serviceId };

    // Una passata completata e una futura cancellata: nessuna futura confermata
    data.bookings.push(
      await customerBooking(api, { ...base, startsAt: romeWinter(plusDays(today, -7), '10:00'), status: 'completed' }),
      await customerBooking(api, { ...base, startsAt: romeWinter(plusDays(today, 5), '10:00'), status: 'cancelled_by_shop' }),
    );

    await page.goto('/prenotazioni');
    await expect(main(page).getByText(s('booking.list.noUpcoming'), { exact: true })).toBeVisible();
    await expect(main(page).getByText(s('booking.list.empty'))).toHaveCount(0);
    await expect(bookCta(page)).toHaveAttribute('href', '/prenota');
    const box = await bookCta(page).boundingBox();
    expect(box?.height ?? 0, '"Prenota": altezza ≥ 44px').toBeGreaterThanOrEqual(44);
    await bookCta(page).click();
    await expectPath(page, '/prenota');
    await expect(page.getByRole('heading', { level: 1, name: s('booking.service.title') })).toBeVisible();

    // Con una futura confermata il pulsante non c'è
    data.bookings.push(
      await customerBooking(api, { ...base, startsAt: romeWinter(plusDays(today, 6), '11:00'), status: 'confirmed' }),
    );
    await page.goto('/prenotazioni');
    await expect(main(page).getByRole('listitem').first()).toBeVisible();
    await expect(bookCta(page)).toHaveCount(0);
    await expect(main(page).getByText(s('booking.list.noUpcoming'), { exact: true })).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});
