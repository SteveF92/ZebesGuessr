#!/usr/bin/env python3
"""Extract in-game pause-map data from map recreations (vgmaps.de, Rick Bruns).

Reads Images/raw/<game>/ingame/<area>.webp and, for each area:
  1. auto-detects the 8px cell grid phase (edge-energy voting),
  2. classifies each cell: room / vertical|horizontal shaft,
  3. reads cyan wall segments per cell side (NESW bitmask),
  4. auto-aligns the map grid to the sliced tile grid (mask cross-correlation),
  5. patches public/data/<game>.json with a per-area "map" object and
     filters playable target cells to those visible on the in-game map.

Areas without an in-game image get a fallback map synthesized from the tile
grid so the game stays playable. Landmark icons (station glyphs) are no
longer auto-detected — they are hand-placed via the in-app icon editor and
stored in glyphs.<game>.json, which this script never touches.
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

# annotation cleanup: pink components smaller than this can only be caption
# text / arrow dashes (letters are 6-16 px, dashes 1-3 px); the smallest real
# geometry, a one-tile room interior, is 26+ px
ANNOT_MAX_PX = 24
# ... and real pink is always outlined in cyan: every real component measures
# cyan-enclosure >= 0.75, annotations measure <= 0.38 (captions exactly 0.0)
ANNOT_MAX_ENCLOSURE = 0.5
# a diag-chain cell with at least this much pink is a real map tile; below it
# is a corner sliver of the band that exists for display continuity only
DIAG_SOLID_PX = 24

N, E, S, W = 1, 2, 4, 8


def mask(im: np.ndarray, color) -> np.ndarray:
    return np.all(im == color, axis=2)


def detect_phase(solid: np.ndarray) -> tuple[int, int]:
    dx = np.abs(np.diff(solid.astype(int), axis=1)).sum(axis=0)
    dy = np.abs(np.diff(solid.astype(int), axis=0)).sum(axis=1)
    ox = int(np.argmax([dx[o::CELL].sum() for o in range(CELL)]))
    oy = int(np.argmax([dy[o::CELL].sum() for o in range(CELL)]))
    return (ox + 1) % CELL, (oy + 1) % CELL


def components(m: np.ndarray, diagonal: bool = False):
    """Connected components of a boolean mask -> list of pixel lists."""
    seen = np.zeros_like(m, bool)
    out = []
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if diagonal:
        steps += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    for sy, sx in zip(*np.nonzero(m)):
        if seen[sy, sx]:
            continue
        q, comp = deque([(sy, sx)]), []
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for dy, dx in steps:
                ny, nx = y + dy, x + dx
                if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] \
                        and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        out.append(comp)
    return out


def erase_annotations(pink: np.ndarray, cyan: np.ndarray) -> int:
    """Erase caption text and exit-arrow dashes from the pink mask, in place.

    The map recreations annotate area exits in the same pink as rooms: caption
    words (BRINSTAR, WRECKED SHIP, ...) and the dashes of elevator/arrow
    markers. Some captions sit within 8-connectivity of real rooms on the cell
    grid, so cell-level filtering can't catch them all. At the pixel level the
    signal is unambiguous: real pink is enclosed by a cyan outline, annotation
    pink is not. Erase small pink components with low cyan-enclosure.
    Returns the number of pixels erased.
    """
    h, w = pink.shape
    erased = 0
    for comp in components(pink, diagonal=True):
        if len(comp) >= ANNOT_MAX_PX:
            continue
        border = set()
        for (y, x) in comp:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not pink[ny, nx]:
                        border.add((ny, nx))
        ncyan = sum(1 for (y, x) in border if cyan[y, x])
        if border and ncyan / len(border) < ANNOT_MAX_ENCLOSURE:
            for (y, x) in comp:
                pink[y, x] = False
            erased += len(comp)
    return erased


def diagonal_dir(pink: np.ndarray, x0: int, y0: int):
    """Classify a wall-less cell whose pink forms a ~45deg streak.

    In-game diagonal corridors are drawn as a sub-cell pink band, not aligned
    to the 8px grid. Within such a cell the pink pixels correlate along a
    diagonal; a full room or a straight shaft has ~zero correlation. Returns
    "/" (NE-SW), "\\" (NW-SE), or None. Image y points down, so a negative
    x/y correlation is the "/" direction.
    """
    block = pink[y0:y0 + CELL, x0:x0 + CELL]
    ys, xs = np.nonzero(block)
    if len(xs) < 3:
        return None
    xs = xs - xs.mean()
    ys = ys - ys.mean()
    denom = float(np.sqrt((xs * xs).sum() * (ys * ys).sum()))
    if denom == 0:
        return None
    corr = float((xs * ys).sum()) / denom
    if abs(corr) < 0.2:
        return None
    return "/" if corr < 0 else "\\"


def clip_polygon(poly, lo, hi):
    """Sutherland-Hodgman clip of a convex polygon against an axis-aligned box."""
    def clip_edge(pts, axis, keep_ge, bound):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            cur_in = cur[axis] >= bound if keep_ge else cur[axis] <= bound
            prev_in = prev[axis] >= bound if keep_ge else prev[axis] <= bound
            if cur_in != prev_in:
                t = (bound - prev[axis]) / (cur[axis] - prev[axis])
                out.append((prev[0] + t * (cur[0] - prev[0]),
                            prev[1] + t * (cur[1] - prev[1])))
            if cur_in:
                out.append(cur)
        return out
    poly = clip_edge(poly, 0, True, lo[0])
    poly = clip_edge(poly, 0, False, hi[0])
    poly = clip_edge(poly, 1, True, lo[1])
    poly = clip_edge(poly, 1, False, hi[1])
    return poly


def extract_diag_bands(cells: dict, pink: np.ndarray, ox: int, oy: int):
    """Fit one straight band through each chain of diag cells.

    The source draws a stair passage as a smooth sub-cell pink band (not 45°:
    Crateria's moat descent runs ~27°). Per-cell rendering can't reproduce
    that, so emit the band itself as a polygon, in fractional cell
    coordinates. A rotated rectangle fit to the pixels (PCA axis + width)
    overshoots at both ends: the source band's ends are mitred flush into the
    corridor it joins, not cut perpendicular to the band's own axis, so a
    constant-width rectangle's corners poke out past the real pink into empty
    space. Clipping that rectangle to the axis-aligned bounding box of the
    chain's actual pink pixels trims exactly those corners off and leaves a
    polygon that hugs the true shape. Cells with a solid amount of pink stay
    in the cell dict as real (clickable) map tiles; corner slivers exist only
    so the drawn band reads as continuous, and are removed here — the band
    polygon covers them. Returns a list of band dicts; mutates `cells`.
    """
    diag = {c for c, v in cells.items() if v["kind"] == "diag"}
    bands = []
    seen: set = set()
    for start in sorted(diag):
        if start in seen:
            continue
        chain, stack = [], [start]
        seen.add(start)
        while stack:
            x, y = stack.pop()
            chain.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in diag and n not in seen:
                        seen.add(n)
                        stack.append(n)
        if len(chain) < 2:
            continue  # lone cell: no line to fit; renderer falls back
        # pink pixels of the whole chain, in fractional cell coordinates
        pts = []
        for (x, y) in chain:
            x0, y0 = ox + x * CELL, oy + y * CELL
            ys, xs = np.nonzero(pink[y0:y0 + CELL, x0:x0 + CELL])
            pts += [((x0 + px + 0.5 - ox) / CELL, (y0 + py + 0.5 - oy) / CELL)
                    for py, px in zip(ys, xs)]
        pts = np.array(pts)
        ctr = pts.mean(axis=0)
        cov = np.cov((pts - ctr).T)
        evals, evecs = np.linalg.eigh(cov)
        d = evecs[:, np.argmax(evals)]  # principal direction
        t = (pts - ctr) @ d
        perp0 = np.array([-d[1], d[0]])
        p = (pts - ctr) @ perp0
        half_w = (p.max() - p.min()) / 2 + 0.5 / CELL
        # overshoot generously before clipping so the box below (not this
        # padding) is what determines the final, precisely-fit shape
        pad = 1.0
        a = ctr + d * (t.min() - pad)
        b = ctr + d * (t.max() + pad)
        rect = [tuple(a + perp0 * half_w), tuple(b + perp0 * half_w),
                tuple(b - perp0 * half_w), tuple(a - perp0 * half_w)]
        poly = clip_polygon(rect, pts.min(axis=0), pts.max(axis=0))
        bands.append({"poly": [[round(float(x), 3), round(float(y), 3)]
                                for (x, y) in poly]})
        # drop display-only slivers from the clickable cell grid: chain cells
        # without solid pink, plus neighbours whose pink is just the band's
        # corner spilling into them (the correlation detector misses some of
        # those, and they'd render as floating shaft stubs)
        half = (p.max() - p.min()) / 2 + 0.2
        for (x, y) in set(chain) | {(x + dx, y + dy) for (x, y) in chain
                                    for dx in (-1, 0, 1) for dy in (-1, 0, 1)}:
            if (x, y) not in cells:
                continue
            x0, y0 = ox + x * CELL, oy + y * CELL
            blk = pink[y0:y0 + CELL, x0:x0 + CELL]
            if blk.sum() >= DIAG_SOLID_PX:
                continue
            ys, xs = np.nonzero(blk)
            cpts = np.column_stack([(x0 + xs + 0.5 - ox) / CELL,
                                    (y0 + ys + 0.5 - oy) / CELL])
            if np.all(np.abs((cpts - ctr) @ perp0) <= half):
                del cells[(x, y)]
    return bands


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
    erased = erase_annotations(pink, cyan)
    cols, rows = (w - ox) // CELL, (h - oy) // CELL

    cells = {}
    for y in range(rows):
        for x in range(cols):
            x0, y0 = ox + x * CELL, oy + y * CELL
            inner = np.s_[y0 + 1:y0 + CELL - 1, x0 + 1:x0 + CELL - 1]
            # cyan does not count toward occupancy: the twin rails of
            # elevator-exit markers are cyan-only and must not become cells
            fill = int(pink[inner].sum() + ship[inner].sum()
                       + green[inner].sum())
            if fill < 4:
                continue
            full = np.s_[y0:y0 + CELL, x0:x0 + CELL]
            kind = "room"
            # a baked-in station icon (green map-station letter, orange/red/
            # yellow ship/boss glyph) displaces room pink in its cell, which
            # can otherwise drop the room below the shaft threshold — a real
            # room with a map icon on it measures ~23px pink+cyan, just under
            # the cutoff, so count icon pixels as fill too
            if (pink[full].sum() + cyan[full].sum() + green[full].sum() < 26
                    and ship[full].sum() < 3):
                pys, pxs = np.nonzero(pink[full])
                tall = (pys.max() - pys.min()) if len(pys) else 0
                wide = (pxs.max() - pxs.min()) if len(pxs) else 0
                kind = "vshaft" if tall >= wide else "hshaft"
            walls = 0
            for side in (N, E, S, W):
                if side_has_wall(cyan, x0, y0, side, h, w):
                    walls |= side
            cell = {"kind": kind, "walls": walls}
            # a wall-less cell whose pink runs on a diagonal is a stair passage;
            # solid rooms and straight shafts have ~zero pink correlation
            if walls == 0:
                d = diagonal_dir(pink, x0, y0)
                if d is not None:
                    cell["kind"] = "diag"
                    cell["dir"] = d
            cells[(x, y)] = cell

    # station glyphs (save/map/ship/boss) are hand-placed via the icon editor,
    # not auto-detected here — see glyphs.<game>.json
    bands = extract_diag_bands(cells, pink, ox, oy)
    return cols, rows, cells, bands, erased


def drop_label_text(cells: dict) -> int:
    """Remove connected components that carry no cyan walls.

    Area-transition captions (BRINSTAR, MARIDIA, WRECKED SHIP) are drawn in the
    same pink as rooms, so the grid picks them up as tiny room clusters. Real
    rooms and shafts are always outlined in cyan; label glyphs never are. So any
    8-connected component whose cells all report walls==0 is caption text, not
    map geometry. Returns the number of cells removed.
    """
    occ = set(cells)
    seen: set = set()
    removed = 0
    for start in list(cells):
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in occ and n not in seen:
                        seen.add(n)
                        stack.append(n)
        if all(cells[c]["walls"] == 0 for c in comp):
            for c in comp:
                del cells[c]
            removed += len(comp)
    return removed


def close_perimeter(cells: dict) -> int:
    """Wall off exterior room edges the cyan detector missed.

    ``side_has_wall`` needs >=4 cyan px on a boundary, so a room whose source
    outline is thin or anti-aliased can end up with an open side facing empty
    space. Any room-cell side with no occupied neighbour is a map boundary and
    must show a wall, so OR those bits in. Only adds walls on exterior sides —
    never between two occupied cells, and never touches shaft/diag cells (which
    render no walls). Returns the number of edges closed.
    """
    occ = set(cells)
    added = 0
    for (x, y), v in cells.items():
        if v["kind"] != "room":
            continue
        for bit, nb in ((N, (x, y - 1)), (E, (x + 1, y)),
                        (S, (x, y + 1)), (W, (x - 1, y))):
            if nb not in occ and not (v["walls"] & bit):
                v["walls"] |= bit
                added += 1
    return added


def align(map_cells, mcols, mrows, tile_cells, tcols, trows):
    occ = np.zeros((mrows, mcols), bool)
    for (x, y) in map_cells:
        occ[y, x] = True
    ours = np.zeros((trows, tcols), bool)
    for c in tile_cells:
        ours[c["y"], c["x"]] = True
    best = (-1, 0, 0)
    for dy in range(-12, 21):
        for dx in range(-12, 21):
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
            "cells": cells, "glyphs": [], "bands": [],
            "elevators": [], "lines": [], "source": "fallback"}


def main() -> None:
    for data_file in (ROOT / "public" / "data").glob("*.json"):
        if data_file.name.startswith(("glyphs.", "overlays.")):
            continue  # hand-placed icons / elevators / lines; not touched by extraction
        data = json.loads(data_file.read_text())
        game_id = data["game"]
        for area in data["areas"]:
            img = ROOT / "Images" / "raw" / game_id / "ingame" / f"{area['id']}.webp"
            if not img.exists():
                area["map"] = fallback_map(area)
                print(f"  {area['id']}: no in-game image, using fallback grid")
                continue
            cols, rows, cells, bands, erased = extract_area(img)
            dropped_labels = drop_label_text(cells)
            closed = close_perimeter(cells)
            dx, dy, matches = align(cells, cols, rows, area["cells"],
                                    area["cols"], area["rows"])
            occ = set(cells)
            playable = [c for c in area["cells"] if (c["x"] + dx, c["y"] + dy) in occ]
            dropped = len(area["cells"]) - len(playable)
            area["cells"] = playable
            area["map"] = {
                "cols": cols, "rows": rows, "dx": dx, "dy": dy,
                "cells": [
                    {"x": x, "y": y, "k": v["kind"], "w": v["walls"],
                     **({"d": v["dir"]} if "dir" in v else {})}
                    for (x, y), v in sorted(cells.items())],
                "glyphs": [],
                "bands": bands,
                "elevators": [],
                "lines": [],
                "source": "ingame",
            }
            print(f"  {area['id']}: {cols}x{rows} map, {len(cells)} cells, "
                  f"{len(bands)} bands, offset ({dx},{dy}), "
                  f"{matches} aligned, {dropped} targets dropped, "
                  f"{erased} annotation px erased, {dropped_labels} label cells removed, "
                  f"{closed} edges closed")
        data_file.write_text(json.dumps(data))
        print(f"patched {data_file.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
