// Test di accettazione – FETTA 8 (SPEC §11: "PWA (manifest, icone, installazione) + rifinitura UI",
// fatta quando "Installabile su iOS e Android").
// Sezioni: SPEC §5.6 (installazione PWA, istruzioni per iOS), §8 (nessun dato personale fuori dalla
// sessione), §9 (caricamento rapido, testi in italiano), CLAUDE.md – Convenzioni (colori solo dal
// tema) + decisioni approvate per la fetta 8 ("Manifest e icone", "Installazione", "Service worker",
// "Eccezione a requireRole").
//
// Interfacce attese:
//   src/app/manifest.ts      default export (sync o async) → MetadataRoute.Manifest; nome da
//                            getShopInfo() di @/lib/booking/queries (it.shop.name se null),
//                            short_name = splitShopName(name).lead; colori da appIdentity.
//   src/themes/mosca/index.ts e src/themes/active.ts: export appIdentity
//                            { themeColor: '#rrggbb', backgroundColor: '#rrggbb', ... }
//   public/sw.js             service worker scritto a mano (eventi install, activate, fetch).
//   public/sw-kill-switch.js interruttore d'emergenza: copiato su sw.js svuota le cache e si
//                            deregistra (documentato in docs/adr/009-*.md).
//   src/components/pwa/register-sw.tsx  "use client", registra /sw.js solo in production; montato
//                            da un layout di src/app.
//   src/components/pwa/install-banner.tsx "use client" (comportamento negli e2e).
//   src/app/offline/route.ts HTML statico generato alla build, senza sessione né dati; testi it.offline.{title,body}.
//   next.config.ts           headers(): Cache-Control no-cache su /sw.js.
//   src/i18n/it.ts           it.pwa.install.{title,iosInstructions,install,dismiss,profileEntry}
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Specifier in una variabile: `tsc --noEmit` resta verde finché i moduli non esistono.
const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);
const readText = (...segments: string[]): string => {
  const path = fromRoot(...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
};
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const hasDirective = (code: string, directive: 'use client' | 'use server'): boolean =>
  new RegExp(`^\\s*['"]${directive}['"]`, 'm').test(code);

// ---------------------------------------------------------------------------
// Moduli finti: impostazioni del negozio e font (next/font funziona solo dentro Next)
// ---------------------------------------------------------------------------
const shop = vi.hoisted(() => ({ info: null as null | Record<string, unknown> }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/booking/queries', () => ({ getShopInfo: async () => shop.info }));
// Font del tema Mosca (fetta 8a, tests/acceptance/theme.test.ts)
vi.mock('next/font/google', () => {
  const font = () => ({ className: 'font', variable: 'font-variable', style: { fontFamily: 'font' } });
  return { Bodoni_Moda: font, Hanken_Grotesk: font };
});

const SHOP_INFO = {
  name: 'Mosca Barber Shop',
  address: 'Via Roma 1',
  phone: '+390000000000',
  timezone: 'Europe/Rome',
  maxHorizonDays: 30,
  cancelLimitMin: 120,
  noShowBlockThreshold: 2,
};

beforeEach(() => {
  shop.info = { ...SHOP_INFO };
});

type ManifestIcon = { src: string; sizes?: string; type?: string; purpose?: string };
type Manifest = {
  name?: string;
  short_name?: string;
  display?: string;
  start_url?: string;
  scope?: string;
  lang?: string;
  theme_color?: string;
  background_color?: string;
  icons?: ManifestIcon[];
};
type AppIdentity = { themeColor: string; backgroundColor: string };

const manifest = async (): Promise<Manifest> => {
  const mod = await load<{ default: () => Manifest | Promise<Manifest> }>('@/app/manifest');
  expect(mod.default, 'src/app/manifest.ts deve avere un export default').toBeTypeOf('function');
  return await mod.default();
};

const appIdentity = async (): Promise<AppIdentity> => {
  const { appIdentity: identity } = await load<{ appIdentity: AppIdentity }>('@/themes/active');
  expect(identity, 'src/themes/active.ts deve esportare appIdentity').toBeDefined();
  return identity;
};

// ---------------------------------------------------------------------------
// Manifest (decisioni "Manifest e icone")
// ---------------------------------------------------------------------------
describe('manifest (SPEC §5.6, §11: installabile su iOS e Android)', () => {
  test('nome dalle impostazioni, nome breve = prima parola', async () => {
    const result = await manifest();
    expect(result.name).toBe('Mosca Barber Shop');
    expect(result.short_name).toBe('Mosca');
  });

  test('il nome segue le impostazioni (nessun nome scritto nel codice)', async () => {
    shop.info = { ...SHOP_INFO, name: 'Forbici d\'Oro' };
    const result = await manifest();
    expect(result.name).toBe('Forbici d\'Oro');
    expect(result.short_name).toBe('Forbici');
  });

  test('senza impostazioni: il segnaposto it.shop.name (come il titolo della pagina)', async () => {
    shop.info = null;
    const { it } = await load<{ it: { shop: { name: string } } }>('@/i18n/it');
    const result = await manifest();
    expect(result.name).toBe(it.shop.name);
    expect(String(result.short_name ?? '').trim()).not.toBe('');
  });

  test('display standalone, start_url e scope "/", lingua italiana', async () => {
    const result = await manifest();
    expect(result.display).toBe('standalone');
    expect(result.start_url).toBe('/');
    expect(result.scope).toBe('/');
    expect(result.lang).toBe('it');
  });

  test('colori dal tema: theme_color e background_color = appIdentity', async () => {
    const [result, identity] = await Promise.all([manifest(), appIdentity()]);
    expect(identity.themeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(identity.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.theme_color).toBe(identity.themeColor);
    expect(result.background_color).toBe(identity.backgroundColor);
  });

  test('icone PNG 192 e 512 (purpose any) e una 512 maskable, con percorsi interni', async () => {
    const icons = (await manifest()).icons ?? [];
    const isAny = (icon: ManifestIcon): boolean => icon.purpose === undefined || icon.purpose === 'any';
    for (const size of ['192x192', '512x512']) {
      expect(
        icons.some((icon) => icon.sizes === size && icon.type === 'image/png' && isAny(icon)),
        `icona ${size} image/png`,
      ).toBe(true);
    }
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'maskable')).toBe(true);
    for (const icon of icons) expect(icon.src.startsWith('/') && !icon.src.startsWith('//'), icon.src).toBe(true);
  });

  // Pubblico e senza dati personali (eccezione a requireRole, ADR 009)
  test('manifest.ts non legge la sessione', () => {
    const code = stripComments(readText('src', 'app', 'manifest.ts'));
    expect(code).not.toMatch(/\b(?:requireRole|getCurrentUser|loadCurrentUser|getUser|getClaims)\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Service worker in uno scope simulato (decisioni "Service worker")
// ---------------------------------------------------------------------------
const ORIGIN = 'http://localhost:3000';

type FakeRequest = {
  url: string;
  method: string;
  mode: string;
  destination: string;
  headers: Headers;
  credentials: string;
  redirect: string;
  clone: () => FakeRequest;
};

const request = (
  path: string,
  init: { method?: string; mode?: string; destination?: string; headers?: Record<string, string> } = {},
): FakeRequest => {
  const value: FakeRequest = {
    url: new URL(path, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    destination: init.destination ?? '',
    headers: new Headers(init.headers ?? {}),
    credentials: 'same-origin',
    redirect: 'follow',
    clone: () => value,
  };
  return value;
};
const navigation = (path: string): FakeRequest =>
  request(path, { mode: 'navigate', destination: 'document', headers: { accept: 'text/html' } });

const urlOf = (input: unknown): string =>
  typeof input === 'string' ? new URL(input, ORIGIN).href : new URL((input as { url: string }).url, ORIGIN).href;

const OFFLINE_HTML = '<html><body>offline</body></html>';

class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly scope: ServiceWorkerScope) {}
  async match(input: unknown, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    const key = urlOf(input);
    const found =
      this.entries.get(key) ??
      (options?.ignoreSearch
        ? [...this.entries].find(([url]) => url.split('?')[0] === key.split('?')[0])?.[1]
        : undefined);
    return found?.clone();
  }
  async matchAll(input?: unknown): Promise<Response[]> {
    const found = await this.match(input);
    return found ? [found] : [];
  }
  async put(input: unknown, response: Response): Promise<void> {
    this.entries.set(urlOf(input), response.clone());
  }
  async add(input: unknown): Promise<void> {
    const response = await this.scope.fetch(input);
    if (!response.ok) throw new TypeError('add: risposta non valida');
    await this.put(input, response);
  }
  async addAll(inputs: unknown[]): Promise<void> {
    for (const input of inputs) await this.add(input);
  }
  async delete(input: unknown): Promise<boolean> {
    return this.entries.delete(urlOf(input));
  }
  async keys(): Promise<Array<{ url: string }>> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly scope: ServiceWorkerScope) {}
  async open(name: string): Promise<FakeCache> {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.scope));
    return this.stores.get(name) as FakeCache;
  }
  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }
  async match(input: unknown, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    for (const store of this.stores.values()) {
      const found = await store.match(input, options);
      if (found) return found;
    }
    return undefined;
  }
  /** Tutti gli URL in cache, in ogni cache. */
  urls(): string[] {
    return [...this.stores.values()].flatMap((store) => [...store.entries.keys()]).sort();
  }
}

type Listener = (event: Record<string, unknown>) => unknown;

class ServiceWorkerScope {
  readonly listeners = new Map<string, Listener[]>();
  readonly caches = new FakeCacheStorage(this);
  readonly fetchCalls: string[] = [];
  networkDown = false;
  readonly unregister = vi.fn(async () => true);
  readonly skipWaiting = vi.fn(async () => undefined);

  readonly fetch = async (input: unknown): Promise<Response> => {
    const url = urlOf(input);
    this.fetchCalls.push(url);
    if (this.networkDown) throw new TypeError('Failed to fetch');
    if (new URL(url).pathname === '/offline') {
      return new Response(OFFLINE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(`rete:${url}`, { status: 200 });
  };

  constructor(file: string) {
    const listen = (type: string, listener: Listener): void => {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    };
    const sandbox: Record<string, unknown> = {
      console,
      URL,
      URLSearchParams,
      Request,
      Response,
      Headers,
      setTimeout,
      clearTimeout,
      caches: this.caches,
      fetch: this.fetch,
      addEventListener: listen,
      skipWaiting: this.skipWaiting,
      clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => []) },
      registration: { scope: `${ORIGIN}/`, unregister: this.unregister },
      location: new URL(`${ORIGIN}/sw.js`),
    };
    sandbox.self = sandbox;
    vm.runInNewContext(readText('public', file), sandbox, { filename: file });
  }

  private async dispatchExtendable(type: string): Promise<void> {
    const waits: Array<Promise<unknown>> = [];
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, waitUntil: (promise: Promise<unknown>) => waits.push(Promise.resolve(promise)) });
    }
    await Promise.all(waits);
  }

  install(): Promise<void> {
    return this.dispatchExtendable('install');
  }

  activate(): Promise<void> {
    return this.dispatchExtendable('activate');
  }

  /** Evento fetch: la risposta data a respondWith (undefined = gestita dalla rete del browser). */
  async request(req: FakeRequest): Promise<{ responded: boolean; response?: Response }> {
    let responded: Promise<Response> | undefined;
    const waits: Array<Promise<unknown>> = [];
    for (const listener of this.listeners.get('fetch') ?? []) {
      listener({
        type: 'fetch',
        request: req,
        clientId: '',
        resultingClientId: '',
        preloadResponse: Promise.resolve(undefined),
        respondWith: (value: Response | Promise<Response>) => {
          responded = Promise.resolve(value);
        },
        waitUntil: (promise: Promise<unknown>) => waits.push(Promise.resolve(promise)),
      });
    }
    const response = responded ? await responded : undefined;
    await Promise.allSettled(waits);
    // Le scritture in cache dopo la risposta possono restare in coda di qualche microtask
    for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
    return { responded: responded !== undefined, response };
  }
}

/** Service worker installato e attivato. */
const installedWorker = async (file = 'sw.js'): Promise<ServiceWorkerScope> => {
  const worker = new ServiceWorkerScope(file);
  await worker.install();
  await worker.activate();
  return worker;
};

const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/** Percorsi che possono stare in cache: pagina offline, file statici di Next e icone. */
const CACHEABLE_PATH = /^\/(?:offline$|_next\/static\/|icon\d*(?:[/?.-]|$)|apple-icon\d*(?:[/?.-]|$)|favicon\.ico$)/;

describe('public/sw.js – installazione e attivazione (decisioni "Service worker")', () => {
  test('all\'install mette in cache la pagina /offline', async () => {
    const worker = new ServiceWorkerScope('sw.js');
    await worker.install();
    expect(worker.caches.urls().map(pathOf)).toContain('/offline');
  });

  test('all\'install mette in cache solo pagina offline, statici e icone (niente pagine né /admin)', async () => {
    const worker = new ServiceWorkerScope('sw.js');
    await worker.install();
    const offending = worker.caches.urls().filter((url) => new URL(url).origin !== ORIGIN || !CACHEABLE_PATH.test(new URL(url).pathname));
    expect(offending).toEqual([]);
  });

  test('all\'activate cancella le cache delle versioni precedenti e tiene quella attuale', async () => {
    const worker = new ServiceWorkerScope('sw.js');
    for (const old of ['barber-shop-v0', 'static-old', 'workbox-precache']) {
      const store = await worker.caches.open(old);
      await store.put(`${ORIGIN}/_next/static/old.js`, new Response('vecchio'));
    }
    const before = new Set(await worker.caches.keys());
    await worker.install();
    const current = (await worker.caches.keys()).filter((name) => !before.has(name));
    expect(current.length, 'l\'install crea una cache versionata').toBeGreaterThan(0);
    await worker.activate();
    expect((await worker.caches.keys()).sort()).toEqual(current.sort());
  });
});

describe('public/sw.js – richieste (decisioni "Service worker")', () => {
  // Cache-first per i file statici di Next (nomi con hash, immutabili)
  test('/_next/static: la prima volta dalla rete e in cache, poi dalla cache anche offline', async () => {
    const worker = await installedWorker();
    const asset = '/_next/static/chunks/app-3f2a1b.js';

    const first = await worker.request(request(asset, { destination: 'script' }));
    expect(worker.fetchCalls.filter((url) => pathOf(url) === asset)).toHaveLength(1);
    if (first.responded) expect(await first.response?.text()).toBe(`rete:${ORIGIN}${asset}`);
    expect(worker.caches.urls()).toContain(`${ORIGIN}${asset}`);

    worker.networkDown = true;
    const second = await worker.request(request(asset, { destination: 'script' }));
    expect(second.responded).toBe(true);
    expect(await second.response?.text()).toBe(`rete:${ORIGIN}${asset}`);
    expect(worker.fetchCalls.filter((url) => pathOf(url) === asset)).toHaveLength(1);
  });

  test('icone del manifest e apple-icon: cache-first', async () => {
    const icons = ((await manifest()).icons ?? []).map((icon) => icon.src);
    expect(icons.length).toBeGreaterThan(0);
    const worker = await installedWorker();
    for (const src of [...new Set(icons), '/apple-icon']) {
      await worker.request(request(src, { destination: 'image' }));
      worker.networkDown = true;
      const again = await worker.request(request(src, { destination: 'image' }));
      expect(again.responded, `${src} servita dalla cache`).toBe(true);
      expect(await again.response?.text()).toBe(`rete:${new URL(src, ORIGIN).href}`);
      worker.networkDown = false;
    }
  });

  // Navigazioni sempre in rete: niente pagine vecchie né dati personali dalla cache
  test('navigazione con la rete: risposta dalla rete, nulla in cache', async () => {
    const worker = await installedWorker();
    const before = worker.caches.urls();
    for (const path of ['/', '/prenota', '/prenotazioni', '/profilo']) {
      const result = await worker.request(navigation(path));
      if (result.responded) expect(await result.response?.text()).toBe(`rete:${ORIGIN}${path}`);
      expect(worker.fetchCalls).toContain(`${ORIGIN}${path}`);
    }
    expect(worker.caches.urls()).toEqual(before);
  });

  test('navigazione senza rete: la pagina /offline messa in cache all\'install', async () => {
    const worker = await installedWorker();
    worker.networkDown = true;
    for (const path of ['/', '/prenota/orario?servizio=x', '/admin']) {
      const result = await worker.request(navigation(path));
      expect(result.responded, path).toBe(true);
      expect(await result.response?.text(), path).toBe(OFFLINE_HTML);
    }
  });

  test.each([
    ['server action (POST con Next-Action)', request('/prenota/riepilogo', { method: 'POST', headers: { 'next-action': 'abc123' } })],
    ['POST qualsiasi', request('/accedi', { method: 'POST' })],
    ['/auth/confirm', navigation('/auth/confirm?token_hash=pkce_x&type=email')],
    ['/auth/callback', navigation('/auth/callback?code=x')],
    ['/admin', navigation('/admin')],
    ['dati RSC di /admin', request('/admin/calendario?_rsc=1a2b', { headers: { rsc: '1' } })],
    ['dati RSC di una pagina', request('/prenotazioni?_rsc=1a2b', { headers: { rsc: '1' } })],
    ['API', request('/api/qualcosa')],
    ['manifest', request('/manifest.webmanifest', { destination: 'manifest' })],
    ['Supabase (altra origine)', request('http://127.0.0.1:54321/rest/v1/services?select=id')],
    ['statici di un\'altra origine', request('https://cdn.example/_next/static/chunks/x.js', { destination: 'script' })],
  ])('%s: nulla in cache, risposta solo dalla rete', async (_label, req) => {
    const worker = await installedWorker();
    const before = worker.caches.urls();
    const first = await worker.request(req);
    if (first.responded) expect(await first.response?.text()).toBe(`rete:${req.url}`);
    expect(worker.caches.urls()).toEqual(before);
  });
});

describe('Interruttore d\'emergenza del service worker (decisioni "Service worker", ADR 009)', () => {
  test('public/sw-kill-switch.js svuota tutte le cache e si deregistra', async () => {
    const worker = new ServiceWorkerScope('sw-kill-switch.js');
    for (const name of ['barber-shop-v1', 'altro']) {
      const store = await worker.caches.open(name);
      await store.put(`${ORIGIN}/_next/static/a.js`, new Response('a'));
    }
    await worker.install();
    await worker.activate();
    expect(await worker.caches.keys()).toEqual([]);
    expect(worker.unregister).toHaveBeenCalled();
  });

  test('l\'interruttore non risponde alle richieste (tutto va in rete)', async () => {
    const worker = await installedWorker('sw-kill-switch.js');
    const result = await worker.request(navigation('/prenota'));
    if (result.responded) expect(await result.response?.text()).toBe(`rete:${ORIGIN}/prenota`);
  });

  test('ADR 009 documenta l\'interruttore e l\'eccezione a requireRole per manifest, icone e /offline', () => {
    const adr = readdirSync(fromRoot('docs', 'adr')).find((name) => /^009-.*\.md$/.test(name));
    expect(adr, 'docs/adr/009-*.md').toBeDefined();
    const text = readText('docs', 'adr', adr ?? '');
    expect(text).toContain('sw-kill-switch.js');
    expect(text).toContain('requireRole');
    expect(text).toContain('/offline');
    expect(text).toMatch(/manifest/i);
  });
});

// ---------------------------------------------------------------------------
// Registrazione del service worker e intestazioni
// ---------------------------------------------------------------------------
describe('Registrazione e cache di /sw.js (decisioni "Service worker")', () => {
  const REGISTER = ['src', 'components', 'pwa', 'register-sw.tsx'] as const;

  test('register-sw.tsx è un componente client che registra /sw.js solo in production', () => {
    const code = stripComments(readText(...REGISTER));
    expect(hasDirective(code, 'use client')).toBe(true);
    expect(code).toMatch(/serviceWorker\s*\.\s*register\s*\(\s*['"`]\/sw\.js['"`]/);
    expect(code).toMatch(/process\.env\.NODE_ENV\s*[!=]==?\s*['"`]production['"`]|['"`]production['"`]\s*[!=]==?\s*process\.env\.NODE_ENV/);
  });

  test('un layout di src/app monta il componente di registrazione', () => {
    const layouts = ['src/app/layout.tsx', 'src/app/(customer)/layout.tsx']
      .filter((file) => existsSync(fromRoot(file)))
      .map((file) => readFileSync(fromRoot(file), 'utf8'));
    expect(layouts.some((code) => /['"]@\/components\/pwa\/register-sw['"]/.test(code))).toBe(true);
  });

  test('next.config: Cache-Control no-cache su /sw.js', async () => {
    const config = (await load<{ default: { headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> } }>(
      '../../next.config',
    )).default;
    expect(config.headers, 'next.config deve definire headers()').toBeTypeOf('function');
    const rules = (await config.headers?.()) ?? [];
    const sw = rules.find((rule) => rule.source === '/sw.js');
    expect(sw, 'regola per /sw.js').toBeDefined();
    const cacheControl = sw?.headers.find((header) => header.key.toLowerCase() === 'cache-control');
    expect(cacheControl?.value).toMatch(/no-cache/);
  });
});

// ---------------------------------------------------------------------------
// Pagina offline e banner (statici; il comportamento è negli e2e)
// ---------------------------------------------------------------------------
describe('Pagina /offline (decisioni "Service worker", SPEC §8)', () => {
  test('src/app/offline/route.ts non legge sessione, cookie né database', () => {
    const code = stripComments(readText('src', 'app', 'offline', 'route.ts'));
    expect(code).not.toMatch(/['"](?:@\/lib\/auth|@\/lib\/db|@\/lib\/booking|next\/headers)[^'"]*['"]/);
    expect(code).not.toMatch(/\b(?:requireRole|getCurrentUser|cookies|headers)\s*\(/);
  });

  // /offline è pubblica per ogni ruolo e stato del profilo (anche incompleto)
  test.each([
    { role: null, isBlocked: false, profileComplete: false },
    { role: 'customer', isBlocked: false, profileComplete: false },
    { role: 'customer', isBlocked: true, profileComplete: true },
    { role: 'barber', isBlocked: false, profileComplete: true },
    { role: 'admin', isBlocked: false, profileComplete: true },
  ])('decideAccess consente /offline a %o', async (who) => {
    const { decideAccess } = await load<{ decideAccess: (input: Record<string, unknown>) => unknown }>('@/lib/auth/access');
    expect(decideAccess({ path: '/offline', ...who })).toEqual({ type: 'allow' });
  });
});

describe('Banner di installazione (SPEC §5.6, decisioni "Installazione")', () => {
  test('install-banner.tsx: componente client, gestisce beforeinstallprompt e la modalità standalone', () => {
    const code = stripComments(readText('src', 'components', 'pwa', 'install-banner.tsx'));
    expect(hasDirective(code, 'use client')).toBe(true);
    expect(code).toContain('beforeinstallprompt');
    expect(code).toMatch(/display-mode:\s*standalone/);
    expect(code).toMatch(/navigator[^;\n]*standalone/);
  });

  // "Non ora" in localStorage, che può lanciare (Safari privato, storage disattivato)
  test('install-banner.tsx usa localStorage solo dentro try/catch', () => {
    const code = stripComments(readText('src', 'components', 'pwa', 'install-banner.tsx'));
    expect(code).toContain('localStorage');
    const outside = code.replace(/\btry\s*\{[^]*?\}\s*catch\b/g, '');
    expect(outside).not.toContain('localStorage');
  });
});

// ---------------------------------------------------------------------------
// Testi (SPEC §9)
// ---------------------------------------------------------------------------
const string = async (path: string): Promise<unknown> => {
  const { it: strings } = await load<{ it: unknown }>('@/i18n/it');
  let node: unknown = strings;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

describe('Testi della PWA (SPEC §5.6, §9)', () => {
  test.each([
    'pwa.install.title',
    'pwa.install.iosInstructions',
    'pwa.install.install',
    'pwa.install.dismiss',
    'pwa.install.profileEntry',
    'offline.title',
    'offline.body',
  ])('it.%s è una stringa non vuota', async (key) => {
    const value = await string(key);
    expect(typeof value).toBe('string');
    expect(String(value).trim()).not.toBe('');
  });

  test('istruzioni iOS: Condividi → Aggiungi alla schermata Home', async () => {
    const text = String(await string('pwa.install.iosInstructions'));
    expect(text).toMatch(/Condividi/);
    expect(text).toMatch(/Aggiungi alla schermata Home/);
  });

  test('pulsanti "Installa" e "Non ora", voce "Installa l\'app" nel profilo', async () => {
    expect(await string('pwa.install.install')).toBe('Installa');
    expect(await string('pwa.install.dismiss')).toBe('Non ora');
    expect(String(await string('pwa.install.profileEntry'))).toMatch(/^Installa l['’]app$/);
  });
});
