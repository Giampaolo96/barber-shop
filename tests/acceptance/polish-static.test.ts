// Test di accettazione – FETTA 8b (rifinitura estetica), controlli statici sui sorgenti di src/.
// Le regole vengono dalle decisioni approvate per la fetta 8b ("8b: ...") e da CLAUDE.md
// (regola 5: logica pura; Sicurezza: requireRole in ogni route handler, mai la service role nel
// percorso del cliente) e docs/DESIGN.md (movimento, niente mosca nell'area staff).
//
// Interfacce attese:
//   src/app/(customer)/prenotazioni/[id]/calendario.ics/route.ts   export GET, requireRole(["customer"]),
//     lettura via RLS con il client della richiesta, UID con calendarUidHost del tema (non l'host
//     della richiesta), corpo da buildBookingIcs di src/lib/booking/ics.ts
//   src/app/(customer)/prenotazioni/[id]/confermata/page.tsx       pagina di conferma, senza service role
//   src/lib/booking/actions.ts   createBooking porta a confirmationPath(id) (non più ?esito=confermata)
//   src/lib/booking/countdown.ts, ics.ts, src/lib/calendar/now-line.ts   funzioni pure
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const walk = (dir: string): string[] => {
  const absolute = resolve(ROOT, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const rel = relative(ROOT, join(absolute, entry.name)).replace(/\\/g, '/');
    return entry.isDirectory() ? walk(rel) : [rel];
  });
};

const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Sorgente senza commenti; il test fallisce con un messaggio chiaro se il file manca. */
const source = (path: string): string => {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `file mancante: ${path}`).toBe(true);
  return stripComments(readFileSync(absolute, 'utf8'));
};

const ICS_ROUTE = 'src/app/(customer)/prenotazioni/[id]/calendario.ics/route.ts';
const CONFIRMATION_PAGE = 'src/app/(customer)/prenotazioni/[id]/confermata/page.tsx';
const CUSTOMER_ONLY = /\brequireRole\s*\(\s*\[\s*['"]customer['"]\s*,?\s*\]\s*\)/;
const SERVICE_ROLE = /@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/;

// ---------------------------------------------------------------------------
// Route del file .ics – 8b, CLAUDE.md Sicurezza
// ---------------------------------------------------------------------------
describe('route GET del file .ics (8b; CLAUDE.md Sicurezza)', () => {
  test('esporta GET e chiama requireRole(["customer"])', () => {
    const code = source(ICS_ROUTE);
    expect(code).toMatch(/export\s+(?:async\s+)?(?:function\s+GET\b|const\s+GET\b)/);
    expect(code).toMatch(CUSTOMER_ONLY);
  });

  test('nessuna service role: lettura via RLS con il client della richiesta', () => {
    expect(source(ICS_ROUTE)).not.toMatch(SERVICE_ROLE);
  });

  test('corpo da buildBookingIcs e host dell\'UID da calendarUidHost del tema, non dalla richiesta', () => {
    const code = source(ICS_ROUTE);
    expect(code).toMatch(/\bbuildBookingIcs\s*\(/);
    expect(code).toMatch(/\bcalendarUidHost\b/);
    expect(code).toMatch(/from\s+['"]@\/themes\/active['"]/);
    // Niente host, origin o header della richiesta: l'UID non deve dipendere dal dominio dell'app
    expect(code).not.toMatch(/\bheaders\s*\(|\.host\b|\.hostname\b|\.origin\b|['"]host['"]|x-forwarded-host/i);
  });
});

// ---------------------------------------------------------------------------
// Pagina di conferma – 8b
// ---------------------------------------------------------------------------
describe('pagina di conferma (8b; CLAUDE.md Sicurezza)', () => {
  test('esiste, controlla il ruolo e non usa la service role', () => {
    const code = source(CONFIRMATION_PAGE);
    expect(code).toMatch(/\brequireRole\s*\(|\bloadBookingPageContext\s*\(/);
    expect(code).not.toMatch(SERVICE_ROLE);
  });

  test('dopo "Conferma prenotazione" createBooking porta a confirmationPath, non più a ?esito=confermata', () => {
    const code = source('src/lib/booking/actions.ts');
    expect(code).toMatch(/\bconfirmationPath\s*\(/);
    expect(code).not.toMatch(/esito=confermata/);
  });
});

// ---------------------------------------------------------------------------
// Logica pura – CLAUDE.md regola 5
// ---------------------------------------------------------------------------
describe('logica pura della fetta 8b (CLAUDE.md regole 2 e 5)', () => {
  test.each(['src/lib/booking/countdown.ts', 'src/lib/booking/ics.ts', 'src/lib/calendar/now-line.ts'])(
    '%s: niente database, server, rete né orologio di sistema',
    (path) => {
      const code = source(path);
      expect(code).not.toMatch(/from\s+['"](?:@\/lib\/db[^'"]*|server-only|next\/[^'"]*|@supabase\/[^'"]*)['"]/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\bDate\.now\s*\(/);
      expect(code).not.toMatch(/new\s+Date\s*\(\s*\)/);
    },
  );

  test('countdown.ts prende i testi da src/i18n/it.ts (SPEC §9)', () => {
    expect(source('src/lib/booking/countdown.ts')).toMatch(/from\s+['"]@\/i18n\/it['"]/);
  });
});

// ---------------------------------------------------------------------------
// Movimento – 8b, docs/DESIGN.md
// ---------------------------------------------------------------------------
const STYLE_FILES = [
  ...walk('src/themes').filter((file) => /^src\/themes\/[^/]+\/theme\.css$/.test(file)),
  'src/app/globals.css',
  ...walk('src/styles').filter((file) => file.endsWith('.css')),
];

/** Testo CSS senza commenti. */
const css = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Dichiarazioni `animation`/`animation-name` fuori da un blocco
 * `@media (prefers-reduced-motion: no-preference)` (le @keyframes non contano: non animano nulla).
 */
const animationsOutsideNoPreference = (code: string): string[] => {
  const offenders: string[] = [];
  const stack: Array<'motion' | 'keyframes' | 'other'> = [];
  let selector = '';
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (char === '{') {
      const head = selector.trim();
      stack.push(
        /^@media[^{]*prefers-reduced-motion\s*:\s*no-preference/i.test(head)
          ? 'motion'
          : /^@(?:-\w+-)?keyframes\b/i.test(head)
            ? 'keyframes'
            : 'other',
      );
      selector = '';
    } else if (char === '}') {
      stack.pop();
      selector = '';
    } else if (char === ';') {
      const declaration = selector.trim();
      if (/^animation(?:-name)?\s*:/i.test(declaration) && !/^animation(?:-name)?\s*:\s*none\b/i.test(declaration)) {
        if (!stack.includes('motion') && !stack.includes('keyframes')) offenders.push(declaration);
      }
      selector = '';
    } else {
      selector += char;
    }
  }
  return offenders;
};

describe('movimento solo CSS, dentro prefers-reduced-motion: no-preference (8b; docs/DESIGN.md)', () => {
  test('i file di stile da controllare esistono', () => {
    expect(STYLE_FILES).toContain('src/app/globals.css');
    expect(STYLE_FILES.some((file) => file.startsWith('src/themes/'))).toBe(true);
  });

  test.each(STYLE_FILES)('%s: nessuna animazione infinita', (path) => {
    expect(css(path)).not.toMatch(/\binfinite\b/i);
  });

  test.each(STYLE_FILES)('%s: ogni animazione sta dentro @media (prefers-reduced-motion: no-preference)', (path) => {
    expect(animationsOutsideNoPreference(css(path))).toEqual([]);
  });

  test('nessuna classe Tailwind di animazione infinita né "infinite" negli stili in linea dei componenti', () => {
    const offenders = walk('src')
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .flatMap((file) =>
        stripComments(readFileSync(resolve(ROOT, file), 'utf8'))
          .split(/\r?\n/)
          .flatMap((line, index) =>
            /\banimate-(?:spin|ping|pulse|bounce)\b|\binfinite\b/.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Area staff senza mosca – 8b stati vuoti, docs/DESIGN.md ("Nell'area staff niente marmo né mosca")
// ---------------------------------------------------------------------------
describe('area staff senza marmo né mosca (8b; docs/DESIGN.md)', () => {
  test('nessun file di src/app/admin o src/components/admin importa dal tema o usa data-testid="fly"', () => {
    const files = [...walk('src/app/admin'), ...walk('src/components/admin')].filter((file) => /\.(?:ts|tsx)$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => {
      const code = stripComments(readFileSync(resolve(ROOT, file), 'utf8'));
      return /from\s+['"](?:@\/themes\/[^'"]*|(?:\.\.\/)+themes\/[^'"]*)['"]|data-testid=["']fly["']/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
