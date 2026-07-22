#!/usr/bin/env python3
"""Stamp landmark sprites and alternate-state tile overrides onto the raw maps.

The vgmaps GBA rips draw boss arenas empty — unlike the Super Metroid sheets,
which had bosses and the ship drawn in. This step composites hand-cut,
alpha-transparent poses (pipeline/sprites/<game>/) onto Images/raw/<game>/
between download and slice, so the landmark art flows into the sliced tiles
(mystery screens and the X-Ray overlay both render those):

    download_maps.py -> composite_landmarks.py -> slice_maps.py
        -> mirror_kept_tiles.py -> extract_*.py

Placements live in pipeline/landmarks.<game>.json, keyed by area id, each
stamp { "sprite": "<path>", "x": <px>, "y": <px> } in raw source-map pixel
coordinates (sprite top-left). "sprite" is relative to pipeline/sprites/<game>/
with an optional single category level ("bosses/box.png") — the category dirs
group the editor's thumbnail palette. Tweak a placement by editing the numbers and
rerunning this + slice_maps.py — or hand-layer the sprites in an image editor
instead: save the flattened map to pipeline/source-maps/<game>/<area>.png,
flag the area "localSource": true, and delete its entries here.

This step also applies tile overrides: whole-screen replacements that swap a
cell's source art for an alternate room state (Fusion rooms change through the
story, and a rip captures only one moment of it). Placements live in
pipeline/tileOverrides.<game>.json, keyed by area id, each entry
{ "x": <cell>, "y": <cell>, "image": "<path>", "sx": <px>, "sy": <px> } in
TILE coordinates — an override targets a whole cell, so it uses the same
coordinate system as everything else in the repo. "image" is relative to
pipeline/ (sources live in pipeline/tile-sources/<game>/<area>/, committed
byte-identical to their upstream origin so provenance stays checkable);
"sx"/"sy" (default 0) crop a cellWidth x cellHeight screen out of a larger
room render. Overrides are pasted before landmark stamping so stamps land on
top, exactly as slicing will see them. A keepTiles cell's tile PNG is never
rewritten by the slicer, so neither an override nor a stamp reaches it from
here — mirror_kept_tiles.py mirrors them in afterwards.

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


def paste_overrides(img, entries, area, cw, ch, ox, oy):
    # Same coordinate math as slice_maps.py, cellCropOffsets included, so an
    # override on a displaced cell lands where the slicer will crop.
    area_id = area["id"]
    crop_offsets = {tuple(int(v) for v in k.split(",")): tuple(o)
                    for k, o in area.get("cellCropOffsets", {}).items()}
    kept = {tuple(c) for c in area.get("keepTiles", [])}
    for o in entries:
        src_path = ROOT / "pipeline" / o["image"]
        if not src_path.exists():
            raise SystemExit(f"{area_id}: override image missing: {o['image']}")
        src = Image.open(src_path).convert("RGBA")
        sx, sy = o.get("sx", 0), o.get("sy", 0)
        if sx + cw > src.width or sy + ch > src.height:
            raise SystemExit(f"{area_id}: ({o['x']},{o['y']}) crop ({sx},{sy})+"
                             f"{cw}x{ch} exceeds {o['image']} ({src.width}x{src.height})")
        patch = src.crop((sx, sy, sx + cw, sy + ch))
        # transparent pixels would silently turn into garbage RGB at save time;
        # an override is a wholesale opaque screen, so refuse them outright
        if patch.getextrema()[3][0] < 255:
            raise SystemExit(f"{area_id}: ({o['x']},{o['y']}) crop of {o['image']} "
                             "has transparent pixels - adjust sx/sy or pre-flatten")
        dxp, dyp = crop_offsets.get((o["x"], o["y"]), (0, 0))
        px, py = ox + o["x"] * cw + dxp, oy + o["y"] * ch + dyp
        if px < 0 or py < 0 or px + cw > img.width or py + ch > img.height:
            raise SystemExit(f"{area_id}: ({o['x']},{o['y']}) paste at ({px},{py}) "
                             "is outside the raw image")
        if (o["x"], o["y"]) in kept:
            print(f"  note: {area_id}: override at ({o['x']},{o['y']}) targets a "
                  "keepTiles cell - the slicer skips that tile, so "
                  "mirror_kept_tiles.py has to run to reach it")
        img.paste(patch, (px, py))
        print(f"  {area_id}: tile override ({o['x']},{o['y']}) <- {o['image']} @ ({sx},{sy})")


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
    raw_dir = ROOT / "Images" / "raw" / game_id
    areas = {a["id"]: a for a in game["areas"]}
    for aid in list(landmarks) + list(overrides):
        if aid not in areas:
            raise SystemExit(f"{game_id}: manifest names unknown area {aid!r}")
    print(f"== {game['title']}")
    for area_id in [a["id"] for a in game["areas"]
                    if a["id"] in landmarks or a["id"] in overrides]:
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
        paste_overrides(img, overrides.get(area_id, []), areas[area_id],
                        cw, ch, ox, oy)
        for s in landmarks.get(area_id, []):
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
