#!/usr/bin/env python3
"""Stamp landmark sprites (bosses, the ship, animals) onto the raw area maps.

The vgmaps GBA rips draw boss arenas empty — unlike the Super Metroid sheets,
which had bosses and the ship drawn in. This step composites hand-cut,
alpha-transparent poses (pipeline/sprites/<game>/) onto Images/raw/<game>/
between download and slice, so the landmark art flows into the sliced tiles
(mystery screens and the X-Ray overlay both render those):

    download_maps.py -> composite_landmarks.py -> slice_maps.py -> extract_*.py

Placements live in pipeline/landmarks.<game>.json, keyed by area id, each
stamp { "sprite": "<path>", "x": <px>, "y": <px> } in raw source-map pixel
coordinates (sprite top-left). "sprite" is relative to pipeline/sprites/<game>/
with an optional single category level ("bosses/box.png") — the category dirs
group the editor's thumbnail palette. Tweak a placement by editing the numbers and
rerunning this + slice_maps.py — or hand-layer the sprites in an image editor
instead: save the flattened map to pipeline/source-maps/<game>/<area>.png,
flag the area "localSource": true, and delete its entries here.

The pristine (unstamped) copy of each touched area is kept in
Images/raw/<game>/pristine/ and stamping always restarts from it, so reruns
are idempotent and moving a stamp leaves no ghost. If you ever lose pristine/
but keep a stamped raw, delete the raw and re-run download_maps.py first.
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # area maps are huge; they're trusted local files

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())


def process_game(game_id: str, game: dict) -> None:
    manifest_path = ROOT / "pipeline" / f"landmarks.{game_id}.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text())
    cw = game.get("cellWidth", game.get("cellSize"))
    ch = game.get("cellHeight", game.get("cellSize"))
    sprites_dir = ROOT / "pipeline" / "sprites" / game_id
    raw_dir = ROOT / "Images" / "raw" / game_id
    areas = {a["id"]: a for a in game["areas"]}
    print(f"== {game['title']}")
    for area_id, stamps in manifest.items():
        raw = next(raw_dir.glob(f"{area_id}.*"), None)
        if raw is None:
            print(f"  SKIPPING {area_id}: no raw image - run download_maps.py first")
            continue
        pristine = raw_dir / "pristine" / raw.name
        if not pristine.exists():
            pristine.parent.mkdir(exist_ok=True)
            shutil.copyfile(raw, pristine)
        img = Image.open(pristine).convert("RGBA")
        ox = areas[area_id].get("offsetX", 0)
        oy = areas[area_id].get("offsetY", 0)
        for s in stamps:
            sprite = Image.open(sprites_dir / s["sprite"]).convert("RGBA")
            img.alpha_composite(sprite, (s["x"], s["y"]))
            cx0, cy0 = (s["x"] - ox) // cw, (s["y"] - oy) // ch
            cx1 = (s["x"] - ox + sprite.width - 1) // cw
            cy1 = (s["y"] - oy + sprite.height - 1) // ch
            span = f"({cx0},{cy0})" if (cx0, cy0) == (cx1, cy1) else f"({cx0},{cy0})-({cx1},{cy1})"
            print(f"  {area_id}: {s['sprite']} at ({s['x']},{s['y']}) -> cell {span}")
        img.convert("RGB").save(raw)


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in CONFIG:
        raise SystemExit(f"unknown game id {only!r}; expected one of {list(CONFIG)}")
    for gid, g in CONFIG.items():
        if only and gid != only:
            continue
        process_game(gid, g)
