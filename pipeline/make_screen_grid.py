"""Generate a transparent PNG of bright red screen-sized grid lines.

Layer it over a raw source map in an image editor to eyeball where the
screen boundaries actually fall, and what offset makes the slice line up.

    python pipeline/make_screen_grid.py
    python pipeline/make_screen_grid.py --offset-x 8 --offset-y -4
    python pipeline/make_screen_grid.py -W 6960 -H 3680 --cell 240 160 --width 2

Writes pipeline/debug/screen_grid.png by default (override with -o).
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

DEBUG_DIR = Path(__file__).parent / "debug"


def make_grid(
    width: int,
    height: int,
    cell_w: int,
    cell_h: int,
    offset_x: int,
    offset_y: int,
    line_width: int,
    color: tuple,
    opaque: bool,
) -> Image.Image:
    bg = (0, 0, 0, 255) if opaque else (0, 0, 0, 0)
    img = Image.new("RGBA", (width, height), bg)
    draw = ImageDraw.Draw(img)

    # Lines are drawn with their left/top edge on the boundary, so the pixel
    # column at `x` is the first pixel of the screen starting there.
    x = offset_x % cell_w
    while x < width:
        draw.rectangle([x, 0, x + line_width - 1, height - 1], fill=color)
        x += cell_w

    y = offset_y % cell_h
    while y < height:
        draw.rectangle([0, y, width - 1, y + line_width - 1], fill=color)
        y += cell_h

    return img


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-W", "--image-width", type=int, default=6960)
    p.add_argument("-H", "--image-height", type=int, default=3680)
    p.add_argument("--cell", type=int, nargs=2, metavar=("W", "H"), default=[240, 160])
    p.add_argument("--offset-x", type=int, default=0, help="shift the vertical lines right by N px")
    p.add_argument("--offset-y", type=int, default=0, help="shift the horizontal lines down by N px")
    p.add_argument("--width", type=int, default=1, dest="line_width", help="line thickness in px")
    p.add_argument("--color", default="255,0,0,255", help="R,G,B[,A] of the lines")
    p.add_argument("--opaque", action="store_true", help="black background instead of transparent")
    p.add_argument("-o", "--out", type=Path, default=None)
    args = p.parse_args()

    color = tuple(int(c) for c in args.color.split(","))
    if len(color) == 3:
        color += (255,)

    cell_w, cell_h = args.cell
    img = make_grid(
        args.image_width,
        args.image_height,
        cell_w,
        cell_h,
        args.offset_x,
        args.offset_y,
        args.line_width,
        color,
        args.opaque,
    )

    out = args.out
    if out is None:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        suffix = f"_{args.offset_x}_{args.offset_y}" if (args.offset_x or args.offset_y) else ""
        out = DEBUG_DIR / f"screen_grid{suffix}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)

    cols = -(-args.image_width // cell_w)
    rows = -(-args.image_height // cell_h)
    print(f"{out}  {args.image_width}x{args.image_height}  {cols}x{rows} screens of {cell_w}x{cell_h}")


if __name__ == "__main__":
    main()
