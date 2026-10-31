// Date degli e2e (tests/e2e/test-date.ts): deterministiche, d'inverno, e due test non ne condividono una.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { claimDate, winterWednesday } from '../e2e/test-date';

describe('winterWednesday', () => {
  test('la stessa chiave dà sempre la stessa data, chiavi diverse date diverse', () => {
    expect(winterWednesday('a.spec.ts › uno')).toBe(winterWednesday('a.spec.ts › uno'));
    expect(winterWednesday('a.spec.ts › uno')).not.toBe(winterWednesday('a.spec.ts › due'));
  });

  test('è sempre un mercoledì di gennaio o febbraio, anche con gli altri giorni della settimana', () => {
    for (let i = 0; i < 2000; i += 1) {
      const date = winterWednesday(`chiave ${i}`);
      const day = new Date(`${date}T12:00:00Z`);
      expect(day.getUTCDay()).toBe(3);
      expect(day.getUTCMonth()).toBeLessThanOrEqual(1);
      const sunday = new Date(day.getTime() + 4 * 86_400_000);
      expect(sunday.getUTCMonth()).toBeLessThanOrEqual(2);
      expect(sunday.getUTCDate() <= 7 || sunday.getUTCMonth() < 2).toBe(true);
    }
  });

  test('resta dentro gli anni chiesti', () => {
    for (let i = 0; i < 500; i += 1) {
      const year = Number(winterWednesday(`chiave ${i}`, { fromYear: 2012, toYear: 2021 }).slice(0, 4));
      expect(year).toBeGreaterThanOrEqual(2012);
      expect(year).toBeLessThanOrEqual(2021);
    }
  });
});

describe('claimDate', () => {
  const dirs: string[] = [];
  const claims = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'date-claims-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('lo stesso test può riprendere la sua data', () => {
    const dir = claims();
    claimDate('2100-01-06', 'primo', dir);
    expect(() => claimDate('2100-01-06', 'primo', dir)).not.toThrow();
  });

  test('due test diversi sulla stessa data: errore con i due nomi', () => {
    const dir = claims();
    claimDate('2100-01-06', 'primo', dir);
    expect(() => claimDate('2100-01-06', 'secondo', dir)).toThrow(/primo.*secondo/);
  });
});
