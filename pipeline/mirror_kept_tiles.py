#!/usr/bin/env python3
"""Mirror landmark stamps and tile overrides into the keepTiles tiles.

slice_maps.py never rewrites a keepTiles tile - that is the whole point of the
flag, since those PNGs are hand-painted to fill a partial source screen. But
composite_landmarks.py paints stamps and overrides onto the *source map*, so
anything it lands on a kept cell dies at the slice step and the served tile
keeps whatever it had. That gap used to be closed by hand ("mirror it into the
committed tile at the same in-tile offset"), which quietly went stale every
time a stamp moved or was deleted.

This script closes it mechanically. It runs after slicing:

    composite_landmarks.py -> slice_maps.py -> mirror_kept_tiles.py -> extract_*.py

For every kept cell an override or stamp touches, the tile is rebuilt as

    base  ->  tile override (whole screen)  ->  stamps, in manifest order

exactly the order and geometry composite_landmarks.py uses on the source map
(cellCropOffsets included, so a displaced cell mirrors where the slicer crops).

"base" is the hand-painted art with nothing mirrored into it, kept in
pipeline/tile-bases/<game>/<area>/cell_<x>_<y>.png and committed alongside the
tile. It is seeded from the current committed tile the first time a cell needs
one - so seed a cell whose tile is *clean*, or the old art is baked into the
base forever (see the WARNING it prints). Rebuilding from a stored base, rather
than compositing onto the live tile, is what makes this idempotent: a moved
stamp leaves no ghost, and a stamp that goes away restores the tile from its
base and drops the base file, the same pruning slice_maps.py does for orphaned
tiles.
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())


def cell_rect(area, x, y, cw, ch):
    """Source-map rect slice_maps.py crops for this cell."""
    crop_offsets = {tuple(int(v) for v in k.split(",")): tuple(o)
                    for k, o in area.get("cellCropOffsets", {}).items()}
    dxp, dyp = crop_offsets.get((x, y), (0, 0))
    return (area.get("offsetX", 0) + x * cw + dxp,
            area.get("offsetY", 0) + y * ch + dyp)


def rebuild(base, overrides, stamps, sprites_dir, x0, y0, cw, ch):
    """base + override + stamps, in composite_landmarks.py's order."""
    canvas = base.convert("RGBA")
    for o in overrides:
        src = Image.open(ROOT / "pipeline" / o["image"]).convert("RGBA")
        sx, sy = o.get("sx", 0), o.get("sy", 0)
        canvas.paste(src.crop((sx, sy, sx + cw, sy + ch)), (0, 0))
    for s in stamps:
        sprite = Image.open(sprites_dir / s["sprite"]).convert("RGBA")
        # a stamp may start outside the cell (it spans several); paste into a
        # transparent layer, which clips negatives, then composite that
        layer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        layer.paste(sprite, (s["x"] - x0, s["y"] - y0))
        canvas.alpha_composite(layer)
    return canvas.convert("RGB")


def process_game(game_id: str, game: dict) -> None:
    landmarks_path = ROOT / "pipeline" / f"landmarks.{game_id}.json"
    overrides_path = ROOT / "pipeline" / f"tileOverrides.{game_id}.json"
    landmarks = json.loads(landmarks_path.read_text()) if landmarks_path.exists() else {}
    overrides = json.loads(overrides_path.read_text()) if overrides_path.exists() else {}
    if not landmarks and not overrides:
        return
    cw = game.get("cellWidth", game.get("cellSize"))
    ch = game.get("cellHeight", game.get("cellSize"))
    sprites_dir = ROOT / "pipeline" / "sprites" / game_id
    print(f"== {game['title']}")
    for area in game["areas"]:
        area_id = area["id"]
        kept = {tuple(c) for c in area.get("keepTiles", [])}
        base_dir = ROOT / "pipeline" / "tile-bases" / game_id / area_id
        tile_dir = ROOT / "public" / "tiles" / game_id / area_id
        if not kept and not base_dir.exists():
            continue

        # what lands on each kept cell: overrides target one cell, stamps cover
        # every cell their sprite rect intersects
        work: dict[tuple[int, int], tuple[list, list]] = {}
        for o in overrides.get(area_id, []):
            if (o["x"], o["y"]) in kept:
                work.setdefault((o["x"], o["y"]), ([], []))[0].append(o)
        for s in landmarks.get(area_id, []):
            sprite = Image.open(sprites_dir / s["sprite"])
            for (x, y) in kept:
                x0, y0 = cell_rect(area, x, y, cw, ch)
                if (s["x"] < x0 + cw and s["x"] + sprite.width > x0
                        and s["y"] < y0 + ch and s["y"] + sprite.height > y0):
                    work.setdefault((x, y), ([], []))[1].append(s)

        for (x, y), (cell_overrides, stamps) in sorted(work.items()):
            tile_path = tile_dir / f"cell_{x}_{y}.png"
            if not tile_path.exists():
                print(f"  WARNING {area_id}: ({x},{y}) has no tile - not a playable cell?")
                continue
            base_path = base_dir / f"cell_{x}_{y}.png"
            if not base_path.exists():
                base_dir.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(tile_path, base_path)
                print(f"  WARNING {area_id}: seeded a tile base for ({x},{y}) from the "
                      "committed tile - check it holds no already-mirrored art")
            x0, y0 = cell_rect(area, x, y, cw, ch)
            out = rebuild(Image.open(base_path), cell_overrides, stamps,
                          sprites_dir, x0, y0, cw, ch)
            out.save(tile_path, optimize=True)
            what = [o["image"].split("/")[-1] for o in cell_overrides] + [s["sprite"] for s in stamps]
            print(f"  {area_id}: mirrored into kept tile ({x},{y}) <- {', '.join(what)}")

        # Nothing lands there any more: put the hand-painted art back and drop
        # the base, so a removed stamp leaves no ghost (a cell that also lost
        # its keepTiles flag is sliced from source now - just drop the base).
        for stale in sorted(base_dir.glob("cell_*.png")) if base_dir.exists() else []:
            x, y = (int(v) for v in stale.stem.split("_")[1:])
            if (x, y) in work:
                continue
            tile_path = tile_dir / stale.name
            if (x, y) in kept and tile_path.exists():
                shutil.copyfile(stale, tile_path)
                print(f"  {area_id}: restored kept tile ({x},{y}) from its base")
            stale.unlink()
        if base_dir.exists() and not any(base_dir.iterdir()):
            base_dir.rmdir()


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in CONFIG:
        raise SystemExit(f"unknown game id {only!r}; expected one of {list(CONFIG)}")
    for gid, g in CONFIG.items():
        if only and gid != only:
            continue
        process_game(gid, g)
