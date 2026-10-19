// Test di accettazione e2e – FETTA 8 (SPEC §11: "PWA (manifest, icone, installazione)", fatta
// quando "Installabile su iOS e Android").
// Sezioni: SPEC §5.6 (banner di installazione con istruzioni per iOS), §8 (pagine pubbliche senza
// dati personali), §9 (testi in italiano) + decisioni approvate per la fetta 8 ("Manifest e icone",
// "Installazione", "Service worker").
//
// Interfaccia attesa:
//   /manifest.webmanifest (application/manifest+json), icone PNG dalle sue `icons`;
//   <head>: link rel="manifest", link rel="apple-touch-icon" (PNG 180×180), meta theme-color,
//           meta apple-mobile-web-app-title = short_name, apple-mobile-web-app-status-bar-style coerente
//           con theme_color del manifest ("black" se scuro, "default" se chiaro; tema neon, approvato);
//   banner solo in home: region con nome it.pwa.install.title; testo it.pwa.install.iosInstructions
//           (iOS), pulsante it.pwa.install.install (dopo beforeinstallprompt), pulsante
//           it.pwa.install.dismiss ("Non ora", per sempre su quel dispositivo); mai in standalone;
//           solo sui telefoni (puntatore touch e viewport da telefono): mai sul computer, anche
//           quando Chrome o Edge desktop inviano beforeinstallprompt (fix approvato dall'utente);
//   /offline: pubblica, heading it.offline.title e testo it.offline.body.
// Il service worker si registra solo con la build di produzione: qui non si verifica.
// Prerequisiti: Supabase locale con il seed.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { apiHeaders, expectPath, s, supabaseUrl } from './admin-helpers';

/** Colore #rrggbb scuro (luminanza relativa WCAG sotto 0,5). */
const isDarkColor = (hex: string): boolean => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) < 0.5;
};

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

type Manifest = {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

/** Larghezza e altezza dall'intestazione IHDR di un PNG. */
const pngSize = (body: Buffer): { width: number; height: number } => {
  expect(body.subarray(1, 4).toString('latin1'), 'firma PNG').toBe('PNG');
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
};

const expectPng = async (request: APIRequestContext, src: string, size: number): Promise<void> => {
  const response = await request.get(src);
  expect(response.status(), src).toBe(200);
  expect(response.headers()['content-type'], src).toMatch(/^image\/png/);
  expect(pngSize(await response.body()), src).toEqual({ width: size, height: size });
};

const banner = (page: Page) => page.getByRole('region', { name: s('pwa.install.title') });

/** La pagina è caricata e idratata quanto basta perché il banner (client) possa comparire. */
const settled = async (page: Page): Promise<void> => {
  await page.waitForLoadState('networkidle');
};

// ---------------------------------------------------------------------------
// Manifest, icone e intestazioni (decisioni "Manifest e icone")
// ---------------------------------------------------------------------------
test.describe('Manifest e icone (SPEC §5.6, §11)', () => {
  test('/manifest.webmanifest: nome dalle impostazioni, standalone, icone PNG delle misure dichiarate', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json/);
    const manifest = (await response.json()) as Manifest;

    const settings = await request.get(`${supabaseUrl()}/rest/v1/shop_settings?select=name`, { headers: apiHeaders() });
    expect(settings.ok()).toBe(true);
    const [{ name }] = (await settings.json()) as Array<{ name: string }>;
    expect(manifest.name).toBe(name);
    expect(manifest.short_name).toBe(name.trim().split(/\s+/)[0]);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');

    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      const [width] = icon.sizes.split('x').map(Number);
      await expectPng(request, icon.src, width ?? 0);
    }
  });

  test('head della home: manifest, apple-touch-icon 180×180, theme-color e titolo per iOS', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /^(?:https?:\/\/[^/]+)?\/manifest\.webmanifest$/);
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as Manifest;

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href');
    expect(appleIcon, 'link rel="apple-touch-icon"').toBeTruthy();
    await expectPng(request, new URL(appleIcon ?? '', page.url()).href, 180);

    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', manifest.short_name);
    // Barra di stato coerente con il tema (tema neon, modifica approvata dall'utente): scura su un tema scuro.
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    const statusBar = isDarkColor(manifest.theme_color) ? 'black' : 'default';
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', statusBar);
  });
});

// ---------------------------------------------------------------------------
// Pagina offline (decisioni "Service worker")
// ---------------------------------------------------------------------------
test.describe('Pagina offline (SPEC §8)', () => {
  test('/offline si apre senza sessione', async ({ page }) => {
    const response = await page.goto('/offline');
    expect(response?.status()).toBe(200);
    await expectPath(page, '/offline');
    await expect(page.getByRole('heading', { name: s('offline.title') })).toBeVisible();
    await expect(page.getByText(s('offline.body'))).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Banner di installazione (SPEC §5.6, decisioni "Installazione")
// ---------------------------------------------------------------------------
test.describe('Banner di installazione su iPhone (SPEC §5.6)', () => {
  test.use({ userAgent: IPHONE_UA });

  test('solo in home, con le istruzioni per iOS; "Non ora" lo chiude anche dopo il ricaricamento', async ({ page }) => {
    // Solo in home
    await page.goto('/accedi');
    await settled(page);
    await expect(banner(page)).toHaveCount(0);

    await page.goto('/');
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByText(s('pwa.install.iosInstructions'))).toBeVisible();
    // Su iOS non c'è il prompt del browser: niente pulsante "Installa"
    await expect(banner(page).getByRole('button', { name: s('pwa.install.install'), exact: true })).toHaveCount(0);

    const dismiss = banner(page).getByRole('button', { name: s('pwa.install.dismiss'), exact: true });
    expect((await dismiss.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await dismiss.click();
    await expect(banner(page)).toHaveCount(0);

    await page.reload();
    await settled(page);
    await expect(banner(page)).toHaveCount(0);
  });

  test('app già installata (standalone): il banner non compare', async ({ context }) => {
    // Controllo, prima: nello stesso browser, fuori dalla modalità standalone, il banner compare
    // (senza banner il test non può passare per assenza del componente)
    const browserTab = await context.newPage();
    await browserTab.goto('/');
    await expect(banner(browserTab)).toBeVisible();

    const installed = await context.newPage();
    await installed.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        /display-mode:\s*standalone/.test(query)
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              addListener: () => undefined,
              removeListener: () => undefined,
              dispatchEvent: () => false,
            } as MediaQueryList)
          : original(query);
      Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true });
    });
    await installed.goto('/');
    await settled(installed);
    await expect(banner(installed)).toHaveCount(0);
  });
});

test.describe('Banner di installazione su Android (SPEC §5.6, §11)', () => {
  test('con beforeinstallprompt compare "Installa", che apre il prompt del browser', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __promptCalls: number }).__promptCalls = 0;
    });
    await page.goto('/');
    const install = page.getByRole('button', { name: s('pwa.install.install'), exact: true });

    // L'evento arriva quando il browser decide: lo si ripete finché il banner non è in ascolto
    await expect(async () => {
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string; platform: string }>;
        };
        event.prompt = async () => {
          (window as unknown as { __promptCalls: number }).__promptCalls += 1;
        };
        event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
        window.dispatchEvent(event);
      });
      await expect(install).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await expect(banner(page)).toBeVisible();
    await install.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls))
      .toBeGreaterThan(0);
  });
});

// Fix approvato dall'utente: Chrome ed Edge desktop inviano beforeinstallprompt, ma il banner
// compare solo sui telefoni (puntatore principale touch e viewport da telefono)
test.describe('Banner di installazione sul computer (SPEC §5.6)', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  test('con beforeinstallprompt il banner non compare', async ({ page }) => {
    await page.goto('/');

    // Controllo: l'evento arriva al componente (che lo trattiene per la voce del profilo), quindi
    // l'assenza del banner non dipende da una pagina non ancora idratata
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
              prompt: () => Promise<void>;
            };
            event.prompt = async () => undefined;
            window.dispatchEvent(event);
            return event.defaultPrevented;
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    await settled(page);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: s('pwa.install.install'), exact: true })).toHaveCount(0);
  });
});
