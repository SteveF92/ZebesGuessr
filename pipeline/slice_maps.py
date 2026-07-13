#!/usr/bin/env python3
"""Slice raw area maps into per-cell tiles + game data JSON.

Requires Pillow (pip install pillow). Reads Images/raw/<game>/<area>.png
(produced by download_maps.py) and writes:

    public/tiles/<game>/<area>/cell_<x>_<y>.png   (256x256 playable cells)
    public/tiles/<game>/<area>/map.png            (downscaled guess map)
    public/data/<game>.json                       (grid + playable cells)
    pipeline/debug/<game>/<area>_grid.png         (grid overlay, for alignment checks)

A cell counts as "playable" if enough of it is non-background. Tune
FILL_THRESHOLD if too many junk tiles (labels, logos) get through.
"""
import json
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # area maps are huge; they're trusted local files

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())

# Fraction of pixels in a cell that must be brighter than DARK_CUTOFF.
FILL_THRESHOLD = 0.12
DARK_CUTOFF = 16  # 0-255 grayscale


def cell_playable(gray: Image.Image, x0: int, y0: int, size: int) -> bool:
    cell = gray.crop((x0, y0, x0 + size, y0 + size))
    hist = cell.histogram()
    bright = sum(hist[DARK_CUTOFF:])
    return bright / (size * size) >= FILL_THRESHOLD


def process_game(game_id: str, game: dict) -> None:
    size = game["cellSize"]
    map_px = game["guessMapCellPx"]
    data = {
        "game": game_id,
        "title": game["title"],
        "cellSize": size,
        "guessMapCellPx": map_px,
        "areas": [],
        "roomNames": load_room_names(game_id),
    }
    for area in game["areas"]:
        raw = ROOT / "Images" / "raw" / game_id / f"{area['id']}.png"
        if not raw.exists():
            print(f"MISSING {raw} - run download_maps.py first"); continue
        img = Image.open(raw).convert("RGB")
        ox, oy = area.get("offsetX", 0), area.get("offsetY", 0)
        cols = (img.width - ox) // size
        rows = (img.height - oy) // size
        rx = (img.width - ox) % size
        ry = (img.height - oy) % size
        if rx or ry:
            print(f"  note: {area['id']} has {rx}x{ry}px remainder - check offsets in maps.config.json")
        gray = img.convert("L")
        tile_dir = ROOT / "public" / "tiles" / game_id / area["id"]
        tile_dir.mkdir(parents=True, exist_ok=True)

        excluded = {tuple(c) for c in area.get("excludeCells", [])}
        cells = []
        for y in range(rows):
            for x in range(cols):
                if (x, y) in excluded:
                    continue
                x0, y0 = ox + x * size, oy + y * size
                if cell_playable(gray, x0, y0, size):
                    cells.append([x, y])
                    img.crop((x0, y0, x0 + size, y0 + size)).save(
                        tile_dir / f"cell_{x}_{y}.png", optimize=True
                    )

        # Downscaled guess map (in-game-map vibe: detail lost, shapes kept).
        # Black out excluded cells (credits banner, minimap inset) first.
        clean = img.crop((ox, oy, ox + cols * size, oy + rows * size))
        for (ex, ey) in excluded:
            clean.paste((0, 0, 0), (ex * size, ey * size, (ex + 1) * size, (ey + 1) * size))
        guess = clean.resize((cols * map_px, rows * map_px), Image.BOX)
        guess.save(tile_dir / "map.png", optimize=True)

        # Debug overlay for alignment checking
        debug_dir = ROOT / "pipeline" / "debug" / game_id
        debug_dir.mkdir(parents=True, exist_ok=True)
        dbg = img.resize((img.width // 4, img.height // 4))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(dbg)
        for gx in range(cols + 1):
            draw.line([(ox + gx * size) // 4, oy // 4, (ox + gx * size) // 4, (oy + rows * size) // 4], fill=(255, 0, 255))
        for gy in range(rows + 1):
            draw.line([ox // 4, (oy + gy * size) // 4, (ox + cols * size) // 4, (oy + gy * size) // 4], fill=(255, 0, 255))
        for (cx, cy) in cells:
            draw.rectangle(
                [(ox + cx * size) // 4 + 2, (oy + cy * size) // 4 + 2,
                 (ox + (cx + 1) * size) // 4 - 2, (oy + (cy + 1) * size) // 4 - 2],
                outline=(0, 255, 0),
            )
        dbg.save(debug_dir / f"{area['id']}_grid.png")

        data["areas"].append({
            "id": area["id"],
            "name": area["name"],
            "cols": cols,
            "rows": rows,
            "mapImage": f"tiles/{game_id}/{area['id']}/map.png",
            "cells": [{"x": x, "y": y} for x, y in cells],
        })
        print(f"  {area['name']}: {cols}x{rows} grid, {len(cells)} playable cells")

    out = ROOT / "public" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{game_id}.json").write_text(json.dumps(data))
    print(f"wrote public/data/{game_id}.json")


def load_room_name