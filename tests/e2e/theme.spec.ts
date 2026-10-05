// Test di accettazione e2e – FETTA 8a (identità visiva, tema "Mosca").
// SPEC §3.1 (nome del negozio nelle impostazioni), §5.1 (home: info negozio, pulsante "Prenota"),
// §9 (caricamento rapido su 4G, accessibilità di base: tap target) + decisioni approvate della fetta 8a:
//   1. font Bodoni Moda e Hanken Grotesk con next/font (serviti dall'app, nessuna richiesta a Google);
//   2. heading della home con nome accessibile = nome completo da shop_settings;
//   3. home con stato di apertura del giorno e orari settimanali;
//   6/8. la mosca (componente con data-testid="fly") sta nella testata dell'area clienti, senza
//        animazioni con prefers-reduced-motion: reduce; niente mosca nell'area admin.
//
// Testi attesi in src/i18n/it.ts ({time} = "HH:MM" nella timezone del negozio):
//   it.home.openNow     es. "Aperto fino alle {time}"
//   it.home.opensAt     es. "Apre alle {time}"
//   it.home.closedToday es. "Oggi chiuso"
//   it.home.hoursTitle  es. "Orari"   (heading della sezione degli orari settimanali)
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
// Il nome del negozio si legge da shop_settings con la chiave pubblica (lettura consentita ad anon).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test } from '@playwright/test';

import { apiHeaders, s, supabaseUrl } from './admin-helpers';

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Regex di un testo i18n con il segnaposto {time} = HH:MM. */
const withTime = (key: string): string => escapeRe(s(key)).split(escapeRe('{time}')).join('\\d{2}:\\d{2}');

test.describe('Tema – home cliente (fetta 8a)', () => {
  // Decisione 1, SPEC §9: font self-hosted con next/font, nessuna richiesta a Google Fonts
  test('font Bodoni Moda e Hanken Grotesk serviti dall\'app, nessuna richiesta a fonts.googleapis/gstatic', async ({
    page,
    baseURL,
  }) => {
    const googleRequests: string[] = [];
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (/fonts\.(googleapis|gstatic)\.com/i.test(url)) googleRequests.push(url);
      if (request.resourceType() === 'font') fontRequests.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    expect(googleRequests).toEqual([]);
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
    expect(fontRequests.filter((url) => new URL(url).origin !== origin)).toEqual([]);

    // next/font può rinominare le famiglie (es. "__Bodoni_Moda_abc123"): si confrontano normalizzate
    const families = await page.evaluate(() => [...document.fonts].map((face) => face.family));
    const normalized = families.map((family) => family.toLowerCase().replace(/[^a-z]/g, ''));
    expect(normalized.some((f) => f.includes('bodonimoda')), `famiglie: ${families.join(', ')}`).toBe(true);
    expect(normalized.some((f) => f.includes('hankengrotesk')), `famiglie: ${families.join(', ')}`).toBe(true);
  });

  // Decisioni 2 e 3, SPEC §3.1, §5.1
  test('heading con il nome completo dalle impostazioni, stato di apertura e orari settimanali', async ({
    page,
    request,
  }) => {
    const response = await request.get(`${supabaseUrl()}/rest/v1/shop_settings?select=name`, {
      headers: apiHeaders(),
    });
    expect(response.ok(), `lettura di shop_settings: ${response.status()}`).toBe(true);
    const [settings] = (await response.json()) as Array<{ name: string }>;
    const shopName = settings?.name.trim().replace(/\s+/g, ' ') ?? '';
    expect(shopName).not.toBe('');

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: shopName, exact: true })).toBeVisible();

    // Uno dei tre stati, a seconda dell'ora reale e degli orari del giorno
    const status = new RegExp(
      `${withTime('home.openNow')}|${withTime('home.opensAt')}|${escapeRe(s('home.closedToday'))}`,
    );
    await expect(page.getByRole('main').getByText(status).first()).toBeVisible();

    // Orari settimanali: il seed ha fasce dal martedì al sabato
    await expect(page.getByRole('heading', { name: s('home.hoursTitle') })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/);

    // Il pulsante resta "Prenota" (SPEC §5.1)
    await expect(page.getByRole('link', { name: s('home.book'), exact: true })).toBeVisible();
  });

  test.describe('con prefers-reduced-motion: reduce', () => {
    test.use({ reducedMotion: 'reduce' });

    // Decisioni 6 e 8, SPEC §9 (accessibilità di base, tap target ≥ 44px)
    test('la mosca nella testata non si anima; CTA "Prenota" alta almeno 44px; niente mosca in admin', async ({
      page,
    }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const fly = page.getByTestId('fly');
      await expect(fly.first()).toBeVisible();

      // Nessuna animazione CSS/Web Animations sugli elementi della mosca e sui loro discendenti
      const animations = await fly.evaluateAll((elements) =>
        elements.flatMap((el) =>
          el.getAnimations({ subtree: true }).map((a) => `${a.constructor.name} ${(a as CSSAnimation).animationName ?? ''}`),
        ),
      );
      expect(animations).toEqual([]);

      // Nessun movimento guidato da JavaScript: posizione e transform stabili per ~30 frame
      const frames = await fly.first().evaluate(
        (el) =>
          new Promise<string[]>((done) => {
            const samples: string[] = [];
            const sample = (): void => {
              const r = el.getBoundingClientRect();
              samples.push(`${r.x},${r.y},${r.width},${r.height},${getComputedStyle(el).transform}`);
              if (samples.length < 30) requestAnimationFrame(sample);
              else done(samples);
            };
            requestAnimationFrame(sample);
          }),
      );
      expect(new Set(frames).size, `campioni: ${[...new Set(frames)].join(' | ')}`).toBe(1);

      const cta = page.getByRole('link', { name: s('home.book'), exact: true });
      const box = await cta.boundingBox();
      expect(box, 'CTA "Prenota" visibile').not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      // Decisione 8: area admin senza mosca (la pagina di login è pubblica)
      const admin = await page.goto('/admin/login');
      expect(admin?.status()).toBe(200);
      await expect(page.getByLabel(s('auth.staffLogin.emailLabel'))).toBeVisible();
      await expect(page.getByTestId('fly')).toHaveCount(0);
    });
  });
});
