import { describe, expect, it } from 'vitest';
import { cellKey, cellPool, cellRating, deriveDifficultyIndex, indicesFromTargets, pickTargets, targetsFromIndices } from './data';
import { decodeSeed, encodeSeed } from './seed';
import { DEFAULT_RATING, DIFFICULTIES, getDifficulty } from './scoring';
import type { AreaCell, GameData } from './types';

/** Minimal GameData with only the fields pickTargets touches. */
function makeData(areas: Record<string, AreaCell[]>, cellDifficulty?: Record<string, number>): GameData {
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
      map: { cols: 10, rows: 10, dx: 0, dy: 0, glyphs: [], bands: [], connectors: [], source: 'fallback' }
    })),
    cellDifficulty
  };
}

/** A block of charted cells — pickTargets only serves cells the map draws. */
const grid = (w: number, h: number): AreaCell[] => Array.from({ length: w * h }, (_, i) => ({ x: i % w, y: Math.floor(i / w), k: 'room' as const, w: 0 }));

describe('pickTargets', () => {
  it('returns n distinct targets', () => {
    const data = makeData({ brinstar: grid(5, 5), norfair: grid(4, 4) });
    const targets = pickTargets(data, 10);
    expect(targets).toHaveLength(10);
    const keys = targets.map((t) => cellKey(t.areaId, t.cell));
    expect(new Set(keys).size).toBe(10);
  });

  it('returns the whole pool when it is smaller than n', () => {
    const data = makeData({ crateria: grid(2, 2) });
    const targets = pickTargets(data, 10);
    expect(targets).toHaveLength(4);
    const keys = targets.map((t) => cellKey(t.areaId, t.cell));
    expect(new Set(keys).size).toBe(4);
  });

  it('only picks cells that exist in the named area', () => {
    const data = makeData({
      brinstar: [
        { x: 0, y: 0, k: 'room', w: 0 },
        { x: 1, y: 0, k: 'room', w: 0 }
      ],
      norfair: [{ x: 5, y: 5, k: 'room', w: 0 }]
    });
    const valid = new Set(data.areas.flatMap((a) => a.cells.map((c) => cellKey(a.id, c))));
    for (const t of pickTargets(data, 3)) {
      expect(valid.has(cellKey(t.areaId, t.cell))).toBe(true);
    }
  });

  it('returns an empty array when there are no cells', () => {
    expect(pickTargets(makeData({}), 5)).toEqual([]);
  });

  it("never serves cells rated outside the tier's band", () => {
    // 25 cells: ten rated 1 and ten rated 2 fill tallon's band (1–2); two
    // rated 5 and three unrated (default 3) sit outside it.
    const cells = grid(5, 5);
    const ratings: Record<string, number> = {};
    cells.forEach((c, i) => {
      if (i < 10) ratings[cellKey('brinstar', c)] = 1;
      else if (i < 20) ratings[cellKey('brinstar', c)] = 2;
      else if (i < 22) ratings[cellKey('brinstar', c)] = 5;
    });
    const data = makeData({ brinstar: cells }, ratings);
    const tallon = getDifficulty('tallon');
    for (let i = 0; i < 50; i++) {
      for (const t of pickTargets(data, 5, tallon)) {
        const r = cellRating(data, t.areaId, t.cell);
        expect(r).toBeGreaterThanOrEqual(tallon.min);
        expect(r).toBeLessThanOrEqual(tallon.max);
      }
    }
  });

  it('draws from everything when no difficulty is given', () => {
    const data = makeData({ brinstar: grid(2, 2) }, { 'brinstar:0,0': 5 });
    expect(pickTargets(data, 4)).toHaveLength(4);
  });

  it('two-step draw reaches a rare high rating about as often as a common one', () => {
    // Sanctuary band is 4–5. Rating 4 has 100 cells, rating 5 has only 4.
    // Uniform sampling would almost never serve a 5; two-step should serve
    // rating 4 and rating 5 at roughly equal rates because it picks the level
    // first.
    const cells = grid(11, 11).slice(0, 104); // 104 cells
    const ratings: Record<string, number> = {};
    cells.forEach((c, i) => (ratings[cellKey('norfair', c)] = i < 4 ? 5 : 4));
    const data = makeData({ norfair: cells }, ratings);
    const sanctuary = getDifficulty('sanctuary');

    let fives = 0;
    let fours = 0;
    for (let i = 0; i < 400; i++) {
      for (const t of pickTargets(data, 1, sanctuary)) {
        const r = cellRating(data, t.areaId, t.cell);
        if (r === 5) fives++;
        else if (r === 4) fours++;
      }
    }
    // Roughly 50/50 despite the 25:1 pool imbalance — well clear of the ~4%
    // a uniform draw would give the fives.
    expect(fives).toBeGreaterThan(fours * 0.5);
  });

  it('falls back to the full pool when the band leaves fewer than n cells', () => {
    // Every cell rated 5 — tallon's band (1–2) is empty, so all cells stay in play.
    const cells = grid(3, 3);
    const ratings = Object.fromEntries(cells.map((c) => [cellKey('norfair', c), 5]));
    const data = makeData({ norfair: cells }, ratings);
    expect(pickTargets(data, 5, getDifficulty('tallon'))).toHaveLength(5);
  });
});

describe('pickTargets rating-6 exclusion', () => {
  it('never serves rating-6 cells on any tier', () => {
    const data = makeData({ brinstar: grid(4, 4) }, { 'brinstar:0,0': 6, 'brinstar:1,0': 6 });
    for (const id of ['tallon', 'brinstar', 'sanctuary']) {
      for (let i = 0; i < 30; i++) {
        for (const t of pickTargets(data, 5, getDifficulty(id))) {
          expect(cellRating(data, t.areaId, t.cell)).toBeLessThan(6);
        }
      }
    }
  });

  it('keeps rating-6 cells out of the small-pool fallback', () => {
    // All cells rated 5 except one rated 6: tallon's band (1–2) is empty, so
    // the fallback pool kicks in — and must still exclude the 6.
    const cells = grid(3, 3);
    const ratings = Object.fromEntries(cells.map((c) => [cellKey('norfair', c), 5]));
    ratings['norfair:0,0'] = 6;
    const data = makeData({ norfair: cells }, ratings);
    for (let i = 0; i < 30; i++) {
      const targets = pickTargets(data, 8, getDifficulty('tallon'));
      expect(targets).toHaveLength(8);
      for (const t of targets) {
        expect(cellRating(data, t.areaId, t.cell)).toBeLessThan(6);
      }
    }
  });

  it('excludes rating-6 cells even with no difficulty given', () => {
    const data = makeData({ brinstar: grid(2, 2) }, { 'brinstar:0,0': 6 });
    const targets = pickTargets(data, 4);
    expect(targets).toHaveLength(3);
    for (const t of targets) {
      expect(cellKey(t.areaId, t.cell)).not.toBe('brinstar:0,0');
    }
  });
});

describe('pickTargets uncharted exclusion', () => {
  // A cell with no draw data (an elevator shaft, a tube run, a screen the
  // pause map simply doesn't chart) has a tile but nothing drawn on the map,
  // so GuessMap won't let a click land on it — serving one would be an
  // unwinnable round.
  const withShaft = () => {
    const cells: AreaCell[] = grid(3, 3);
    cells.push({ x: 3, y: 0 }, { x: 3, y: 1 });
    return cells;
  };

  it('never serves a cell with no draw data', () => {
    const data = makeData({ norfair: withShaft() });
    const uncharted = new Set(['norfair:3,0', 'norfair:3,1']);
    for (const id of ['tallon', 'brinstar', 'sanctuary']) {
      for (let i = 0; i < 30; i++) {
        for (const t of pickTargets(data, 5, getDifficulty(id))) {
          expect(uncharted.has(cellKey(t.areaId, t.cell))).toBe(false);
        }
      }
    }
  });

  it('leaves uncharted cells out of the pool entirely, unrated or not', () => {
    const data = makeData({ norfair: withShaft() });
    const targets = pickTargets(data, 11);
    expect(targets).toHaveLength(9); // the 3x3 charted block, not the 2 shaft cells
  });

  it('still counts uncharted cells in cellPool, so seed indices stay stable', () => {
    const data = makeData({ norfair: withShaft() });
    expect(cellPool(data)).toHaveLength(11);
  });
});

describe('cell pool / seed index round-trip', () => {
  const data = makeData({ crateria: grid(6, 6), brinstar: grid(5, 4), norfair: grid(7, 3) });

  it('cellPool flattens areas in order, cells in order', () => {
    const pool = cellPool(data);
    expect(pool).toHaveLength(36 + 20 + 21);
    expect(pool[0]).toMatchObject({ areaId: 'crateria', cell: { x: 0, y: 0 } });
    expect(pool[36]).toMatchObject({ areaId: 'brinstar', cell: { x: 0, y: 0 } });
    expect(pool[36 + 20]).toMatchObject({ areaId: 'norfair', cell: { x: 0, y: 0 } });
  });

  it('indices ↔ targets round-trip', () => {
    const pool = cellPool(data);
    const picks = [pool[3], pool[40], pool[36 + 20 + 10], pool[0], pool[70]];
    const indices = indicesFromTargets(pool, picks);
    expect(indices).toEqual([3, 40, 66, 0, 70]);
    expect(targetsFromIndices(data, indices)).toEqual(picks);
  });

  it('a hand-picked run survives encode → decode → resolve', () => {
    const pool = cellPool(data);
    const picks = [pool[5], pool[36], pool[76], pool[12], pool[50]];
    const indices = indicesFromTargets(pool, picks);
    const diffIndex = deriveDifficultyIndex(data, picks);
    const seed = decodeSeed(encodeSeed({ gameIndex: 0, diffIndex, indices }))!;
    expect(seed.indices).toEqual(indices);
    expect(targetsFromIndices(data, seed.indices)).toEqual(picks);
  });
});

describe('deriveDifficultyIndex', () => {
  const idOf = (i: number) => DIFFICULTIES[i].id;
  it('snaps the mean rating to the nearest tier centre', () => {
    const cells = grid(3, 2); // 6 cells
    const rated = (rs: number[]) => makeData({ norfair: cells }, Object.fromEntries(cells.map((c, i) => [cellKey('norfair', c), rs[i]])));
    const pick = (d: GameData) => cellPool(d);
    const low = rated([1, 2, 2, 1, 2, 1]); // mean 1.5 → tallon
    const mid = rated([3, 3, 3, 3, 3, 3]); // mean 3 → brinstar
    const high = rated([5, 4, 5, 4, 5, 4]); // mean 4.5 → sanctuary
    expect(idOf(deriveDifficultyIndex(low, pick(low)))).toBe('tallon');
    expect(idOf(deriveDifficultyIndex(mid, pick(mid)))).toBe('brinstar');
    expect(idOf(deriveDifficultyIndex(high, pick(high)))).toBe('sanctuary');
  });
});

describe('cellRating', () => {
  it('returns the rated value for a rated cell', () => {
    const data = makeData({ brinstar: grid(2, 2) }, { 'brinstar:1,1': 5 });
    expect(cellRating(data, 'brinstar', { x: 1, y: 1 })).toBe(5);
  });

  it('returns the default for unrated cells and for data with no ratings at all', () => {
    const rated = makeData({ brinstar: grid(2, 2) }, { 'brinstar:1,1': 5 });
    expect(cellRating(rated, 'brinstar', { x: 0, y: 0 })).toBe(DEFAULT_RATING);
    const bare = makeData({ brinstar: grid(2, 2) });
    expect(cellRating(bare, 'brinstar', { x: 0, y: 0 })).toBe(DEFAULT_RATING);
  });
});
