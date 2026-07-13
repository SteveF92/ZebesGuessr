import { describe, expect, it } from "vitest";
import { cellKey, cellRating, pickTargets } from "./data";
import { DEFAULT_RATING, getDifficulty } from "./scoring";
import type { Cell, GameData } from "./types";

/** Minimal GameData with only the fields pickTargets touches. */
function makeData(
  areas: Record<string, Cell[]>,
  cellDifficulty?: Record<string, number>,
): GameData {
  return {
    game: "test",
    title: "Test",
    cellSize: 8,
    guessMapCellPx: 8,
    areas: Object.entries(areas).map(([id, cells]) => ({
      id,
      name: id,
      cols: 10,
      rows: 10,
      mapImage: "",
      cells,
      map: { cols: 10, rows: 10, dx: 0, dy: 0, cells: [], glyphs: [], bands: [], connectors: [], source: "fallback" },
    })),
    cellDifficulty,
  };
}

const grid = (w: number, h: number): Cell[] =>
  Array.from({ length: w * h }, (_, i) => ({ x: i % w, y: Math.floor(i / w) }));

describe("pickTargets", () => {
  it("returns n distinct targets", () => {
    const data = makeData({ brinstar: grid(5, 5), norfair: grid(4, 4) });
    const targets = pickTargets(data, 10);
    expect(targets).toHaveLength(10);
    const keys = targets.map((t) => cellKey(t.areaId, t.cell));
    expect(new Set(keys).size).toBe(10);
  });

  it("returns the whole pool when it is smaller than n", () => {
    const data = makeData({ crateria: grid(2, 2) });
    const targets = pickTargets(data, 10);
    expect(targets).toHaveLength(4);
    const keys = targets.map((t) => cellKey(t.areaId, t.cell));
    expect(new Set(keys).size).toBe(4);
  });

  it("only picks cells that exist in the named area", () => {
    const data = makeData({
      brinstar: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      norfair: [{ x: 5, y: 5 }],
    });
    const valid = new Set(
      data.areas.flatMap((a) => a.cells.map((c) => cellKey(a.id, c))),
    );
    for (const t of pickTargets(data, 3)) {
      expect(valid.has(cellKey(t.areaId, t.cell))).toBe(true);
    }
  });

  it("returns an empty array when there are no cells", () => {
    expect(pickTargets(makeData({}), 5)).toEqual([]);
  });

  it("never serves cells rated outside the tier's band", () => {
    // 25 cells: (0,0) and (1,0) rated 5, everything else default (3).
    const data = makeData(
      { brinstar: grid(5, 5) },
      { "brinstar:0,0": 5, "brinstar:1,0": 5 },
    );
    const recruit = getDifficulty("recruit"); // band 1–3
    for (let i = 0; i < 50; i++) {
      for (const t of pickTargets(data, 5, recruit)) {
        expect(cellRating(data, t.areaId, t.cell)).toBeLessThanOrEqual(recruit.max);
      }
    }
  });

  it("draws from everything when no difficulty is given", () => {
    const data = makeData({ brinstar: grid(2, 2) }, { "brinstar:0,0": 5 });
    expect(pickTargets(data, 4)).toHaveLength(4);
  });

  it("falls back to the full pool when the band leaves fewer than n cells", () => {
    // Every cell rated 5 — Recruit's band is empty, so all cells stay in play.
    const cells = grid(3, 3);
    const ratings = Object.fromEntries(cells.map((c) => [cellKey("norfair", c), 5]));
    const data = makeData({ norfair: cells }, ratings);
    expect(pickTargets(data, 5, getDifficulty("recruit"))).toHaveLength(5);
  });
});

describe("cellRating", () => {
  it("returns the rated value for a rated cell", () => {
    const data = makeData({ brinstar: grid(2, 2) }, { "brinstar:1,1": 5 });
    expect(cellRating(data, "brinstar", { x: 1, y: 1 })).toBe(5);
  });

  it("returns the default for unrated cells and for data with no ratings at all", () => {
    const rated = makeData({ brinstar: grid(2, 2) }, { "brinstar:1,1": 5 });
    expect(cellRating(rated, "brinstar", { x: 0, y: 0 })).toBe(DEFAULT_RATING);
    const bare = makeData({ brinstar: grid(2, 2) });
    expect(cellRating(bare, "brinstar", { x: 0, y: 0 })).toBe(DEFAULT_RATING);
  });
});
