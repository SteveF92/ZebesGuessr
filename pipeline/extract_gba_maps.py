#!/usr/bin/env python3
"""Extract in-game pause-map data from GBA map rips (vgmaps.com).

Handles games with mapStyle "gba" (Metroid Fusion, and later Zero Mission);
SNES-style recreations are extract_ingame_maps.py's job.

Unlike the SNES recreations, the GBA rips are clean tile art: solid room
fills on an exact 8px grid, 1px white wall lines on cell borders, and small
colored "pips" marking doors on those borders. That makes extraction mostly
exact-color bookkeeping — no PCA band fitting, no fuzzy annotation heuristics.

Reads Images/raw/<game>/ingame/<area>.* and, for each area:
  1. auto-detects the 8px cell grid phase (edge-energy voting),
  2. marks occupied cells (room fill or a baked station icon displacing it),
  3. records each cell's fill variant (magenta vs green in Fusion),
  4. reads white wall segments per cell side (NESW bitmask) and door pips
     (side + color) on those same borders,
  5. auto-aligns the map grid to the sliced tile grid (mask cross-correlation),
  6. patches public/data/<game>.json with a per-area "map" object.

Run for one game with `python pipeline/extract_gba_maps.py <game-id>`.

The rips frame the map in a wide border of empty lattice squares; the render
viewport is trimmed to the aligned tile grid plus a small margin, since that
framing is the ripper's, not the game's. Elevator stubs (dashed lines +
numbers) and captions are drawn in white/icon colors only, never in room
fill, so they don't become cells; elevators are hand-placed later as
connectors in overlays.<game>.json, same as Super Metroid.
"""
import json
import sys

import numpy as np
from PIL import Image

from maplib import (E, N, ROOT, S, W, align, apply_cell_overrides,
                    close_perimeter, detect_phase, fallback_cells,
                    find_ingame_image, load_map_overrides, mask, merge_cells)

CELL = 8  # in-game map cell size in source pixels

# Metroid Fusion pause-map palette (exact RGB in the vgmaps rips)
FILLS = [(248, 0, 248), (32, 192, 104)]  # room fill variants: magenta, green
WALL = (248, 248, 248)
DOORS = {"r": (248, 32, 72), "y": (248, 248, 0), "g": (16, 248, 128), "b": (0, 0, 248)}
# baked station icons (yellow S/N letters on a red box) displace room fill in
# their cell, so their colors count toward occupancy — same bug class as Super
# Metroid's green map-station letters
ICONS = [(248, 32, 72), (248, 248, 0)]

# interior room fill needed to occupy a cell (of the 6x6=36 inner pixels);
# solid fills score ~36, so this only has to reject stray caption strokes
FILL_MIN = 4
# icon-only cells (fill fully displaced by a station icon) need a solid block,
# not just text strokes
ICON_MIN = 12
# empty-cell viewport margin around the aligned tile grid
VIEW_MARGIN = 2


def side_lines(x0: int, y0: int, side: int, h: int, w: int):
    """The two pixel rows/cols straddling a cell boundary, as slices."""
    if side == N: ys = (y0 - 1, y0)
    elif side == S: ys = (y0 + CELL - 1, y0 + CELL)
    elif side == W: return [np.s_[y0:y0 + CELL, x] for x in (x0 - 1, x0) if 0 <= x < w]
    else: return [np.s_[y0:y0 + CELL, x] for x in (x0 + CELL - 1, x0 + CELL) if 0 <= x < w]
    return [np.s_[y, x0:x0 + CELL] for y in ys if 0 <= y < h]


def side_pixels(m: np.ndarray, x0: int, y0: int, side: int, h: int, w: int) -> int:
    """Max mask-pixel count over the two lines straddling a cell boundary."""
    return max((int(m[s].sum()) for s in side_lines(x0, y0, side, h, w)), default=0)


def side_door(doors: dict, wall: np.ndarray, x0: int, y0: int,
              side: int, h: int, w: int) -> str | None:
    """Doors are drawn as a small gap in the white wall line: empty for a
    normal hatch, filled with a colored pip for locked/special doors.

    Scan the boundary's wall line for a 2-5px run of non-white bounded by
    white on both sides, then classify the run by its dominant door color
    ("n" if none — a plain opening). Requiring white on both ends rejects
    the baked caption boxes ("N:S:R"), whose solid outlines cross cell
    borders as long runs or edge-touching stubs.
    """
    lines = side_lines(x0, y0, side, h, w)
    if not lines:
        return None
    line = max(lines, key=lambda s: int(wall[s].sum()))
    wl = wall[line]
    if int(wl.sum()) < 4:
        return None  # no wall here, so nothing to be a door in
    dls = {c: dm[line] for c, dm in doors.items()}
    run_start = None
    for i in range(len(wl) + 1):
        if i < len(wl) and not wl[i]:
            if run_start is None:
                run_start = i
            continue
        if run_start is not None:
            # non-white run [run_start, i); bounded means white on both ends
            if run_start > 0 and i < len(wl) and 2 <= i - run_start <= 5:
                best, best_n = "n", 0
                for c, dl in dls.items():
                    n = int(dl[run_start:i].sum())
                    if n > best_n:
                        best, best_n = c, n
                return best if best_n >= 2 else "n"
            run_start = None
    return None


def extract_area(img_path):
    im = np.asarray(Image.open(img_path).convert("RGB")).astype(int)
    h, w = im.shape[:2]
    fills = [mask(im, c) for c in FILLS]
    anyfill = np.logical_or.reduce(fills)
    wall = mask(im, WALL)
    doors = {k: mask(im, c) for k, c in DOORS.items()}
    anydoor = np.logical_or.reduce(list(doors.values()))
    icon = np.zeros_like(wall)
    for c in ICONS:
        icon |= mask(im, c)
    ox, oy = detect_phase(anyfill | wall, CELL)
    cols, rows = (w - ox) // CELL, (h - oy) // CELL

    cells = {}
    icon_only = []
    for y in range(rows):
        for x in range(cols):
            x0, y0 = ox + x * CELL, oy + y * CELL
            inner = np.s_[y0 + 1:y0 + CELL - 1, x0 + 1:x0 + CELL - 1]
            nfill = int(anyfill[inner].sum())
            nicon = int(icon[inner].sum())
            if nfill < FILL_MIN and (nfill + nicon) < ICON_MIN:
                continue
            if nfill < FILL_MIN:
                icon_only.append((x, y))
            # fill variant: majority vote (icon-only cells default to 0)
            counts = [int(f[inner].sum()) for f in fills]
            variant = counts.index(max(counts)) if max(counts) else 0
            walls = 0
            pips = []
            for side, letter in ((N, "N"), (E, "E"), (S, "S"), (W, "W")):
                # door pips interrupt the white wall line, so both count as wall
                if side_pixels(wall, x0, y0, side, h, w) \
                        + side_pixels(anydoor, x0, y0, side, h, w) >= 4:
                    walls |= side
                door = side_door(doors, wall, x0, y0, side, h, w)
                if door is not None:
                    pips.append(letter + door)
            cell = {"kind": "room", "walls": walls}
            if variant:
                cell["fill"] = variant
            if pips:
                cell["doors"] = pips
            cells[(x, y)] = cell
    return cols, rows, cells, icon_only


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for data_file in sorted((ROOT / "public" / "data").glob("*.json")):
        data = json.loads(data_file.read_text())
        # skip sidecar files and non-GBA games
        if "game" not in data or "areas" not in data:
            continue
        if data.get("mapStyle") != "gba":
            continue
        game_id = data["game"]
        if only and game_id != only:
            continue
        overrides = load_map_overrides(game_id)
        patched_areas = []
        aborted = False
        for area in data["areas"]:
            ov = overrides.get(area["id"])
            # Re-runs must ignore previously folded-in draw data.
            tiles = [{"x": c["x"], "y": c["y"]} for c in area["cells"]]
            img = find_ingame_image(game_id, area["id"])
            if img is None:
                if area.get("map", {}).get("source") == "ingame":
                    print(f"  ERROR: {area['id']} was extracted from an in-game "
                          f"image that is now missing - run download_maps.py; "
                          f"skipping {game_id} entirely")
                    aborted = True
                    break
                cells = fallback_cells(area)
                mapobj = {"cols": area["cols"], "rows": area["rows"],
                          "dx": 0, "dy": 0, "glyphs": [], "bands": [],
                          "connectors": [], "source": "fallback"}
                patched_areas.append((area, cells, mapobj))
                print(f"  {area['id']}: no in-game image, using fallback grid")
                continue
            cols, rows, cells, icon_only = extract_area(img)
            closed = close_perimeter(cells)
            # the rips' empty-lattice frame can exceed the SNES search window
            dx, dy, matches = align(cells, cols, rows, tiles,
                                    area["cols"], area["rows"],
                                    search=range(-16, 33))
            drawn = {(x - dx, y - dy): v for (x, y), v in cells.items()}
            overridden = apply_cell_overrides(drawn, ov)
            merged, tileless = merge_cells(tiles, drawn)
            undrawn = sum(1 for c in merged if "k" not in c)
            # Trim the render viewport to the tile grid + margin: the source
            # framing is arbitrary ripper padding, and GuessMap paints the
            # empty lattice across the whole canvas anyway.
            mapobj = {
                "cols": area["cols"] + 2 * VIEW_MARGIN,
                "rows": area["rows"] + 2 * VIEW_MARGIN,
                "dx": VIEW_MARGIN, "dy": VIEW_MARGIN,
                "glyphs": [], "bands": [], "connectors": [],
                "source": "ingame",
            }
            patched_areas.append((area, merged, mapobj))
            ndoors = sum(len(v.get("doors", [])) for v in drawn.values())
            nalt = sum(1 for v in drawn.values() if v.get("fill"))
            print(f"  {area['id']}: {cols}x{rows} map, {len(merged)} cells "
                  f"({undrawn} undrawn), offset ({dx},{dy}), {matches} aligned "
                  f"of {len(cells)} drawn, {ndoors} door pips, {nalt} alt-fill "
                  f"cells, {closed} edges closed, {overridden} cells overridden")
            if icon_only:
                print(f"    note: icon-only cells (fill displaced by a station "
                      f"icon): {[(x - dx, y - dy) for (x, y) in icon_only]}")
            if tileless:
                print(f"    WARNING: {len(tileless)} cell(s) drawn by the pause map "
                      f"have no tile behind them: {tileless}\n"
                      f"    They'd be tile-less targets — add them to includeCells "
                      f"in maps.config.json.")
        if aborted:
            continue
        for area, cells, mapobj in patched_areas:
            area["cells"] = cells
            area["map"] = mapobj
        data_file.write_text(json.dumps(data, indent=2))
        print(f"patched {data_file.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
