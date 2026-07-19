#!/usr/bin/env python3
"""Cut one landmark sprite out of a sprite sheet.

Crops a rect from a sheet, optionally color-keys a background to alpha, trims
to the opaque bounding box, and writes an RGBA PNG ready for the editor's
Landmark palette. Typical use while adding a landmark:

    python pipeline/cut_sprite.py sheet.png 34 120 96 80 \\
        pipeline/sprites/metroid-fusion/barriers/eye-door-l.png --key AUTO

Then hit the palette's ↻ button in the Landmark tool — no dev-server restart.

Notes for Spriters Resource sheets: sheets with real alpha need no --key (but
their RGB under alpha-0 can be garbage — trust the alpha, not the RGB view);
sheets with a solid background (or broken alpha, like Fusion's BOX sheet) need
--key. AUTO samples the crop's top-left pixel as the key color. The trim uses
the ALPHA bbox, so opaque-black pixels survive it.
"""
import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("sheet", type=Path, help="source sprite sheet")
    ap.add_argument("x", type=int)
    ap.add_argument("y", type=int)
    ap.add_argument("w", type=int)
    ap.add_argument("h", type=int)
    ap.add_argument("out", type=Path, help="output PNG (e.g. pipeline/sprites/<game>/<category>/<name>.png)")
    ap.add_argument("--key", help="background color to make transparent: #RRGGBB, or AUTO to sample the crop's top-left pixel")
    ap.add_argument("--tolerance", type=int, default=0, help="per-channel slack when matching --key (default 0)")
    ap.add_argument("--no-trim", action="store_true", help="keep the full crop instead of trimming to the alpha bbox")
    a = ap.parse_args()

    img = Image.open(a.sheet).convert("RGBA").crop((a.x, a.y, a.x + a.w, a.y + a.h))

    if a.key:
        if a.key.upper() == "AUTO":
            key = img.getpixel((0, 0))[:3]
        else:
            s = a.key.lstrip("#")
            key = tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))
        px = img.load()
        for yy in range(img.height):
            for xx in range(img.width):
                r, g, b, alpha = px[xx, yy]
                if alpha and all(abs(c - k) <= a.tolerance for c, k in zip((r, g, b), key)):
                    px[xx, yy] = (r, g, b, 0)

    if not a.no_trim:
        bbox = img.getchannel("A").getbbox()
        if bbox is None:
            raise SystemExit("crop is fully transparent — wrong rect or key?")
        img = img.crop(bbox)

    a.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(a.out)
    print(f"{a.out} — {img.width}x{img.height}")


if __name__ == "__main__":
    main()
