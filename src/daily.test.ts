import { describe, expect, it } from 'vitest';
import { DAILY_EPOCH, dailyDifficulty, dailyGameId, dailyNumber, dailyTargets, hashDateKey } from './daily';
import { GAMES, cellKey, cellRating } from './data';
import type { AreaCell, GameData } from './types';

/** Minimal GameData (same shape data.test.ts uses) with every rating present,
 *  so any weekday band has cells to draw from. */
function makeData(): GameData {
  const cells: AreaCell[] = Array.from({ length: 100 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), k: 'room' as const, w: 0 }));
  const cellDifficulty: Record<string, number> = {};
  cells.forEach((c, i) => {
    cellDifficulty[cellKey('zebes', c)] = (i % 5) + 1; // ratings 1..5, 20 cells each
  });
  return {
    game: 'test',
    title: 'Test',
    cellSize: 8,
    guessMapCellPx: 8,
    areas: [{ id: 'zebes', name: 'Zebes', cols: 10, rows: 10, mapImage: '', cells, map: { cols: 10, rows: 10, dx: 0, dy: 0, glyphs: [], bands: [], connectors: [], source: 'fallback' } }],
    cellDifficulty
  };
}

describe('dailyNumber', () => {
  it('starts at #1 on the epoch', () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
  });

  it('increments daily, across month and year boundaries', () => {
    expect(dailyNumber('2026-07-23')).toBe(2);
    expect(dailyNumber('2026-08-01')).toBe(11);
    expect(dailyNumber('2027-07-22')).toBe(366); // 2026→2027 spans no leap day
  });
});

describe('hashDateKey', () => {
  it('is stable (regression pins the whole daily schedule)', () => {
    // If these change, every past and future daily changes with them.
    expect(hashDateKey('2026-07-22')).toBe(1066931798);
    expect(hashDateKey('2026-07-23')).toBe(1083709417);
  });

  it('differs day to day', () => {
    expect(hashDateKey('2026-07-22')).not.toBe(hashDateKey('2026-07-23'));
    expect(hashDateKey('2026-12-01')).not.toBe(hashDateKey('2026-01-12'));
  });
});

describe('dailyGameId', () => {
  it('always resolves to an available game, deterministically', () => {
    const avail = new Set(GAMES.filter((g) => g.available).map((g) => g.id));
    for (const key of ['2026-07-22', '2026-07-23', '2026-07-24', '2026-08-15', '2027-01-01']) {
      const id = dailyGameId(key);
      expect(avail.has(id)).toBe(true);
      expect(dailyGameId(key)).toBe(id);
    }
  });

  it('rotates between games over a stretch of days', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) seen.add(dailyGameId(`2026-08-${String(d).padStart(2, '0')}`));
    expect(seen.size).toBeGreaterThan(1); // 28 days of one game would mean a broken hash
  });
});

describe('dailyDifficulty (weekday ramp)', () => {
  it('maps a known week: Mon–Tue tallon, Wed–Fri brinstar, Sat–Sun sanctuary', () => {
    // 2026-07-20 is a Monday.
    const week = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
    expect(week.map((k) => dailyDifficulty(k).id)).toEqual(['tallon', 'tallon', 'brinstar', 'brinstar', 'brinstar', 'sanctuary', 'sanctuary']);
  });
});

describe('dailyTargets', () => {
  it('is deterministic for a key and differs between keys', () => {
    const data = makeData();
    const a1 = dailyTargets(data, '2026-07-22');
    const a2 = dailyTargets(data, '2026-07-22');
    expect(a1).toEqual(a2);
    expect(a1).toHaveLength(5);
    const b = dailyTargets(data, '2026-07-23');
    expect(b).not.toEqual(a1);
  });

  it("draws from the weekday's band", () => {
    const data = makeData();
    // 2026-07-25 is a Saturday → sanctuary (ratings 4–5).
    for (const t of dailyTargets(data, '2026-07-25')) {
      expect(cellRating(data, t.areaId, t.cell)).toBeGreaterThanOrEqual(4);
    }
    // 2026-07-20 is a Monday → tallon (ratings 1–2).
    for (const t of dailyTargets(data, '2026-07-20')) {
      expect(cellRating(data, t.areaId, t.cell)).toBeLessThanOrEqual(2);
    }
  });
});
