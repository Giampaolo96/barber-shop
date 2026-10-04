// Test di accettazione e2e – FETTA 3 (SPEC §11) + Impostazioni (SPEC §6.8).
// Sezioni: SPEC §3.1 (parametri), §6.8, §8 (versione dell'informativa privacy) + decisioni
// approvate per la fetta 3 (punti A ed E).
// Contratto dell'interfaccia (decisione fetta 3): /admin/impostazioni è un modulo con le
// etichette it.admin.settings.*, salvato con it.admin.common.save; esito it.admin.common.saved,
// errori it.admin.common.invalid. La granularità è un <select> con le sole opzioni 5, 10, 15, 20,
// 30, 60; l'orizzonte massimo è di almeno 1 giorno (decisioni dell'utente).
// Le impostazioni sono condivise da tutti i test: questo file gira nel progetto Playwright
// "admin-settings", che parte dopo gli altri (playwright.config.ts); nome e timezone non si
// cambiano e i valori iniziali si ripristinano sempre (try/finally), anche se il test fallisce.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test } from '@playwright/test';
import {
  DESKTOP,
  adminApi,
  disableNativeValidation,
  expectPath,
  field,
  loginAsAdmin,
  loginAsBarber,
  s,
  saveButton,
} from './admin-helpers';

type Settings = {
  name: string;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  timezone: string;
  slot_granularity_min: number;
  min_advance_min: number;
  max_horizon_days: number;
  cancel_limit_min: number;
  buffer_min: number;
  no_show_block_threshold: number;
  privacy_policy_version: string;
};

const COLUMNS =
  'name,address,phone,logo_url,timezone,slot_granularity_min,min_advance_min,max_horizon_days,cancel_limit_min,buffer_min,no_show_block_threshold,privacy_policy_version';

const readSettings = async (api: Awaited<ReturnType<typeof adminApi>>): Promise<Settings> => {
  const rows = await api.get<Settings[]>(`/rest/v1/shop_settings?select=${COLUMNS}`);
  expect(rows).toHaveLength(1);
  return rows[0] as Settings;
};

const restore = async (api: Awaited<ReturnType<typeof adminApi>>, original: Settings): Promise<void> => {
  await api.patch('/rest/v1/shop_settings?id=eq.true', original);
};

// I test di questo file modificano la stessa riga: girano in ordine nello stesso worker.
// Modalità 'default', non 'serial': un errore non salta i test successivi.
test.describe.configure({ mode: 'default' });

test.describe('Admin – impostazioni (SPEC §3.1, §6.8)', () => {
  test.use({ viewport: DESKTOP });

  // Review fetta 5: la versione dell'informativa è in sola lettura fino al flusso di nuovo consenso (fetta 9).
  test('modifica i parametri e li ritrova ricaricando; la versione dell\'informativa è in sola lettura', async ({ page }) => {
    const api = await adminApi(page.request);
    const original = await readSettings(api);

    try {
      await loginAsAdmin(page);
      await page.goto('/admin/impostazioni');
      await expect(page.getByRole('heading', { name: s('admin.nav.settings') })).toBeVisible();

      // SPEC §6.8: il modulo mostra i valori attuali
      await expect(field(page, 'admin.settings.nameLabel')).toHaveValue(original.name);
      await expect(field(page, 'admin.settings.timezoneLabel')).toHaveValue(original.timezone);
      await expect(field(page, 'admin.settings.slotGranularityLabel')).toHaveValue(String(original.slot_granularity_min));
      await expect(field(page, 'admin.settings.privacyPolicyVersionLabel')).toHaveValue(original.privacy_policy_version);
      await expect(field(page, 'admin.settings.privacyPolicyVersionLabel')).not.toBeEditable();

      await field(page, 'admin.settings.addressLabel').fill('Via del Test 3, Roma');
      await field(page, 'admin.settings.phoneLabel').fill('+39 06 7654321');
      await field(page, 'admin.settings.logoUrlLabel').fill('https://example.com/logo-e2e.png');
      // Menu a tendina con le sole granularità ammesse
      const granularity = field(page, 'admin.settings.slotGranularityLabel');
      await expect(granularity).toHaveJSProperty('tagName', 'SELECT');
      const options = await granularity.locator('option').evaluateAll((list) =>
        list.map((option) => (option as HTMLOptionElement).value),
      );
      expect(options).toEqual(['5', '10', '15', '20', '30', '60']);
      await granularity.selectOption('20');
      await field(page, 'admin.settings.minAdvanceLabel').fill('90');
      await field(page, 'admin.settings.maxHorizonLabel').fill('45');
      await field(page, 'admin.settings.cancelLimitLabel').fill('240');
      await field(page, 'admin.settings.bufferLabel').fill('5');
      // SPEC §3.1: 0 = blocco per no-show disattivato
      await field(page, 'admin.settings.noShowThresholdLabel').fill('0');
      await saveButton(page).click();
      await expect(page.getByText(s('admin.common.saved'))).toBeVisible();

      expect(await readSettings(api)).toMatchObject({
        name: original.name,
        timezone: original.timezone,
        address: 'Via del Test 3, Roma',
        phone: '+39 06 7654321',
        logo_url: 'https://example.com/logo-e2e.png',
        slot_granularity_min: 20,
        min_advance_min: 90,
        max_horizon_days: 45,
        cancel_limit_min: 240,
        buffer_min: 5,
        no_show_block_threshold: 0,
        privacy_policy_version: original.privacy_policy_version,
      });

      await page.reload();
      await expect(field(page, 'admin.settings.addressLabel')).toHaveValue('Via del Test 3, Roma');
      await expect(field(page, 'admin.settings.logoUrlLabel')).toHaveValue('https://example.com/logo-e2e.png');
      await expect(field(page, 'admin.settings.slotGranularityLabel')).toHaveValue('20');
      await expect(field(page, 'admin.settings.minAdvanceLabel')).toHaveValue('90');
      await expect(field(page, 'admin.settings.maxHorizonLabel')).toHaveValue('45');
      await expect(field(page, 'admin.settings.cancelLimitLabel')).toHaveValue('240');
      await expect(field(page, 'admin.settings.bufferLabel')).toHaveValue('5');
      await expect(field(page, 'admin.settings.noShowThresholdLabel')).toHaveValue('0');
      await expect(field(page, 'admin.settings.privacyPolicyVersionLabel')).toHaveValue(original.privacy_policy_version);
    } finally {
      await restore(api, original);
    }
  });

  // CLAUDE.md – Sicurezza: input validato lato server; decisione fetta 3: logo solo https
  test('valori non validi: errore e impostazioni invariate', async ({ page }) => {
    const api = await adminApi(page.request);
    const original = await readSettings(api);

    try {
      await loginAsAdmin(page);
      // Granularità fuori lista: si cambia via JS il valore dell'opzione selezionata
      for (const value of ['7', '0']) {
        await page.goto('/admin/impostazioni');
        await field(page, 'admin.settings.slotGranularityLabel').evaluate((select, forged) => {
          const element = select as HTMLSelectElement;
          const option = element.options[element.selectedIndex] ?? element.options[0];
          if (option) option.value = forged;
          element.value = forged;
        }, value);
        await disableNativeValidation(page);
        await saveButton(page).click();
        await expect(page.getByText(s('admin.common.invalid')), `nessun errore per la granularità ${value}`).toBeVisible();
        expect(await readSettings(api)).toEqual(original);
      }

      const attempts: Array<[string, string]> = [
        ['admin.settings.maxHorizonLabel', '0'],
        ['admin.settings.logoUrlLabel', 'http://example.com/logo.png'],
        ['admin.settings.bufferLabel', '-5'],
        // Versione dell'informativa: in sola lettura dalla review della fetta 5, non si invia più.
        ['admin.settings.nameLabel', ''],
      ];
      for (const [key, value] of attempts) {
        await page.goto('/admin/impostazioni');
        await field(page, key).fill(value);
        await disableNativeValidation(page);
        await saveButton(page).click();
        await expect(page.getByText(s('admin.common.invalid')), `nessun errore per ${key} = ${JSON.stringify(value)}`).toBeVisible();
        expect(await readSettings(api)).toEqual(original);
      }
    } finally {
      await restore(api, original);
    }
  });

  // SPEC §2: le impostazioni sono solo dell'admin
  test('il barbiere non accede alle impostazioni', async ({ page }) => {
    await loginAsBarber(page);
    await page.goto('/admin/impostazioni');
    await expectPath(page, '/admin');
    await expect(page.getByLabel(s('admin.settings.privacyPolicyVersionLabel'), { exact: true })).toHaveCount(0);
  });
});
