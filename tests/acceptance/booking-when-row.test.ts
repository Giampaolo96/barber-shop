// Test di accettazione – FETTA 8f ("Quando?": fila continua di giorni e caselle arrotondate;
// comportamento approvato dall'utente il 2026-10-25). SPEC §5.2 (pagina "Quando?": striscia dei giorni,
// colonne per barbiere, scorrimento), CLAUDE.md regola 5 (logica pura, senza I/O), docs/DESIGN.md (token).
//
// Funzioni pure attese in src/lib/booking/when-row.ts (posizioni in px dall'inizio del contenuto della
// fila; scrollLeft 0 = prima colonna del primo giorno al bordo, dopo i 16 px di scroll-padding):
//   rowDays(days: DayStatus[]): string[]
//     date non chiuse ("open" e "full"), nell'ordine: dal primo giorno non chiuso all'ultimo del periodo.
//   rowLayout({ days, barberCount, columnWidth, gap, dayGap }): RowLayout
//     RowLayout = { columns: RowColumn[]; width: number } (altri campi liberi), dove
//     RowColumn = { date: string; barberIndex: number; start: number; end: number }: per ogni giorno le
//     colonne dei barbieri (barberIndex 0..barberCount-1) separate da `gap`; fra l'ultima colonna di un
//     giorno e la prima del successivo `dayGap`. `width` = fine dell'ultima colonna.
//   firstColumnOffset(layout, date): number  scrollLeft che porta la prima colonna del giorno al bordo.
//   dayAtScroll(layout, scrollLeft): string   giorno della colonna più a sinistra con end > scrollLeft
//     (i 16 px di margine sono già esclusi: scrollLeft è il bordo dopo lo scroll-padding); limitato al
//     primo e all'ultimo giorno.
//   renderWindow(layout, scrollLeft, viewportWidth): string[]  giorni da disegnare (i visibili più un
//     viewport per lato), nell'ordine.
//   rescaleScroll(oldLayout, newLayout, scrollLeft): number  nuovo scrollLeft dopo un cambio di
//     columnWidth: stessa colonna più a sinistra visibile (stessa frazione o allineata) e stesso giorno.
// Token dei temi: --radius-control (0 in Mosca, circa 10 px nel neon) e --surface-control (fondo di
// orari e caselle dei giorni; in Mosca vale --surface); nel neon contrasto calcolato sul caso peggiore
// (fondo con la luce d'ambiente al centro), bordo contro il fondo della casella e contro la pagina. Nessun colore letterale fuori dai temi: già in theme.test.ts.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import type { DayStatus } from '@/lib/availability';
import {
  dayAtScroll,
  firstColumnOffset,
  renderWindow,
  rescaleScroll,
  rowDays,
  rowLayout,
} from '@/lib/booking/when-row';

// ---------------------------------------------------------------------------
// Dati
// ---------------------------------------------------------------------------
/** `YYYY-MM-DD` + n giorni. */
const plusDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const START = '2027-03-02';
const dates = (count: number): string[] => Array.from({ length: count }, (_, i) => plusDays(START, i));

/** Misure di riferimento a 390 px: larghezza utile 358, gap 6 → colonne da 82 (4 visibili). */
const W = 82;
const GAP = 6;
const DAY_GAP = 20;
const VIEWPORT = 358;

const layoutOf = (days: string[], barberCount: number, columnWidth = W) =>
  rowLayout({ days, barberCount, columnWidth, gap: GAP, dayGap: DAY_GAP });

type Layout = ReturnType<typeof rowLayout>;

/** Colonna più a sinistra visibile (la prima con end > scrollLeft), calcolata dal test. */
const leftmostColumn = (layout: Layout, scrollLeft: number) => {
  const column = layout.columns.find((c) => c.end > scrollLeft);
  return column ? { date: column.date, barberIndex: column.barberIndex } : null;
};
const columnOf = (layout: Layout, date: string, barberIndex: number) => {
  const column = layout.columns.find((c) => c.date === date && c.barberIndex === barberIndex);
  if (!column) throw new Error(`colonna ${date}/${barberIndex} assente`);
  return column;
};
/** Giorni con almeno una colonna che interseca (scrollLeft, scrollLeft + viewport). */
const visibleDays = (layout: Layout, scrollLeft: number, viewport: number): string[] => [
  ...new Set(layout.columns.filter((c) => c.end > scrollLeft && c.start < scrollLeft + viewport).map((c) => c.date)),
];

// ---------------------------------------------------------------------------
// rowDays – giorni della fila (SPEC §5.2: chiusi esclusi, "senza posti" inclusi)
// ---------------------------------------------------------------------------
describe('rowDays – giorni della fila (SPEC §5.2, fetta 8f)', () => {
  const d = dates(8);
  const days: DayStatus[] = [
    { date: d[0] ?? '', status: 'closed' }, // oggi dopo l'ultima fascia
    { date: d[1] ?? '', status: 'open' },
    { date: d[2] ?? '', status: 'full' },
    { date: d[3] ?? '', status: 'closed' }, // domenica
    { date: d[4] ?? '', status: 'closed' }, // lunedì
    { date: d[5] ?? '', status: 'open' },
    { date: d[6] ?? '', status: 'full' },
    { date: d[7] ?? '', status: 'closed' },
  ];

  test('salta i chiusi, include i "senza posti", parte dal primo non chiuso anche se oggi è chiuso', () => {
    expect(rowDays(days)).toEqual([d[1], d[2], d[5], d[6]]);
  });

  test("finisce all'ultimo giorno non chiuso del periodo (anche se è l'ultimo della striscia)", () => {
    const last: DayStatus[] = [...days.slice(0, 7), { date: d[7] ?? '', status: 'open' }];
    expect(rowDays(last)).toEqual([d[1], d[2], d[5], d[6], d[7]]);
  });

  test('tutti chiusi → fila vuota', () => {
    expect(rowDays(d.map((date) => ({ date, status: 'closed' as const })))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rowLayout / firstColumnOffset – posizioni di giorni e colonne
// ---------------------------------------------------------------------------
describe('rowLayout e firstColumnOffset – colonne contigue per giorno, spazio-giorno più largo (fetta 8f)', () => {
  for (const barberCount of [1, 4, 5]) {
    test(`${barberCount} barbier${barberCount === 1 ? 'e' : 'i'} per giorno, 3 giorni`, () => {
      const days = dates(3);
      const layout = layoutOf(days, barberCount);
      const dayWidth = barberCount * W + (barberCount - 1) * GAP;

      // Per ogni giorno le colonne dei barbieri nell'ordine, poi il giorno dopo
      expect(layout.columns.map((c) => [c.date, c.barberIndex])).toEqual(
        days.flatMap((date) => Array.from({ length: barberCount }, (_, i) => [date, i])),
      );
      layout.columns.forEach((column, i) => {
        expect(column.end - column.start, 'larghezza della colonna').toBe(W);
        const previous = layout.columns[i - 1];
        if (!previous) return expect(column.start, 'la prima colonna parte da 0').toBe(0);
        const space = column.start - previous.end;
        // Dentro lo stesso giorno il gap normale, fra due giorni lo spazio-giorno (più largo)
        expect(space).toBe(previous.date === column.date ? GAP : DAY_GAP);
      });
      expect(layout.width).toBe(3 * dayWidth + 2 * DAY_GAP);

      expect(firstColumnOffset(layout, days[0] ?? ''), 'primo giorno').toBe(0);
      expect(firstColumnOffset(layout, days[1] ?? '')).toBe(dayWidth + DAY_GAP);
      expect(firstColumnOffset(layout, days[2] ?? '')).toBe(2 * (dayWidth + DAY_GAP));
    });
  }

  test('con 4 barbieri a 390 px: secondo giorno a 4·82 + 3·6 + 20 = 366', () => {
    const days = dates(2);
    expect(firstColumnOffset(layoutOf(days, 4), days[1] ?? '')).toBe(366);
  });
});

// ---------------------------------------------------------------------------
// dayAtScroll – giorno selezionato = giorno della colonna più a sinistra visibile
// ---------------------------------------------------------------------------
describe('dayAtScroll – giorno della colonna più a sinistra visibile, margine di 16 px escluso (fetta 8f)', () => {
  for (const barberCount of [4, 5]) {
    describe(`${barberCount} barbieri`, () => {
      const days = dates(4);
      const [d0 = '', d1 = '', , d3 = ''] = days;
      const layout = layoutOf(days, barberCount);
      const lastOfD0 = columnOf(layout, d0, barberCount - 1);

      test('resta sul giorno finché anche 1 px di una sua colonna è oltre scrollLeft', () => {
        expect(dayAtScroll(layout, firstColumnOffset(layout, d0))).toBe(d0);
        expect(dayAtScroll(layout, lastOfD0.start)).toBe(d0);
        expect(dayAtScroll(layout, lastOfD0.end - 1)).toBe(d0);
      });

      test("cambia quando esce l'ultima colonna del giorno (anche dentro lo spazio-giorno)", () => {
        expect(dayAtScroll(layout, lastOfD0.end)).toBe(d1);
        expect(dayAtScroll(layout, lastOfD0.end + DAY_GAP / 2)).toBe(d1);
      });

      test('tornando indietro torna al giorno prima appena una sua colonna rientra, anche di 1 px', () => {
        const before = firstColumnOffset(layout, d1);
        expect(dayAtScroll(layout, before)).toBe(d1);
        expect(dayAtScroll(layout, lastOfD0.end - 1)).toBe(d0);
      });

      test("a scrollLeft = firstColumnOffset(d) il giorno è d: la colonna che finisce prima del bordo non conta", () => {
        for (const date of days) expect(dayAtScroll(layout, firstColumnOffset(layout, date))).toBe(date);
      });

      test('limiti: 0 (o meno) → primo giorno; oltre la fine → ultimo giorno', () => {
        expect(dayAtScroll(layout, 0)).toBe(d0);
        expect(dayAtScroll(layout, -40)).toBe(d0);
        expect(dayAtScroll(layout, layout.width - 1)).toBe(d3);
        expect(dayAtScroll(layout, layout.width + 1000)).toBe(d3);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// renderWindow – si disegnano solo i giorni vicini alla zona visibile
// ---------------------------------------------------------------------------
describe('renderWindow – giorni visibili più un viewport per lato (fetta 8f)', () => {
  const days = dates(30);
  const four = layoutOf(days, 4);

  const expectWellFormed = (window: string[]) => {
    expect(window.every((date) => days.includes(date)), 'solo giorni della fila').toBe(true);
    expect([...window].sort(), 'nell\'ordine, senza doppioni').toEqual([...new Set(window)]);
  };

  test('contiene sempre i giorni visibili (all\'inizio, a metà di un giorno, nello spazio-giorno, alla fine)', () => {
    const positions = [
      0,
      firstColumnOffset(four, days[10] ?? ''),
      firstColumnOffset(four, days[10] ?? '') + 2 * (W + GAP) + 40,
      columnOf(four, days[12] ?? '', 3).end + 5,
      four.width - VIEWPORT,
    ];
    for (const scrollLeft of positions) {
      const window = renderWindow(four, scrollLeft, VIEWPORT);
      expectWellFormed(window);
      for (const date of visibleDays(four, scrollLeft, VIEWPORT)) {
        expect(window, `giorno visibile ${date} a scrollLeft ${scrollLeft}`).toContain(date);
      }
    }
  });

  test('con 30 giorni non li disegna tutti: i giorni lontani restano segnaposto', () => {
    const scrollLeft = firstColumnOffset(four, days[10] ?? '');
    const window = renderWindow(four, scrollLeft, VIEWPORT);
    expect(window.length).toBeLessThan(days.length);
    expect(window).not.toContain(days[0]);
    expect(window).not.toContain(days[29]);
  });

  test('contiene il giorno iniziale (fila portata sul giorno all\'apertura)', () => {
    for (const index of [0, 7, 29]) {
      const initial = days[index] ?? '';
      expect(renderWindow(four, Math.min(firstColumnOffset(four, initial), four.width - VIEWPORT), VIEWPORT)).toContain(initial);
    }
  });

  test('con 1 barbiere per giorno la stessa finestra contiene più giorni', () => {
    const one = layoutOf(days, 1);
    const date = days[10] ?? '';
    const withOne = renderWindow(one, firstColumnOffset(one, date), VIEWPORT);
    const withFour = renderWindow(four, firstColumnOffset(four, date), VIEWPORT);
    expectWellFormed(withOne);
    expect(withOne.length).toBeGreaterThan(withFour.length);
  });
});

// ---------------------------------------------------------------------------
// rescaleScroll – ridimensionamento (rotazione, finestra, zoom del testo)
// ---------------------------------------------------------------------------
describe('rescaleScroll – stessa colonna più a sinistra visibile e stesso giorno dopo il ridimensionamento (fetta 8f)', () => {
  const days = dates(10);
  const narrow = layoutOf(days, 4, 82);
  const wide = layoutOf(days, 4, 140);

  const expectSameColumn = (from: Layout, to: Layout, scrollLeft: number) => {
    const next = rescaleScroll(from, to, scrollLeft);
    expect(leftmostColumn(to, next), `colonna più a sinistra (scrollLeft ${scrollLeft} → ${next})`).toEqual(
      leftmostColumn(from, scrollLeft),
    );
    expect(dayAtScroll(to, next), 'giorno selezionato').toBe(dayAtScroll(from, scrollLeft));
    return next;
  };

  test('a metà di una colonna: 82 → 140 e ritorno, stessa colonna e stesso giorno', () => {
    const column = columnOf(narrow, days[3] ?? '', 2);
    const scrollLeft = column.start + 30;
    const widened = expectSameColumn(narrow, wide, scrollLeft);
    expectSameColumn(wide, narrow, widened);
  });

  test("con 1 px dell'ultima colonna di un giorno ancora visibile il giorno non cambia", () => {
    const last = columnOf(narrow, days[4] ?? '', 3);
    const widened = expectSameColumn(narrow, wide, last.end - 1);
    expectSameColumn(wide, narrow, widened);
  });

  test('nello spazio-giorno: resta la prima colonna del giorno dopo', () => {
    expectSameColumn(narrow, wide, columnOf(narrow, days[5] ?? '', 3).end + DAY_GAP / 2);
  });

  test('allineata al bordo resta allineata (prima colonna di un giorno e colonna interna)', () => {
    const date = days[6] ?? '';
    expect(rescaleScroll(narrow, wide, firstColumnOffset(narrow, date))).toBeCloseTo(firstColumnOffset(wide, date), 0);
    expect(rescaleScroll(wide, narrow, firstColumnOffset(wide, date))).toBeCloseTo(firstColumnOffset(narrow, date), 0);
    const inner = columnOf(narrow, date, 2);
    expect(rescaleScroll(narrow, wide, inner.start)).toBeCloseTo(columnOf(wide, date, 2).start, 0);
    expect(rescaleScroll(narrow, wide, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Token dei temi: caselle arrotondate e fondo dei controlli (docs/DESIGN.md, fetta 8f)
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const themeCss = (theme: string): string => readFileSync(resolve(ROOT, 'src', 'themes', theme, 'theme.css'), 'utf8');

/** Dichiarazioni `--nome: valore` del primo blocco `:root { … }` (commenti esclusi). */
const rootTokens = (css: string): Record<string, string> => {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = clean.indexOf(':root');
  if (start < 0) throw new Error('blocco :root assente');
  const open = clean.indexOf('{', start);
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

/** Valore di un token con i riferimenti var(--x) risolti. */
const token = (tokens: Record<string, string>, name: string, seen: string[] = []): string => {
  const value = tokens[name];
  if (value === undefined) throw new Error(`token ${name} non dichiarato`);
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value);
  if (!ref?.[1]) return value;
  if (seen.includes(ref[1])) throw new Error(`riferimento circolare: ${[...seen, ref[1]].join(' → ')}`);
  return token(tokens, ref[1], [...seen, name]);
};

/** Lunghezza in px: 0, Npx, Nrem (16 px). */
const px = (value: string): number => {
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim());
  if (!m) throw new Error(`lunghezza non riconosciuta: ${value}`);
  const n = Number(m[1]);
  if (!m[2] && n !== 0) throw new Error(`lunghezza senza unità: ${value}`);
  return m[2] === 'rem' ? n * 16 : n;
};

type Rgba = { r: number; g: number; b: number; a: number };
const hex = (value: string): Rgba => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!m?.[1]) throw new Error(`colore atteso #rrggbb o #rrggbbaa: ${value}`);
  const n = (i: number) => parseInt(m[1]?.slice(i, i + 2) ?? '0', 16);
  return { r: n(0), g: n(2), b: n(4), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
};
/** `top` (con la sua opacità, moltiplicata per `opacity`) composto su un fondo opaco. */
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

describe('Token: caselle arrotondate (--radius-control) e fondo dei controlli (--surface-control) – fetta 8f', () => {
  test('Mosca: --radius-control vale 0 (angoli vivi, docs/DESIGN.md)', () => {
    expect(px(token(MOSCA, '--radius-control'))).toBe(0);
  });

  test('Mosca neon: --radius-control maggiore di 0, circa 10 px', () => {
    const radius = px(token(NEON, '--radius-control'));
    expect(radius).toBeGreaterThanOrEqual(8);
    expect(radius).toBeLessThanOrEqual(12);
  });

  test('ogni tema dichiara --surface-control; in Mosca vale --surface (decisione dell\'utente, 2026-10-25)', () => {
    expect(token(MOSCA, '--surface-control').toLowerCase()).toBe(token(MOSCA, '--surface').toLowerCase());
    expect(() => token(NEON, '--surface-control')).not.toThrow();
  });

  test('Mosca neon, caso peggiore (fondo con la luce d\'ambiente al centro): testo ≥ 4,5:1 e bordo a riposo ≥ 3:1', () => {
    const surface = hex(token(NEON, '--surface'));
    const ambient = hex(token(NEON, '--ambient-color'));
    const ambientOpacity = Number(token(NEON, '--ambient-opacity'));
    expect(Number.isFinite(ambientOpacity) && ambientOpacity > 0, '--ambient-opacity numerico').toBe(true);

    const lit = over(ambient, surface, ambientOpacity);
    const control = over(hex(token(NEON, '--surface-control')), lit);
    const ink = hex(token(NEON, '--ink'));
    const rest = over(hex(token(NEON, '--ink-control-rest')), lit);

    expect(contrast(ink, control), 'testo (--ink) sulla casella').toBeGreaterThanOrEqual(4.5);
    expect(contrast(rest, control), 'bordo a riposo contro il fondo della casella').toBeGreaterThanOrEqual(3);
    expect(contrast(rest, lit), 'bordo a riposo contro il fondo della pagina').toBeGreaterThanOrEqual(3);
  });
});
