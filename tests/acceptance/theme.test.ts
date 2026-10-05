// Test di accettazione – FETTA 8a (identità visiva, tema "Mosca").
// Controlli statici sui sorgenti di src/ (come setup.test.ts) + funzione pura splitShopName.
// SPEC §3.1 (nome del negozio nelle impostazioni), §5.1 (home: info negozio), §9 (caricamento rapido,
// accessibilità di base) + decisioni approvate 1 e 2 della fetta 8a:
//   1. valori del tema solo in src/themes/<tema>/; token semantici in src/styles/tokens.css; il tema
//      attivo si sceglie in un solo file, src/themes/active.ts. Colori esadecimali solo in src/themes/;
//      niente oklch()/rgb() di shadcn nei CSS fuori da src/themes/. Font Bodoni Moda e Hanken Grotesk
//      con next/font, importato solo in src/themes/; nessun link a fonts.googleapis.com / gstatic.
//   2. il nome del negozio viene da shop_settings, mai scritto nel codice (oltre al segnaposto
//      it.shop.name); splitShopName(name) in src/lib/shop/name.ts → { lead, rest }.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = resolve(ROOT, 'src');
const THEMES = resolve(SRC, 'themes');

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|svg|html|md)$/;

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (TEXT_EXT.test(entry)) out.push(path);
  }
  return out;
};

/** Percorso relativo alla root con `/` (per messaggi leggibili anche su Windows). */
const rel = (path: string): string => relative(ROOT, path).split(sep).join('/');
const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + sep);

const SRC_FILES = walk(SRC);
const OUTSIDE_THEMES = SRC_FILES.filter((f) => !inside(f, THEMES));
const read = (path: string): string => readFileSync(path, 'utf8');

/** Righe `file:riga: testo` che soddisfano `re` (regex senza flag g). */
const findLines = (files: string[], re: RegExp): string[] =>
  files.flatMap((file) =>
    read(file)
      .split(/\r?\n/)
      .flatMap((line, i) => (re.test(line) ? [`${rel(file)}:${i + 1}: ${line.trim()}`] : [])),
  );

/** Specificatori di import/require/@import di un file (TS, TSX, CSS). */
const importSpecifiers = (source: string): string[] => {
  const re =
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|@import\s+(?:url\(\s*)?|@plugin\s+|@source\s+)['"]([^'"]+)['"]/g;
  return [...source.matchAll(re)].map((m) => m[1]);
};

/** Directory dei temi concreti (src/themes/<nome>/). */
const themeDirs = (): string[] =>
  existsSync(THEMES)
    ? readdirSync(THEMES)
        .map((name) => resolve(THEMES, name))
        .filter((path) => statSync(path).isDirectory())
    : [];

/** Percorso assoluto a cui punta uno specificatore (alias `@/` = src/), o null se è un pacchetto. */
const resolveSpecifier = (file: string, spec: string): string | null => {
  if (spec.startsWith('@/')) return resolve(SRC, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(file), spec);
  return null;
};

describe('Tema: valori solo in src/themes/ (decisione 1, SPEC §9)', () => {
  test('src/ contiene sorgenti da controllare', () => {
    expect(OUTSIDE_THEMES.length).toBeGreaterThan(0);
  });

  test('nessun colore esadecimale letterale in src/ fuori da src/themes/', () => {
    // #RGB, #RGBA, #RRGGBB, #RRGGBBAA; esclusi i riferimenti a entità HTML (&#123;)
    const hex = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;
    expect(findLines(OUTSIDE_THEMES, hex)).toEqual([]);
  });

  test('nessun colore oklch()/rgb()/hsl() nei CSS fuori da src/themes/ (via quelli di shadcn)', () => {
    const css = OUTSIDE_THEMES.filter((f) => f.endsWith('.css'));
    expect(findLines(css, /\b(?:oklch|oklab|rgba?|hsla?|lab|lch)\(/)).toEqual([]);
  });

  test('esistono src/themes/active.ts, src/themes/mosca/ e src/styles/tokens.css', () => {
    expect(existsSync(resolve(THEMES, 'active.ts')), 'src/themes/active.ts').toBe(true);
    expect(existsSync(resolve(THEMES, 'mosca')) && statSync(resolve(THEMES, 'mosca')).isDirectory(), 'src/themes/mosca/').toBe(
      true,
    );
    expect(existsSync(resolve(SRC, 'styles', 'tokens.css')), 'src/styles/tokens.css').toBe(true);
  });

  test('src/themes/active.ts importa il tema mosca', () => {
    const active = resolve(THEMES, 'active.ts');
    expect(existsSync(active), 'src/themes/active.ts').toBe(true);
    const targets = importSpecifiers(read(active))
      .map((spec) => resolveSpecifier(active, spec))
      .filter((p): p is string => p !== null);
    expect(targets.some((p) => inside(p, resolve(THEMES, 'mosca')))).toBe(true);
  });

  test('src/themes/active.ts è l\'unico file fuori da un tema che importa un tema concreto', () => {
    const dirs = themeDirs();
    expect(dirs.length, 'almeno un tema in src/themes/').toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (file === resolve(THEMES, 'active.ts')) continue;
      const ownTheme = dirs.find((d) => inside(file, d));
      for (const spec of importSpecifiers(read(file))) {
        const target = resolveSpecifier(file, spec);
        if (target === null) continue;
        const theme = dirs.find((d) => inside(target, d));
        if (theme !== undefined && theme !== ownTheme) offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Font con next/font, nessuna richiesta a Google (decisione 1, SPEC §9)', () => {
  test('next/font è importato solo dentro src/themes/', () => {
    const offenders = OUTSIDE_THEMES.filter((f) => importSpecifiers(read(f)).some((s) => s.startsWith('next/font')));
    expect(offenders.map(rel)).toEqual([]);
  });

  test('il tema mosca carica Bodoni Moda e Hanken Grotesk con next/font', () => {
    const files = walk(resolve(THEMES, 'mosca'));
    const usesNextFont = files.some((f) => importSpecifiers(read(f)).some((s) => s.startsWith('next/font')));
    expect(usesNextFont, 'import da next/font in src/themes/mosca/').toBe(true);
    const all = files.map(read).join('\n');
    expect(all).toMatch(/Bodoni[ _]Moda/);
    expect(all).toMatch(/Hanken[ _]Grotesk/);
  });

  test('nessun riferimento a fonts.googleapis.com o fonts.gstatic.com in src/', () => {
    expect(findLines(SRC_FILES, /fonts\.(?:googleapis|gstatic)\.com/i)).toEqual([]);
  });
});

describe('Nome del negozio dalle impostazioni (decisione 2, SPEC §3.1)', () => {
  test('"Mosca" non compare in src/ fuori da src/themes/', () => {
    expect(findLines(OUTSIDE_THEMES, /mosca/i)).toEqual([]);
  });

  test('il seed imposta il nome "Mosca Barber Shop" su shop_settings', () => {
    const seed = read(resolve(ROOT, 'supabase', 'seed.sql'));
    expect(seed).toMatch(/update\s+public\.shop_settings\s+set[^;]*?\bname\s*=\s*'Mosca Barber Shop'/i);
  });
});

// ---------------------------------------------------------------------------
// splitShopName (src/lib/shop/name.ts)
// ---------------------------------------------------------------------------
type NameModule = { splitShopName: (name: string) => { lead: string; rest: string } };
const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

describe('splitShopName (decisione 2)', () => {
  let mod: NameModule;
  let loadError: unknown = null;
  beforeAll(async () => {
    try {
      mod = await load<NameModule>('@/lib/shop/name');
    } catch (error) {
      loadError = error;
    }
  });
  beforeEach(() => {
    if (loadError) throw loadError;
  });

  test('prima parola e resto', () => {
    expect(mod.splitShopName('Mosca Barber Shop')).toEqual({ lead: 'Mosca', rest: 'Barber Shop' });
  });

  test('spazi iniziali, finali e multipli ridotti', () => {
    expect(mod.splitShopName('  Mosca   Barber    Shop  ')).toEqual({ lead: 'Mosca', rest: 'Barber Shop' });
  });

  test('una sola parola: rest vuoto', () => {
    expect(mod.splitShopName('Mosca')).toEqual({ lead: 'Mosca', rest: '' });
    expect(mod.splitShopName('  Mosca  ')).toEqual({ lead: 'Mosca', rest: '' });
  });

  test('stringa vuota o di soli spazi: lead e rest vuoti', () => {
    expect(mod.splitShopName('')).toEqual({ lead: '', rest: '' });
    expect(mod.splitShopName('   ')).toEqual({ lead: '', rest: '' });
  });

  test('due parole', () => {
    expect(mod.splitShopName('Barber Shop')).toEqual({ lead: 'Barber', rest: 'Shop' });
  });
});
