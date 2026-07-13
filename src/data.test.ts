import { describe, expect, it } from "vitest";
import { cellKey, pickTargets } from "./data";
import type { Cell, GameData } from "./types";

/** Minimal GameData with only the fields pickTargets touches. */
function makeData(areas: Record<string, Cell[]>): GameData {
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
      map: { cols: 10, rows: 10, dx: 0, dy: 0, cells: [], glyphs: [], bands: [], elevators: [], lines: [], source: "fallback" },
    })),
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
});
