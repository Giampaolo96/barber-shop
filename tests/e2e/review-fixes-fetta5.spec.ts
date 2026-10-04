// Regressioni della review della fetta 5 (scritte durante l'implementazione, non da spec-qa):
// /profilo/completa conserva la pagina di ritorno; senza una destinazione valida (esterna o
// troppo lunga) dopo il salvataggio si arriva alla home. Il caso "next assente" è coperto da
// auth.spec.ts ("accesso successivo: next esterno ignorato").
import { expect, test, type Page } from '@playwright/test';

import { expectPath, s, uniqueEmail } from './admin-helpers';

const MAILPIT_URL = 'http://127.0.0.1:54324';
type MailpitSummary = { ID: string; Created: string };

/** Nuovo cliente: magic link da /accedi, conferma, arrivo su /profilo/completa. */
const signUp = async (page: Page, label: string): Promise<void> => {
  const email = uniqueEmail(label);
  await page.goto('/accedi');
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();

  let messages: MailpitSummary[] = [];
  await expect
    .poll(async () => {
      const response = await page.request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${email}"` } });
      messages = ((await response.json()) as { messages: MailpitSummary[] }).messages;
      return messages.length;
    })
    .toBeGreaterThan(0);
  const message = (await (await page.request.get(`${MAILPIT_URL}/api/v1/message/${messages[0]?.ID}`)).json()) as {
    HTML: string;
  };
  const href = [...message.HTML.matchAll(/href="([^"]+)"/g)]
    .map((m) => (m[1] ?? '').replace(/&amp;/g, '&'))
    .find((h) => h.includes('/auth/confirm?'));
  const url = new URL(href ?? 'http://invalid.invalid');
  await page.goto(`${url.pathname}${url.search}`);
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
};

const completeProfile = async (page: Page): Promise<void> => {
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill('Cliente Ritorno');
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill('+39 333 2223344');
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
};

test('profilo incompleto: da "Prenota" al completamento e poi di nuovo a /prenota', async ({ page }) => {
  await signUp(page, 'completa-prenota');
  await page.goto('/prenota');
  await expectPath(page, '/profilo/completa');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/prenota');
  await completeProfile(page);
  await expectPath(page, '/prenota');
});

test('completamento con next esterno: si arriva alla home', async ({ page, baseURL }) => {
  await page.route(/^https?:\/\/evil\.example\//, (route) => route.fulfill({ status: 200, body: 'esterno' }));
  await signUp(page, 'completa-esterno');
  await page.goto('/profilo/completa?next=' + encodeURIComponent('//evil.example/rubato'));
  await completeProfile(page);
  await expectPath(page, '/');
  expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin);
});

test('completamento con next troppo lungo: si arriva alla home', async ({ page }) => {
  await signUp(page, 'completa-lungo');
  await page.goto('/profilo/completa?next=' + encodeURIComponent(`/prenota?x=${'a'.repeat(2100)}`));
  await completeProfile(page);
  await expectPath(page, '/');
});
