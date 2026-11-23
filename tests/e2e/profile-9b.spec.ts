// Test di accettazione e2e – FETTA 9b "Privacy e account del cliente" (SPEC §11 riga 9b, §5.4, §8;
// decisioni approvate dall'utente per la fetta 9b, punti B e C). Telefono 390×844.
//
// Rotte e testi attesi (src/i18n/it.ts):
//   /profilo         titolo it.profile.title; email in sola lettura; versione e data del consenso privacy
//                    (it.profile.privacyAccepted con {version} e {date}); un modulo con i campi
//                    it.profile.fullNameLabel, it.profile.phoneLabel, la casella it.profile.marketingLabel
//                    e il pulsante it.profile.save (esiti it.profile.saved / it.profile.invalid); data del
//                    marketing it.profile.marketingGiven / marketingRevoked ({date}, gg/mm/aaaa); link a
//                    /privacy; in fondo "Installa l'app" (it.pwa.install.profileEntry), "Esci" (pulsante in
//                    un form) e il link it.profile.deleteAccount verso /profilo/elimina.
//   /privacy         pubblica: titolo it.privacy.title e it.privacy.version con la versione corrente.
//   home             piè di pagina (contentinfo) con il link it.home.privacyLink verso /privacy.
//
// Prerequisiti: vedi customer-account-helpers.ts. Clienti nuovi per test.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Locator, type Page } from '@playwright/test';

import { disableNativeValidation, expectPath, linkOrButton, s, sf, uniqueEmail, uniqueName } from './admin-helpers';
import {
  PHONE_VIEWPORT,
  currentPolicyVersion,
  deleteAuthUser,
  e164,
  escapeRegExp,
  expectNoHorizontalOverflow,
  prefixOf,
  profileOf,
  signUpCustomer,
  todayRome,
  type NewCustomer,
} from './customer-account-helpers';

test.use({ viewport: PHONE_VIEWPORT });

const main = (page: Page): Locator => page.locator('main');
const field = (page: Page, key: string): Locator => main(page).getByLabel(s(key), { exact: true });
const save = (page: Page): Locator => main(page).getByRole('button', { name: s('profile.save'), exact: true });

/** Testo di it.ts con i segnaposto sostituiti da espressioni regolari (la data può avere anche l'ora). */
const templateRegex = (key: string, values: Record<string, string>): RegExp => {
  let pattern = escapeRegExp(s(key));
  for (const [name, regex] of Object.entries(values)) pattern = pattern.split(escapeRegExp(`{${name}}`)).join(regex);
  return new RegExp(pattern);
};
const todayPattern = (): string => `${escapeRegExp(todayRome())}[\\s\\S]*?`;

const minHeight = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.height ?? 0;

test.describe('Profilo del cliente (SPEC §5.4, §8, decisione C)', () => {
  test('modifica nome e telefono con le regole di /profilo/completa; revoca e riattiva il marketing con la data', async ({ page }) => {
    let customer: NewCustomer | undefined;
    try {
      customer = await signUpCustomer(page, {
        email: uniqueEmail('profilo-9b'),
        fullName: uniqueName('Profilo'),
        marketing: true,
      });
      const version = await currentPolicyVersion(page.request);
      const before = await profileOf(page.request, customer.id);

      await page.goto('/profilo');
      await expectPath(page, '/profilo');
      await expect(page.getByRole('heading', { name: s('profile.title') })).toBeVisible();

      // Sola lettura: email e consenso privacy (versione e data)
      await expect(main(page).getByText(customer.email).first()).toBeVisible();
      await expect(
        main(page).getByText(templateRegex('profile.privacyAccepted', { version: escapeRegExp(version), date: todayPattern() })),
      ).toBeVisible();

      // Modificabili: valori attuali
      await expect(field(page, 'profile.fullNameLabel')).toHaveValue(customer.fullName);
      await expect.poll(async () => e164(await field(page, 'profile.phoneLabel').inputValue())).toBe(e164(customer.phone));
      await expect(field(page, 'profile.marketingLabel')).toBeChecked();
      await expect(main(page).getByText(new RegExp(`${escapeRegExp(prefixOf('profile.marketingGiven'))}${todayPattern()}`))).toBeVisible();

      // Tap target ≥ 44 px (CLAUDE.md – UI cliente)
      expect(await minHeight(save(page))).toBeGreaterThanOrEqual(44);
      const deleteLink = main(page).getByRole('link', { name: s('profile.deleteAccount'), exact: true });
      expect(await minHeight(deleteLink)).toBeGreaterThanOrEqual(44);

      // Validazione lato server come /profilo/completa (CLAUDE.md – Sicurezza)
      await disableNativeValidation(page);
      await field(page, 'profile.fullNameLabel').fill('   ');
      await save(page).click();
      await expect(main(page).getByText(s('profile.invalid'))).toBeVisible();
      await page.reload();
      await disableNativeValidation(page);
      await field(page, 'profile.phoneLabel').fill('12');
      await save(page).click();
      await expect(main(page).getByText(s('profile.invalid'))).toBeVisible();
      expect(await profileOf(page.request, customer.id)).toMatchObject({
        full_name: customer.fullName,
        phone: e164(customer.phone),
      });

      // Nome e telefono validi: salvati in E.164 e ritrovati ricaricando
      const newName = uniqueName('Profilo Rinominato');
      await page.reload();
      await field(page, 'profile.fullNameLabel').fill(`  ${newName}  `);
      await field(page, 'profile.phoneLabel').fill('333 765 4321');
      await save(page).click();
      await expect(main(page).getByText(s('profile.saved'))).toBeVisible();
      await expect.poll(async () => (await profileOf(page.request, customer?.id ?? ''))?.full_name).toBe(newName);
      expect((await profileOf(page.request, customer.id))?.phone).toBe('+393337654321');
      await page.reload();
      await expect(field(page, 'profile.fullNameLabel')).toHaveValue(newName);
      await expect.poll(async () => e164(await field(page, 'profile.phoneLabel').inputValue())).toBe('+393337654321');

      // SPEC §8: il marketing si revoca dal profilo; data e ora le registra il database
      await field(page, 'profile.marketingLabel').uncheck();
      await save(page).click();
      await expect(main(page).getByText(s('profile.saved'))).toBeVisible();
      await expect.poll(async () => (await profileOf(page.request, customer?.id ?? ''))?.marketing_consent).toBe(false);
      const revoked = await profileOf(page.request, customer.id);
      expect(new Date(revoked?.marketing_consent_at ?? 0).getTime()).toBeGreaterThan(
        new Date(before?.marketing_consent_at ?? 0).getTime(),
      );
      await page.reload();
      await expect(field(page, 'profile.marketingLabel')).not.toBeChecked();
      await expect(main(page).getByText(new RegExp(`${escapeRegExp(prefixOf('profile.marketingRevoked'))}${todayPattern()}`))).toBeVisible();

      // ...e si riattiva
      await field(page, 'profile.marketingLabel').check();
      await save(page).click();
      await expect(main(page).getByText(s('profile.saved'))).toBeVisible();
      await expect.poll(async () => (await profileOf(page.request, customer?.id ?? ''))?.marketing_consent).toBe(true);
      await page.reload();
      await expect(field(page, 'profile.marketingLabel')).toBeChecked();
      await expect(main(page).getByText(new RegExp(`${escapeRegExp(prefixOf('profile.marketingGiven'))}${todayPattern()}`))).toBeVisible();

      // Il consenso privacy non è mai cambiato
      const after = await profileOf(page.request, customer.id);
      expect(after?.privacy_policy_version).toBe(before?.privacy_policy_version);
      expect(after?.privacy_consent_at).toBe(before?.privacy_consent_at);

      // In fondo: informativa, installazione, uscita ed eliminazione (decisione C)
      await expect(main(page).locator('a[href="/privacy"]').first()).toBeVisible();
      await expect(linkOrButton(main(page), s('pwa.install.profileEntry'))).toBeVisible();
      await expect(main(page).locator('form').getByRole('button', { name: s('auth.logout'), exact: true })).toBeVisible();
      await expect(deleteLink).toHaveAttribute('href', '/profilo/elimina');
      await expectNoHorizontalOverflow(page, '/profilo');

      await deleteLink.click();
      await expectPath(page, '/profilo/elimina');
      await expect(page.getByRole('heading', { name: s('profile.deletion.title') })).toBeVisible();
      await expectNoHorizontalOverflow(page, '/profilo/elimina');

      // "Esci" in fondo al profilo fa uscire davvero (approvato dall'utente il 2026-11-23)
      await page.goto('/profilo');
      await main(page).locator('form').getByRole('button', { name: s('auth.logout'), exact: true }).click();
      await expect(page.locator('form').getByRole('button', { name: s('auth.logout'), exact: true })).toHaveCount(0);
      await page.goto('/profilo');
      await expect(page).toHaveURL(/\/accedi(\?|$)/);
    } finally {
      await deleteAuthUser(page.request, customer?.id);
    }
  });
});

test.describe('Informativa privacy pubblica (decisione B)', () => {
  test('dal piè di pagina della home, da anonimo: /privacy mostra la versione corrente', async ({ page }) => {
    const version = await currentPolicyVersion(page.request);

    await page.goto('/');
    const link = page.getByRole('contentinfo').getByRole('link', { name: s('home.privacyLink'), exact: true });
    await expect(link).toHaveAttribute('href', '/privacy');
    await link.click();

    await expectPath(page, '/privacy');
    await expect(page.getByRole('heading', { name: s('privacy.title') })).toBeVisible();
    await expect(main(page).getByText(sf('privacy.version', { version }))).toBeVisible();
    await expectNoHorizontalOverflow(page, '/privacy');

    // Aperta direttamente: nessun redirect al login
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
    await expectPath(page, '/privacy');
  });
});
