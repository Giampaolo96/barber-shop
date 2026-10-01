// Test di accettazione – FETTA 0 (SPEC §11: "Setup progetto, CI, Supabase locale, deploy di prova").
// Fatta quando: "Pagina vuota online, test che girano in CI".
// Sono test di fumo sulla struttura del progetto: leggono i file dalla root del repo.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, test, vi } from 'vitest';

// Root del repo calcolata dalla posizione di questo file (tests/acceptance/), non dalla cwd.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);

const readText = (...segments: string[]): string => {
  const path = fromRoot(...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
};

const isFile = (...segments: string[]): boolean => {
  const path = fromRoot(...segments);
  return existsSync(path) && statSync(path).isFile();
};

const isDirectory = (...segments: string[]): boolean => {
  const path = fromRoot(...segments);
  return existsSync(path) && statSync(path).isDirectory();
};

type PackageJson = {
  scripts?: Record<string, string>;
  engines?: { node?: string };
};

const readPackageJson = (): PackageJson => JSON.parse(readText('package.json')) as PackageJson;

/** Prima major numerica presente in una stringa di versione ("v22.11.0", ">=22 <23", "22.x"). */
const firstMajor = (version: string): number | null => {
  const match = /(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
};

/** tsconfig.json è JSONC (commenti, virgole finali): lo si legge con il parser di TypeScript. */
const readTsconfig = (): { compilerOptions?: Record<string, unknown> } => {
  const path = fromRoot('tsconfig.json');
  expect(existsSync(path), 'file mancante: tsconfig.json').toBe(true);
  const result = ts.readConfigFile(path, (p) => readFileSync(p, 'utf8'));
  expect(result.error, 'tsconfig.json non è analizzabile').toBeUndefined();
  return result.config as { compilerOptions?: Record<string, unknown> };
};

/** Righe di assegnazione `NOME=valore` di un file .env (commenti e righe vuote esclusi). */
const parseEnv = (content: string): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    entries.set(name, value);
  }
  return entries;
};

/**
 * Comandi solo-Linux usati da uno script npm. Un comando conta solo come parola intera in
 * posizione di comando: a inizio script o subito dopo `&&`, `||`, `;`, `|`. Non si cercano
 * sottostringhe ("format" contiene "rm", "prettier --write" non è un `rm`).
 */
const findNonPortableCommands = (script: string): string[] => {
  const found: string[] = [];
  for (const segment of script.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).filter((word) => word !== '');
    const [command, ...args] = words;
    if (command === undefined) continue;
    if (['rm', 'cp', 'mv', 'export', 'touch', 'chmod'].includes(command)) found.push(command);
    if (command === 'mkdir' && args.includes('-p')) found.push('mkdir -p');
    // Variabile d'ambiente in linea (`NODE_ENV=test comando`): non funziona in cmd/PowerShell.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command) && args.length > 0) found.push('VAR=valore comando');
  }
  return found;
};

describe('package.json e versione di Node – SPEC §11 fetta 0', () => {
  // SPEC §11 fetta 0 + CLAUDE.md – Comandi
  test.each(['dev', 'build', 'start', 'lint', 'typecheck', 'test', 'test:e2e'])(
    'package.json espone lo script "%s"',
    (name) => {
      const scripts = readPackageJson().scripts ?? {};
      expect(typeof scripts[name]).toBe('string');
      expect((scripts[name] ?? '').trim()).not.toBe('');
    },
  );

  // SPEC §11 fetta 0 (piano approvato: Node fissato)
  test('package.json dichiara engines.node con una major numerica', () => {
    const node = readPackageJson().engines?.node;
    expect(typeof node).toBe('string');
    expect(firstMajor(node ?? '')).not.toBeNull();
  });

  // SPEC §11 fetta 0 (piano approvato: Node fissato)
  test('.nvmrc esiste ed è coerente con la major di engines.node', () => {
    const nvmrc = readText('.nvmrc').trim();
    expect(nvmrc).not.toBe('');
    const nvmrcMajor = firstMajor(nvmrc);
    const enginesMajor = firstMajor(readPackageJson().engines?.node ?? '');
    expect(nvmrcMajor, '.nvmrc deve contenere una versione numerica').not.toBeNull();
    expect(enginesMajor, 'engines.node deve contenere una versione numerica').not.toBeNull();
    expect(nvmrcMajor).toBe(enginesMajor);
  });

  // SPEC §11 fetta 0 (piano approvato: lockfile committato, serve a `npm ci` in CI)
  test('package-lock.json esiste nella root', () => {
    expect(isFile('package-lock.json')).toBe(true);
  });

  // CLAUDE.md – Ambiente: "niente comandi solo-Linux nei package.json (usare rimraf, cross-env)"
  test('nessuno script npm usa comandi solo-Linux', () => {
    const scripts = readPackageJson().scripts ?? {};
    expect(Object.keys(scripts).length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      for (const label of findNonPortableCommands(command)) {
        violations.push(`${name}: "${command}" usa ${label}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // CLAUDE.md – Ambiente: il controllo segnala i comandi, non le sottostringhe
  test.each([
    'prettier --write .',
    'npm run format',
    'prettier --check . && eslint',
    'next export',
    'rimraf .next && next build',
    'cross-env NODE_ENV=test vitest run',
    'tsc --noEmit',
  ])('il controllo di portabilità non segnala "%s"', (script) => {
    expect(findNonPortableCommands(script)).toEqual([]);
  });

  // CLAUDE.md – Ambiente: il controllo riconosce i comandi a inizio script e dopo && ; | ||
  test.each<[string, string[]]>([
    ['rm -rf .next', ['rm']],
    ['next build && cp -r public out', ['cp']],
    ['eslint; mv a b', ['mv']],
    ['echo x | touch y', ['touch']],
    ['tsc || chmod +x bin', ['chmod']],
    ['mkdir -p dist && tsc', ['mkdir -p']],
    ['export CI=1 && vitest', ['export']],
    ['NODE_ENV=test vitest run', ['VAR=valore comando']],
  ])('il controllo di portabilità segnala "%s"', (script, expected) => {
    expect(findNonPortableCommands(script)).toEqual(expected);
  });
});

describe('TypeScript – CLAUDE.md – Stack', () => {
  // CLAUDE.md – Stack: "TypeScript strict"
  test('tsconfig.json ha compilerOptions.strict === true', () => {
    expect(readTsconfig().compilerOptions?.strict).toBe(true);
  });

  // SPEC §11 fetta 0 (piano approvato: alias `@/*` -> `src/*`)
  test('tsconfig.json mappa l\'alias "@/*" su "src/*"', () => {
    const paths = readTsconfig().compilerOptions?.paths as Record<string, string[]> | undefined;
    const targets = (paths?.['@/*'] ?? []).map((target) => target.replace(/^\.\//, ''));
    expect(targets).toEqual(['src/*']);
  });
});

describe('Playwright webServer – SPEC §11 fetta 0', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const webServerCommand = async (ci: string): Promise<string> => {
    vi.stubEnv('CI', ci);
    vi.resetModules();
    const mod = (await import('../../playwright.config')) as {
      default: { webServer?: { command?: string } | Array<{ command?: string }> };
    };
    const webServer = mod.default.webServer;
    const first = Array.isArray(webServer) ? webServer[0] : webServer;
    expect(first?.command, 'playwright.config.ts deve definire webServer.command').toBeTypeOf('string');
    return first?.command ?? '';
  };

  // SPEC §11 fetta 0 (deciso dall'utente: in CI gli e2e girano sulla build di produzione)
  test('in CI il webServer fa build + start, non dev', async () => {
    const command = await webServerCommand('true');
    expect(command).toMatch(/\bbuild\b/);
    expect(command).toMatch(/\bstart\b/);
    expect(command).not.toMatch(/\bdev\b/);
    expect(command.search(/\bbuild\b/)).toBeLessThan(command.search(/\bstart\b/));
    expect(findNonPortableCommands(command)).toEqual([]);
  });

  // SPEC §11 fetta 0 (deciso dall'utente: in locale il webServer può usare dev)
  test('in locale il webServer usa dev', async () => {
    const command = await webServerCommand('');
    expect(command).toMatch(/\bdev\b/);
  });
});

describe('.env.example – CLAUDE.md – Sicurezza', () => {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'RESEND_API_KEY',
  ];

  // CLAUDE.md – Sicurezza: "documentare le variabili in .env.example"
  test.each(required)('.env.example documenta %s', (name) => {
    const env = parseEnv(readText('.env.example'));
    expect(env.has(name)).toBe(true);
  });

  // CLAUDE.md – Sicurezza + SPEC §8: "nessuna chiave privilegiata nel codice client"
  test('nessuna variabile NEXT_PUBLIC_* contiene SERVICE_ROLE', () => {
    const lines = readText('.env.example')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
    const offending = lines.filter(
      (line) => /^(?:export\s+)?NEXT_PUBLIC_/i.test(line) && /SERVICE_ROLE/i.test(line),
    );
    expect(offending).toEqual([]);
  });

  // CLAUDE.md – Sicurezza: "Nessun segreto nel repo"
  test('le chiavi in .env.example sono vuote o segnaposto, mai segreti reali', () => {
    const env = parseEnv(readText('.env.example'));
    const looksLikeSecret = [
      /^eyJ[A-Za-z0-9_-]{10,}\./, // JWT (chiavi Supabase anon / service_role)
      /^sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/, // nuove chiavi Supabase
      /^re_[A-Za-z0-9_]{16,}/, // chiave API Resend
    ];
    const leaked: string[] = [];
    for (const name of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) {
      expect(env.has(name), `${name} non documentata`).toBe(true);
      const value = env.get(name) ?? '';
      if (looksLikeSecret.some((pattern) => pattern.test(value))) leaked.push(name);
    }
    expect(leaked).toEqual([]);
  });
});

describe('Supabase locale – SPEC §11 fetta 0', () => {
  // SPEC §11 fetta 0: "Supabase locale"
  test('supabase/config.toml esiste', () => {
    expect(isFile('supabase', 'config.toml')).toBe(true);
  });

  // SPEC §11 fetta 0 + CLAUDE.md – Struttura: "supabase/migrations/ – SOLO migrazioni SQL"
  test('la cartella supabase/migrations/ esiste', () => {
    expect(isDirectory('supabase', 'migrations')).toBe(true);
  });

  // SPEC §11 fetta 0 + CLAUDE.md – Struttura: "supabase/seed.sql – dati demo"
  test('supabase/seed.sql esiste', () => {
    expect(isFile('supabase', 'seed.sql')).toBe(true);
  });
});

describe('i18n e home cliente – SPEC §9', () => {
  // SPEC §9: "Lingua: italiano (struttura predisposta per i18n)" + CLAUDE.md – Convenzioni
  test('src/i18n/it.ts esporta `it` con it.shop.name stringa non vuota (alias @/i18n/it)', async () => {
    const mod = (await import('@/i18n/it')) as { it?: unknown };
    expect(mod.it).toBeTypeOf('object');
    expect(mod.it).not.toBeNull();
    const shop = (mod.it as { shop?: unknown }).shop;
    expect(shop).toBeTypeOf('object');
    expect(shop).not.toBeNull();
    const name = (shop as { name?: unknown }).name;
    expect(name).toBeTypeOf('string');
    expect((name as string).trim()).not.toBe('');
  });

  // SPEC §9: "nessuna stringa hardcoded sparsa" + CLAUDE.md – Convenzioni
  test('la home cliente non contiene il nome del negozio scritto a mano', async () => {
    const { it: strings } = (await import('@/i18n/it')) as { it: { shop: { name: string } } };
    const source = readText('src', 'app', '(customer)', 'page.tsx');
    expect(strings.shop.name.trim()).not.toBe('');
    expect(source).not.toContain(strings.shop.name);
  });
});

describe('CI – SPEC §11 fetta 0: "test che girano in CI"', () => {
  /** Workflow senza le righe di commento YAML, per non farsi ingannare da comandi commentati. */
  const readWorkflow = (): string =>
    readText('.github', 'workflows', 'ci.yml')
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

  const commands: Array<[string, RegExp]> = [
    ['npm ci', /\bnpm ci\b/],
    ['npm run lint', /\bnpm run lint\b/],
    ['npm run typecheck', /\bnpm run typecheck\b/],
    ['npm test (o npm run test)', /\bnpm (?:run )?test(?![:\w-])/],
    ['npm run build', /\bnpm run build\b/],
    ['npm run test:e2e', /\bnpm run test:e2e\b/],
  ];

  // SPEC §11 fetta 0
  test('.github/workflows/ci.yml esiste', () => {
    expect(isFile('.github', 'workflows', 'ci.yml')).toBe(true);
  });

  // SPEC §11 fetta 0 + CLAUDE.md – Comandi (lint, typecheck e test devono passare)
  test.each(commands)('il workflow esegue "%s"', (_label, pattern) => {
    expect(readWorkflow()).toMatch(pattern);
  });

  // SPEC §11 fetta 0: le dipendenze si installano prima di ogni altro comando npm
  test('"npm ci" precede lint, typecheck, test, build ed e2e', () => {
    const workflow = readWorkflow();
    const installAt = workflow.search(/\bnpm ci\b/);
    expect(installAt).toBeGreaterThanOrEqual(0);
    for (const [label, pattern] of commands.slice(1)) {
      const at = workflow.search(pattern);
      expect(at, `comando mancante: ${label}`).toBeGreaterThanOrEqual(0);
      expect(at, `"${label}" deve venire dopo "npm ci"`).toBeGreaterThan(installAt);
    }
  });

  // SPEC §11 fetta 0 (piano approvato: trigger su push e pull_request verso main)
  test('il workflow parte su push e pull_request verso main', () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/\bpush\b/);
    expect(workflow).toMatch(/\bpull_request\b/);
    expect(workflow).toMatch(/\bmain\b/);
  });
});
