"""Shared plumbing for the pause-map extractors.

Both extract_ingame_maps.py (SNES-style hand-drawn recreations) and
extract_gba_maps.py (GBA tile-art rips) quantize an in-game map image onto a
cell grid, align it to the sliced tile grid, and fold the draw data onto the
one cell list in public/data/<game>.json. Everything here is style-agnostic;
the pixel classification itself lives in each extractor.

The working cell value is a dict {"kind", "walls"} plus optional "dir" (SNES
stair direction), "fill" (GBA fill-variant index), and "doors" (GBA door pips,
["Nr", "Eb", ...]); merge_cells maps those onto the compact JSON fields
k/w/d/f/dr.
"""
import json
from collections import deque
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent

N, E, S, W = 1, 2, 4, 8


def mask(im: np.ndarray, color) -> np.ndarray:
    return np.all(im == color, axis=2)


def detect_phase(solid: np.ndarray, cell: int) -> tuple[int, int]:
    """Find the grid phase by edge-energy voting: cell boundaries are where
    the solid mask flips most often."""
    dx = np.abs(np.diff(solid.astype(int), axis=1)).sum(axis=0)
    dy = np.abs(np.diff(solid.astype(int), axis=0)).sum(axis=1)
    ox = int(np.argmax([dx[o::cell].sum() for o in range(cell)]))
    oy = int(np.argmax([dy[o::cell].sum() for o in range(cell)]))
    return (ox + 1) % cell, (oy + 1) % cell


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


def close_perimeter(cells: dict) -> int:
    """Wall off exterior room edges the wall detector missed.

    A room whose source outline is thin can end up with an open side facing
    empty space. Any room-cell side with no occupied neighbour is a map
    boundary and must show a wall, so OR those bits in. Only adds walls on
    exterior sides — never between two occupied cells, and never touches
    shaft/diag cells (which render no walls). Returns the number of edges
    closed.
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


def align(map_cells, mcols, mrows, tile_cells, tcols, trows,
          search: range = range(-12, 21)):
    """Cross-correlate the extracted map occupancy against the sliced tile
    grid; returns (dx, dy, matches) for the best overlap."""
    occ = np.zeros((mrows, mcols), bool)
    for (x, y) in map_cells:
        occ[y, x] = True
    ours = np.zeros((trows, tcols), bool)
    for c in tile_cells:
        ours[c["y"], c["x"]] = True
    best = (-1, 0, 0)
    for dy in search:
        for dx in search:
            s = 0
            for (cy, cx) in zip(*np.nonzero(ours)):
                my, mx = cy + dy, cx + dx
                if 0 <= my < mrows and 0 <= mx < mcols and occ[my, mx]:
                    s += 1
            if s > best[0]:
                best = (s, dx, dy)
    return best[1], best[2], best[0]


def load_map_overrides(game_id: str) -> dict:
    """Hand-tuned map fixes the extractor can't reproduce, authored by hand in
    mapOverrides.<game>.json and applied on top of extraction (never written by
    the extractors — same convention as glyphs/overlays). Tile coordinates,
    keyed by areaId:

        { "<areaId>": { "cells": [{x, y, k, w, [d], [f], [dr]}, ...],
                        "bands": [{"poly": [[x, y], ...]}, ...] } }

    ``cells`` upserts a cell's draw data by (x, y) — used to reclassify a room
    as a stair (`diag`) or to draw rooms the pixel heuristics miss. ``bands``
    replaces the area's whole band list (the auto-fitted stair polygons look
    rough; these are drawn by hand). Both are applied after alignment, so they
    are expressed in the same tile coordinates as everything else.
    """
    f = ROOT / "public" / "data" / f"mapOverrides.{game_id}.json"
    return json.loads(f.read_text()) if f.exists() else {}


def apply_cell_overrides(drawn: dict, ov: dict | None) -> int:
    """Upsert hand-authored draw data into the tile-keyed grid."""
    if not ov or "cells" not in ov:
        return 0
    for c in ov["cells"]:
        v = {"kind": c["k"], "walls": c["w"]}
        if "d" in c:
            v["dir"] = c["d"]
        if "f" in c:
            v["fill"] = c["f"]
        if "dr" in c:
            v["doors"] = c["dr"]
        drawn[(c["x"], c["y"])] = v
    return len(ov["cells"])


def _cell_json(x: int, y: int, v: dict | None) -> dict:
    cell = {"x": x, "y": y}
    if v:
        cell["k"] = v["kind"]
        cell["w"] = v["walls"]
        if "dir" in v:
            cell["d"] = v["dir"]
        if v.get("fill"):
            cell["f"] = v["fill"]
        if v.get("doors"):
            cell["dr"] = v["doors"]
    return cell


def merge_cells(tiles: list, drawn: dict) -> tuple[list, list]:
    """Fold the extraction's draw data onto the sliced tile list.

    One cell list per area, in tile coordinates. Every tile is a cell; a cell
    that the pause map draws also carries `k`/`w` (plus `d`/`f`/`dr` where the
    style uses them), and one it doesn't — an elevator shaft or tube run,
    whose rails never become geometry — carries no draw data and simply isn't
    drawn. That's the whole distinction: "what to draw, if anything". Whether
    a cell is *served* as a target is difficulty's job, not this list's.

    Returns (cells, drawn_but_tileless): the second is cells the pause map
    draws that have no tile behind them. That should always be empty — it
    means the sliced map has a hole the pause map doesn't (a dark room under
    the fill threshold, usually). They're kept so the map still renders, but
    they'd be tile-less targets, so the caller warns: fix with `includeCells`.
    """
    have = {(c["x"], c["y"]) for c in tiles}
    out = [_cell_json(c["x"], c["y"], drawn.get((c["x"], c["y"]))) for c in tiles]
    tileless = sorted(set(drawn) - have)
    out += [_cell_json(x, y, drawn[(x, y)]) for (x, y) in tileless]
    out.sort(key=lambda c: (c["y"], c["x"]))  # row-major, matching slice_maps
    return out, tileless


def fallback_cells(area):
    """No pause-map image: synthesize draw data from the tile grid itself."""
    occ = {(c["x"], c["y"]) for c in area["cells"]}
    cells = []
    for (x, y) in sorted(occ, key=lambda t: (t[1], t[0])):
        walls = 0
        if (x, y - 1) not in occ: walls |= N
        if (x + 1, y) not in occ: walls |= E
        if (x, y + 1) not in occ: walls |= S
        if (x - 1, y) not in occ: walls |= W
        cells.append({"x": x, "y": y, "k": "room", "w": walls})
    return cells


def find_ingame_image(game_id: str, area_id: str) -> Path | None:
    """In-game images keep their source extension (.webp, .png, ...)."""
    return next((ROOT / "Images" / "raw" / game_id / "ingame").glob(f"{area_id}.*"), None)
