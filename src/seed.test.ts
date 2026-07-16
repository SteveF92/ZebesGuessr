import { describe, expect, it } from 'vitest';
import { MAX_CELL_INDEX, SEED_LENGTH, decodeSeed, encodeSeed, mulberry32 } from './seed';
import { pickTargets, cellKey } from './data';
import { getDifficulty } from './scoring';
import type { Cell, GameData } from './types';

describe('encodeSeed / decodeSeed', () => {
  it('round-trips game, difficulty, and the five tile indices', () => {
    const cases = [
      { gameIndex: 0, diffIndex: 0, indices: [0, 0, 0, 0, 0] },
      { gameIndex: 2, diffIndex: 1, indices: [1, 22, 333, 1226, 7] },
      { gameIndex: 7, diffIndex: 7, indices: [MAX_CELL_INDEX, 0, MAX_CELL_INDEX, 0, MAX_CELL_INDEX] } // max fields
    ];
    for (const c of cases) {
      expect(decodeSeed(encodeSeed(c))).toEqual(c);
    }
  });

  it('produces a 12-char, url-safe code', () => {
    const code = encodeSeed({ gameIndex: 0, diffIndex: 1, indices: [12, 345, 678, 9, 1024] });
    expect(code).toHaveLength(SEED_LENGTH);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for malformed codes', () => {
    expect(decodeSeed('')).toBeNull();
    expect(decodeSeed('abc')).toBeNull(); // too short
    expect(decodeSeed('abcdefghijklm')).toBeNull(); // too long (13)
    expect(decodeSeed('abc!!!ghijkl')).toBeNull(); // bad char
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

/** Minimal GameData with only the fields pickTargets touches. */
function makeData(areas: Record<string, Cell[]>): GameData {
  return {
    game: 'test',
    title: 'Test',
    cellSize: 8,
    guessMapCellPx: 8,
    areas: Object.entries(areas).map(([id, cells]) => ({
      id,
      name: id,
      cols: 10,
      rows: 10,
      mapImage: '',
      cells,
      map: { cols: 10, rows: 10, dx: 0, dy: 0, cells: [], glyphs: [], bands: [], connectors: [], source: 'fallback' }
    }))
  };
}

const grid = (w: number, h: number): Cell[] => Array.from({ length: w * h }, (_, i) => ({ x: i % w, y: Math.floor(i / w) }));

describe('pickTargets with a seeded rng is reproducible', () => {
  const data = makeData({ brinstar: grid(8, 8), norfair: grid(6, 6) });
  const keys = (s: number) => pickTargets(data, 5, getDifficulty('brinstar'), mulberry32(s)).map((t) => cellKey(t.areaId, t.cell));

  it('yields identical targets for the same seed', () => {
    expect(keys(777)).toEqual(keys(777));
  });

  it('yields different targets for a different seed', () => {
    expect(keys(777)).not.toEqual(keys(778));
  });
});
