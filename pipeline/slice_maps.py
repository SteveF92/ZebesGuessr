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


def void_to_alpha(tile: Image.Image, bg: str) -> Image.Image:
    """Turn border-connected void (the sheet's background color) transparent.

    For areas flagged `transparentVoid`, the X-Ray overlay shouldn't paint the
    sheet's empty ocean over the map recreation. Flood-fill from the tile
    edges rather than color-keying globally, so a pure-white/black pixel
    *inside* room art (a highlight, a flash frame) survives; only void that
    touches the border is keyed out.
    """
    import numpy as np

    arr = np.array(tile.convert("RGB"))
    key = 255 if bg == "white" else 0
    mask = (arr == key).all(axis=2)
    reach = np.zeros_like(mask)
    reach[0, :] = mask[0, :]
    reach[-1, :] = mask[-1, :]
    reach[:, 0] = mask[:, 0]
    reach[:, -1] = mask[:, -1]
    while True:  # grow one pixel per pass until the fill stops moving
        grow = reach.copy()
        grow[1:, :] |= reach[:-1, :]
        grow[:-1, :] |= reach[1:, :]
        grow[:, 1:] |= reach[:, :-1]
        grow[:, :-1] |= reach[:, 1:]
        grow &= mask
        if (grow == reach).all():
            break
        reach = grow
    alpha = np.where(reach, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def process_game(game_id: str, game: dict) -> None:
    cw = game.get("cellWidth", game.get("cellSize"))
    ch = game.get("cellHeight", game.get("cellSize"))
    game_bg = game.get("background", "black")
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
        # Background is usually a game-wide constant, but a single area can rip
        # differently (Fusion's sector-3 detail map is a black-void sheet while
        # its siblings are white-void); an area override picks the right
        # fill-threshold polarity so only rooms - not the void - count as tiles.
        bg = area.get("background", game_bg)
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
        # Hand-edited tiles: cells whose source screen is a partial view (a
        # room clipped by the sheet edge, or a game-side quirk) that was
        # hand-painted to fill the frame. Their committed PNG must not be
        # regenerated from source, or the edit is lost on every refresh. The
        # cell stays playable and in the JSON; only the tile write is skipped
        # (a first run with no PNG yet still writes the base to edit from).
        kept = {tuple(c) for c in area.get("keepTiles", [])}
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
                    tile_path = tile_dir / f"cell_{x}_{y}.png"
                    if (x, y) in kept and tile_path.exists():
                        continue  # preserve the hand-edited tile
                    dxp, dyp = crop_offsets.get((x, y), (0, 0))
                    tile = img.crop((x0 + dxp, y0 + dyp,
                                     x0 + dxp + cw, y0 + dyp + ch))
                    if area.get("transparentVoid", game.get("transparentVoid", False)):
                        tile = void_to_alpha(tile, bg)
                    tile.save(tile_path, optimize=True)

        # Prune tiles for cells that are no longer playable (e.g. a cell newly
        # dropped via excludeCells), so a rerun leaves no orphaned PNGs behind
        # and the tiles dir always matches the JSON's cell list.
        keep = {f"cell_{x}_{y}.png" for x, y in cells}
        for stale in tile_dir.glob("cell_*.png"):
            if stale.name not in keep:
                stale.unlink()

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

        entry = {
            "id": area["id"],
            "name": area["name"],
            "cols": cols,
            "rows": rows,
            "mapImage": f"tiles/{game_id}/{area['id']}/map.png",
            "cells": [{"x": x, "y": y} for x, y in cells],
        }
        # Off-grid rooms (drawn shifted from their map slot so doors line up
        # on the sheet, e.g. ZM Brinstar's save room at 16px below the grid):
        # their cellCropOffsets entry captures the true art in the tile, and
        # this mirrors the same pixel shift into the JSON so the X-Ray overlay
        # can draw the tile back at its true position. A separate key because
        # not every crop offset wants it — a *relocated* room (Fusion's
        # Restricted Zone) pulls art from elsewhere but its map slot IS the
        # true position, so its X-Ray draw must stay unshifted.
        if area.get("xrayOffsets"):
            entry["xrayOffsets"] = area["xrayOffsets"]
        # The polished alternative: cells (as "x,y") whose X-Ray overlay draws
        # a committed hand-made xray_<x>_<y>.png (grid-aligned, the full-slot
        # truth - e.g. the strip above an off-grid room painted in) instead of
        # the guess tile. Beats an xrayOffsets shift when the vacated band
        # would show bare recreation fill. The files live beside the cell
        # tiles and are never generated or pruned here (the prune glob only
        # matches cell_*.png). Pair with an includeCells+keepTiles cell where
        # overhanging art (an off-grid room's floor) needs its own slot.
        if area.get("xrayTiles"):
            entry["xrayTiles"] = area["xrayTiles"]
            for key in area["xrayTiles"]:
                kx, ky = key.split(",")
                if not (tile_dir / f"xray_{kx}_{ky}.png").exists():
                    print(f"  WARNING: {area['id']} xrayTiles {key} has no "
                          f"xray_{kx}_{ky}.png in {tile_dir}")
        data["areas"].append(entry)
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
