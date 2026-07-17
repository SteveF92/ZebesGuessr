#!/usr/bin/env python3
"""Slice raw area maps into per-cell tiles + game data JSON.

Requires Pillow (pip install pillow). Reads Images/raw/<game>/<area>.png
(produced by download_maps.py) and writes:

    public/tiles/<game>/<area>/cell_<x>_<y>.png   (one playable cell each)
    public/tiles/<game>/<area>/map.png            (downscaled guess map)
    public/data/<game>.json                       (grid + playable cells)
    pipeline/debug/<game>/<area>_grid.png         (grid overlay, for alignment checks)

Run for one game with `python pipeline/slice_maps.py <game-id>`.

Cells are cellSize square (SNES games) or cellWidth x cellHeight (GBA games,
one 240x160 screen per map cell). A cell counts as "playable" if enough of it
is non-background; `background` in maps.config.json names the sheet's empty
color ("black" default, "white" for the vgmaps GBA rips). Tune FILL_THRESHOLD
if too many junk tiles (labels, logos) get through.
"""
import json
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # area maps are huge; they're trusted local files

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())

# Fraction of pixels in a cell that must be non-background.
FILL_THRESHOLD = 0.12
DARK_CUTOFF = 16  # 0-255 grayscale: brighter than this = content on black sheets
WHITE_CUTOFF = 240  # darker than this = content on white sheets


def cell_playable(gray: Image.Image, x0: int, y0: int, cw: int, ch: int, bg: str) -> bool:
    cell = gray.crop((x0, y0, x0 + cw, y0 + ch))
    hist = cell.histogram()
    content = sum(hist[:WHITE_CUTOFF]) if bg == "white" else sum(hist[DARK_CUTOFF:])
    return content / (cw * ch) >= FILL_THRESHOLD


def process_game(game_id: str, game: dict) -> None:
    cw = game.get("cellWidth", game.get("cellSize"))
    ch = game.get("cellHeight", game.get("cellSize"))
    bg = game.get("background", "black")
    map_px = game["guessMapCellPx"]
    # Refuse to write a partial JSON: a rerun without every raw image present
    # (Images/raw is gitignored) must never gut the committed game data.
    missing = [a["id"] for a in game["areas"]
               if not next((ROOT / "Images" / "raw" / game_id).glob(f"{a['id']}.*"), None)]
    if missing:
        print(f"  SKIPPING {game_id}: missing raw images for {missing} - run download_maps.py first")
        return
    data = {
        "game": game_id,
        "title": game["title"],
        "mapStyle": game.get("mapStyle", "snes"),
        "cellSize": cw,
        **({"cellWidth": cw, "cellHeight": ch} if cw != ch else {}),
        "guessMapCellPx": map_px,
        "areas": [],
        "roomNames": load_room_names(game_id),
    }
    for area in game["areas"]:
        raw = next((ROOT / "Images" / "raw" / game_id).glob(f"{area['id']}.*"))
        img = Image.open(raw).convert("RGB")
        ox, oy = area.get("offsetX", 0), area.get("offsetY", 0)
        # extraCols/extraRows extend the grid past the source image for rooms
        # the in-game map places where the sheet has no pixels (a collage that
        # compacted a sub-area, or a rip that cropped its last column); cells
        # out there exist only via includeCells + cellCropOffsets.
        cols = (img.width - ox) // cw + area.get("extraCols", 0)
        rows = (img.height - oy) // ch + area.get("extraRows", 0)
        rx = (img.width - ox) % cw
        ry = (img.height - oy) % ch
        if rx or ry:
            print(f"  note: {area['id']} has {rx}x{ry}px remainder - check offsets in maps.config.json")
        gray = img.convert("L")
        tile_dir = ROOT / "public" / "tiles" / game_id / area["id"]
        tile_dir.mkdir(parents=True, exist_ok=True)

        excluded = {tuple(c) for c in area.get("excludeCells", [])}
        # dark rooms (mostly background-colored on the detail map) fall under
        # FILL_THRESHOLD even though they're real, in-game-mapped rooms; force
        # them in by cell.
        forced = {tuple(c) for c in area.get("includeCells", [])}
        # A few rooms are drawn away from their logical grid slot (the in-game
        # map even shows a displacement arrow, e.g. Brinstar's Energy Tank).
        # Pull those cells' screenshots from an offset source rectangle so the
        # tile shows the actual room, not the empty grid slot it maps to.
        crop_offsets = {tuple(int(v) for v in k.split(",")): tuple(o)
                        for k, o in area.get("cellCropOffsets", {}).items()}
        cells = []
        for y in range(rows):
            for x in range(cols):
                # includeCells beats excludeCells: a relocated room can occupy
                # a grid slot whose on-sheet pixels belong to a different room
                # (main-deck's displaced lower cluster).
                if (x, y) in excluded and (x, y) not in forced:
                    continue
                x0, y0 = ox + x * cw, oy + y * ch
                # past the image edge only forced cells exist (PIL pads crops
                # with black, which would read as "content" on white sheets)
                if (x0 + cw > img.width or y0 + ch > img.height) and (x, y) not in forced:
                    continue
                if (x, y) in forced or cell_playable(gray, x0, y0, cw, ch, bg):
                    cells.append([x, y])
                    dxp, dyp = crop_offsets.get((x, y), (0, 0))
                    img.crop((x0 + dxp, y0 + dyp,
                              x0 + dxp + cw, y0 + dyp + ch)).save(
                        tile_dir / f"cell_{x}_{y}.png", optimize=True
                    )

        # Downscaled guess map (in-game-map vibe: detail lost, shapes kept).
        # Blank out excluded cells (credits banner, minimap inset) first.
        blank = (255, 255, 255) if bg == "white" else (0, 0, 0)
        clean = img.crop((ox, oy, ox + cols * cw, oy + rows * ch))
        for (ex, ey) in excluded:
            clean.paste(blank, (ex * cw, ey * ch, (ex + 1) * cw, (ey + 1) * ch))
        guess = clean.resize((cols * map_px, rows * round(map_px * ch / cw)), Image.BOX)
        guess.save(tile_dir / "map.png", optimize=True)

        # Debug overlay for alignment checking
        debug_dir = ROOT / "pipeline" / "debug" / game_id
        debug_dir.mkdir(parents=True, exist_ok=True)
        dbg = img.resize((img.width // 4, img.height // 4))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(dbg)
        for gx in range(cols + 1):
            draw.line([(ox + gx * cw) // 4, oy // 4, (ox + gx * cw) // 4, (oy + rows * ch) // 4], fill=(255, 0, 255))
        for gy in range(rows + 1):
            draw.line([ox // 4, (oy + gy * ch) // 4, (ox + cols * cw) // 4, (oy + gy * ch) // 4], fill=(255, 0, 255))
        for (cx, cy) in cells:
            draw.rectangle(
                [(ox + cx * cw) // 4 + 2, (oy + cy * ch) // 4 + 2,
                 (ox + (cx + 1) * cw) // 4 - 2, (oy + (cy + 1) * ch) // 4 - 2],
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
    # Indented so Prettier keeps objects expanded, matching committed
    # formatting; the extractors rewrite this file the same way.
    (out / f"{game_id}.json").write_text(json.dumps(data, indent=2))
    print(f"wrote public/data/{game_id}.json")


def load_room_names(game_id: str) -> dict:
    """Optional community/speedrun room names, curated by hand.

    These are authored in the app's icon editor ("Name" tool) and saved to
    public/data/roomNames.<game>.json, so read that first and never overwrite
    it (same convention as glyphs/overlays). Fall back to the legacy
    pipeline/room_names/<game>.json for older data.
    """
    override = ROOT / "public" / "data" / f"roomNames.{game_id}.json"
    if override.exists():
        return json.loads(override.read_text())
    legacy = ROOT / "pipeline" / "room_names" / f"{game_id}.json"
    return json.loads(legacy.read_text()) if legacy.exists() else {}


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in CONFIG:
        raise SystemExit(f"unknown game id {only!r}; expected one of {list(CONFIG)}")
    for gid, g in CONFIG.items():
        if only and gid != only:
            continue
        print(f"== {g['title']}")
        process_game(gid, g)
