// Fetta 8k, migliorie della review approvate dall'utente: il messaggio d'errore di "Cancella" sulla
// prossima prenotazione (blocco glass-ink, nero nel tema Mosca) ha contrasto ≥ 4,5:1 in ogni tema.
// Sul blocco il messaggio usa il colore del testo del blocco (--glass-ink-fg), non --danger: qui si
// verifica quel contrasto sui valori dei temi, e che la pagina passi davvero quelle classi.
// Helper dei token copiati da booking-when-row.test.ts (test di accettazione, non si importa da lì).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...path: string[]): string => readFileSync(resolve(ROOT, ...path), 'utf8');
const themeCss = (theme: string): string => read('src', 'themes', theme, 'theme.css');

/** Dichiarazioni `--nome: valore` del primo blocco `:root { … }` (commenti esclusi). */
const rootTokens = (css: string): Record<string, string> => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = clean.indexOf('{', clean.indexOf(':root'));
  let depth = 0;
  let end = open;
  for (; end < clean.length; end++) {
    if (clean[end] === '{') depth++;
    if (clean[end] === '}' && --depth === 0) break;
  }
  const body = clean.slice(open + 1, end);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], (m[2] ?? '').trim()]));
};

/** Mosca neon importa prima il CSS di Mosca e poi il proprio: i suoi valori vincono. */
const MOSCA = rootTokens(themeCss('mosca'));
const NEON = { ...MOSCA, ...rootTokens(themeCss('mosca-neon')) };

const token = (tokens: Record<string, string>, name: string): string => {
  const value = tokens[name];
  if (value === undefined) throw new Error(`token ${name} non dichiarato`);
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  return ref?.[1] ? token(tokens, ref[1]) : value;
};

type Rgba = { r: number; g: number; b: number; a: number };
const hex = (value: string): Rgba => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!m?.[1]) throw new Error(`colore atteso #rrggbb o #rrggbbaa: ${value}`);
  const n = (i: number) => parseInt(m[1]?.slice(i, i + 2) ?? '0', 16);
  return { r: n(0), g: n(2), b: n(4), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
};
/** Colore del tema: esadecimale, oppure `transparent`. */
const color = (value: string): Rgba => (value === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : hex(value));
const over = (top: Rgba, bottom: Rgba, opacity = 1): Rgba => {
  const a = top.a * opacity;
  const mix = (t: number, b: number) => t * a + b * (1 - a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
};
const luminance = ({ r, g, b }: Rgba): number => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: Rgba, b: Rgba): number => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Fondo del blocco glass-ink: il suo colore sopra la pagina; nel neon il caso peggiore con la luce d'ambiente. */
const blockBackground = (tokens: Record<string, string>): Rgba => {
  const surface = hex(token(tokens, '--surface'));
  const ambient = tokens['--ambient-color'] ? hex(token(tokens, '--ambient-color')) : null;
  const page = ambient ? over(ambient, surface, Number(token(tokens, '--ambient-opacity'))) : surface;
  return over(color(token(tokens, '--glass-ink-bg')), page);
};

describe('Fetta 8k – errore di cancellazione sulla prossima prenotazione (glass-ink)', () => {
  test.each([
    ['Mosca', MOSCA],
    ['Mosca neon', NEON],
  ])('%s: testo del blocco sul fondo del blocco ≥ 4,5:1', (_name, tokens) => {
    const text = over(color(token(tokens, '--glass-ink-fg')), blockBackground(tokens));
    expect(contrast(text, blockBackground(tokens))).toBeGreaterThanOrEqual(4.5);
  });

  test('Mosca: --danger sul blocco nero non basterebbe (per questo sul blocco il messaggio non usa --danger)', () => {
    expect(contrast(hex(token(MOSCA, '--danger')), blockBackground(MOSCA))).toBeLessThan(4.5);
  });

  test('la pagina passa al messaggio della prossima prenotazione testo e filetto nel colore del blocco', () => {
    const page = read('src', 'app', '(customer)', 'prenotazioni', 'page.tsx');
    expect(page).toMatch(/const ON_INK_ERROR = "border-current text-current";/);
    expect(page).toMatch(/errorClassName=\{kind === "next" \? ON_INK_ERROR : undefined\}/);
    const button = read('src', 'components', 'booking', 'cancel-booking-button.tsx');
    expect(button).toMatch(/className=\{cn\("border-l-2 border-destructive pl-3 text-sm text-destructive", errorClassName\)\}/);
  });
});
