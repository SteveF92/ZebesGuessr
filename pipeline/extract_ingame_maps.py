#!/usr/bin/env python3
"""Extract in-game pause-map data from map recreations (vgmaps.de, Rick Bruns).

Reads Images/raw/<game>/ingame/<area>.webp and, for each area:
  1. auto-detects the 8px cell grid phase (edge-energy voting),
  2. classifies each cell: room / vertical|horizontal shaft,
  3. reads cyan wall segments per cell side (NESW bitmask),
  4. extracts station glyphs (save S, map M, Samus' ship) as connected
     components with fractional cell-coordinate centroids,
  5. auto-aligns the map grid to the sliced tile grid (mask cross-correlation),
  6. patches public/data/<game>.json with a per-area "map" object and
     filters playable target cells to those visible on the in-game map.

Areas without an in-game image get a fallback map synthesized from the tile
grid so the game stays playable.
"""
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL = 8  # in-game map cell size in source pixels

PINK = (216, 56, 144)
CYAN = (160, 248, 248)
GREEN = (0, 248, 88)
SHIP = [(248, 136, 56), (176, 16, 8), (248, 248, 104)]

N, E, S, W = 1, 2, 4, 8


def mask(im: np.ndarray, color) -> np.ndarray:
    return np.all(im == color, axis=2)


def detect_phase(solid: np.ndarray) -> tuple[int, int]:
    dx = np.abs(np.diff(solid.astype(int), axis=1)).sum(axis=0)
    dy = np.abs(np.diff(solid.astype(int), axis=0)).sum(axis=1)
    ox = int(np.argmax([dx[o::CELL].sum() for o in range(CELL)]))
    oy = int(np.argmax([dy[o::CELL].sum() for o in range(CELL)]))
    return (ox + 1) % CELL, (oy + 1) % CELL


def components(m: np.ndarray):
    """Connected components (4-conn) of a boolean mask -> list of pixel lists."""
    seen = np.zeros_like(m, bool)
    out = []
    for sy, sx in zip(*np.nonzero(m)):
        if seen[sy, sx]:
            continue
        q, comp = deque([(sy, sx)]), []
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] \
                        and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        out.append(comp)
    return out


def side_has_wall(cyan: np.ndarray, x0: int, y0: int, side: int, h: int, w: int) -> bool:
    """Check the two pixel rows/cols straddling a cell boundary."""
    def row(y):
        return cyan[y, x0:x0 + CELL].sum() if 0 <= y < h else 0
    def col(x):
        return cyan[y0:y0 + CELL, x].sum() if 0 <= x < w else 0
    if side == N: return max(row(y0), row(y0 - 1)) >= 4
    if side == S: return max(row(y0 + CELL - 1), row(y0 + CELL)) >= 4
    if side == W: return max(col(x0), col(x0 - 1)) >= 4
    if side == E: return max(col(x0 + CELL - 1), col(x0 + CELL)) >= 4
    return False


def extract_area(img_path: Path):
    im = np.asarray(Image.open(img_path).convert("RGB")).astype(int)
    h, w = im.shape[:2]
    pink, cyan, green = mask(im, PINK), mask(im, CYAN), mask(im, GREEN)
    ship = np.zeros_like(pink)
    for c in SHIP:
        ship |= mask(im, c)
    ox, oy = detect_phase(pink | cyan)
    cols, rows = (w - ox) // CELL, (h - oy) // CELL

    cells = {}
    for y in range(rows):
        for x in range(cols):
            x0, y0 = ox + x * CELL, oy + y * CELL
            inner = np.s_[y0 + 1:y0 + CELL - 1, x0 + 1:x0 + CELL - 1]
            fill = int(pink[inner].sum() + cyan[inner].sum()
                       + ship[inner].sum() + green[inner].sum())
            if fill < 4:
                continue
            full = np.s_[y0:y0 + CELL, x0:x0 + CELL]
            kind = "room"
            if pink[full].sum() + cyan[full].sum() < 26 and ship[full].sum() < 3:
                pys, pxs = np.nonzero(pink[full])
                tall = (pys.max() - pys.min()) if len(pys) else 0
                wide = (pxs.max() - pxs.min()) if len(pxs) else 0
                kind = "vshaft" if tall >= wide else "hshaft"
            walls = 0
            for side in (N, E, S, W):
                if side_has_wall(cyan, x0, y0, side, h, w):
                    walls |= side
            cells[(x, y)] = {"kind": kind, "walls": walls}

    glyphs = []
    # map stations: green 'M' components
    for comp in components(green):
        ys = [p[0] for p in comp]; xs = [p[1] for p in comp]
        if len(comp) >= 5:
            glyphs.append({"x": round((np.mean(xs) - ox) / CELL, 2),
                           "y": round((np.mean(ys) - oy) / CELL, 2), "t": "map"})
    # ship: orange/red/yellow components merged into one glyph
    ship_px = list(zip(*np.nonzero(ship)))
    if len(ship_px) >= 6:
        ys = [p[0] for p in ship_px]; xs = [p[1] for p in ship_px]
        glyphs.append({"x": round((np.mean(xs) - ox) / CELL, 2),
                       "y": round((np.mean(ys) - oy) / CELL, 2), "t": "ship"})
    # save stations: small chunky cyan components (letter 'S'), not 1px wall lines
    for comp in components(cyan):
        ys = [p[0] for p in comp]; xs = [p[1] for p in comp]
        bh, bw = max(ys) - min(ys) + 1, max(xs) - min(xs) + 1
        if 12 <= len(comp) <= 30 and 4 <= bw <= 8 and 4 <= bh <= 8:
            glyphs.append({"x": round((np.mean(xs) - ox) / CELL, 2),
                           "y": round((np.mean(ys) - oy) / CELL, 2), "t": "save"})
    return cols, rows, cells, glyphs


def align(map_cells, mcols, mrows, tile_cells, tcols, trows):
    occ = np.zeros((mrows, mcols), bool)
    for (x, y) in map_cells:
        occ[y, x] = True
    ours = np.zeros((trows, tcols), bool)
    for c in tile_cells:
        ours[c["y"], c["x"]] = True
    best = (-1, 0, 0)
    for dy in range(-8, 9):
        for dx in range(-8, 9):
            s = 0
            for (cy, cx) in zip(*np.nonzero(ours)):
                my, mx = cy + dy, cx + dx
                if 0 <= my < mrows and 0 <= mx < mcols and occ[my, mx]:
                    s += 1
            if s > best[0]:
                best = (s, dx, dy)
    return best[1], best[2], best[0]


def fallback_map(area):
    occ = {(c["x"], c["y"]) for c in area["cells"]}
    cells = []
    for (x, y) in occ:
        walls = 0
        if (x, y - 1) not in occ: walls |= N
        if (x + 1, y) not in occ: walls |= E
        if (x, y + 1) not in occ: walls |= S
        if (x - 1, y) not in occ: walls |= W
        cells.append({"x": x, "y": y, "k": "room", "w": walls})
    return {"cols": area["cols"], "rows": area["rows"], "dx": 0, "dy": 0,
            "cells": cells, "glyphs": [], "source": "fallback"}


def main() -> None:
    for data_file in (ROOT / "public" / "data").glob("*.json"):
        data = json.loads(data_file.read_text())
        game_id = data["game"]
        for area in data["areas"]:
            img = ROOT / "Images" / "raw" / game_id / "ingame" / f"{area['id']}.webp"
            if not img.exists():
                area["map"] = fallback_map(area)
                print(f"  {area['id']}: no in-game image, using fallback grid")
                continue
            cols, rows, cells, glyphs = extract_area(img)
            dx, dy, matches = align(cells, cols, rows, area["cells"],
                                    area["cols"], area["rows"])
            occ = set(cells)
            playable = [c for c in area["cells"] if (c["x"] + dx, c["y"] + dy) in occ]
            dropped = len(area["cells"]) - len(playable)
            area["cells"] = playable
            area["map"] = {
                "cols": cols, "rows": rows, "dx": dx, "dy": dy,
                "cells": [{"x": x, "y": y, "k": v["kind"], "w": v["walls"]}
                          for (x, y), v in sorted(cells.items())],
                "glyphs": glyphs,
                "source": "ingame",
            }
            print(f"  {area['id']}: {cols}x{rows} map, {len(cells)} cells, "
                  f"{len(glyphs)} glyphs, offset ({dx},{dy}), {matches} aligned, "
                  f"{dropped} targets dropped")
        data_file.write_text(json.dumps(data))
        print(f"patched {data_file.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
