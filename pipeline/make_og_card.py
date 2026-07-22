"""Generate the social-embed card (og:image) at public/og-card-v2.png.

A 1200x630 collage built entirely from committed sources: the site's palette
(src/styles.css :root), a seeded starfield + scanlines echoing the .fx-layer
treatment, one iconic baked tile per game framed with .tile-frame-style cyan
corner brackets, and the wordmark set in the Super Metroid Title font.

Deterministic (fixed RNG seed), so reruns are byte-stable enough to diff.
NOTE: the deploy uploads the card under the immutable cache rule — every
redesign after it has shipped must BUMP the filename version (og-card-v3.png,
...) and update index.html's og:image/twitter:image tags, never regenerate in
place. v1 shipped 2026-07-22 with ZM's Mother Brain; v2 swapped it for the
Chozodia mural.

Usage: python pipeline/make_og_card.py
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-card-v2.png"

W, H = 1200, 630

# src/styles.css :root palette
BG = (5, 7, 13)  # --bg
BG_GLOW = (12, 23, 48)  # body radial-gradient center (#0c1730)
TEXT = (207, 224, 255)  # --text
DIM = (207, 224, 255, 140)  # --dim
CYAN = (160, 248, 248)  # --cyan
GOLD = (255, 210, 77)  # --gold
LINE = (28, 42, 74)  # --line

TITLE_FONT = ROOT / "public" / "fonts" / "super-metroid-title.ttf"
PIXEL_FONT = ROOT / "public" / "fonts" / "super-metroid-large-alt-snes.ttf"

# One iconic screen per game, from the FINAL BAKED tiles (landmark stamps and
# room-state overrides mirrored in) — never the raw source maps.
TILES = [
    ROOT / "public" / "tiles" / "metroid-fusion" / "main-deck" / "cell_7_10.png",
    ROOT / "public" / "tiles" / "super-metroid" / "crateria" / "cell_21_4.png",
    ROOT / "public" / "tiles" / "metroid-zero-mission" / "chozodia" / "cell_5_5.png",
]


def draw_background(img: Image.Image) -> None:
    """Radial glow + seeded starfield + scanlines, echoing the site backdrop."""
    draw = ImageDraw.Draw(img)
    # radial glow around the upper middle, like body's background gradient
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, r = W // 2, int(H * 0.28), 640
    gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    img.paste(Image.new("RGB", (W, H), BG_GLOW), (0, 0), glow)

    rng = random.Random(2003)  # Metroid Fusion's release year; fixed for determinism
    for _ in range(240):
        x, y = rng.randrange(W), rng.randrange(H)
        b = rng.randint(70, 200)
        size = 2 if rng.random() < 0.12 else 1
        draw.rectangle([x, y, x + size - 1, y + size - 1], fill=(b, b, min(255, b + 30)))

    # faint CRT scanlines
    for y in range(0, H, 4):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 0))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(0, H, 4):
        od.line([(0, y), (W, y)], fill=(0, 0, 0, 46))
    img.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), overlay.split()[3])


def corner_brackets(draw: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, arm: int = 22, w: int = 4, pad: int = 8) -> None:
    """Cyan corner brackets around a rect, .tile-frame style (outside the art)."""
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    for cx, cy, sx, sy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        draw.line([(cx, cy), (cx + sx * arm, cy)], fill=CYAN, width=w)
        draw.line([(cx, cy), (cx, cy + sy * arm)], fill=CYAN, width=w)


def draw_screens(img: Image.Image) -> None:
    """The three screens, equal height, centered as a strip in the lower half."""
    draw = ImageDraw.Draw(img)
    tile_h = 252
    gap = 56
    scaled = []
    for p in TILES:
        t = Image.open(p).convert("RGB")
        tw = round(t.width * (tile_h / t.height))
        scaled.append(t.resize((tw, tile_h), Image.NEAREST))
    total = sum(t.width for t in scaled) + gap * (len(scaled) - 1)
    x = (W - total) // 2
    y = H - tile_h - 84
    for t in scaled:
        img.paste(t, (x, y))
        corner_brackets(draw, x, y, x + t.width - 1, y + tile_h - 1)
        x += t.width + gap


def text_with_glow(img: Image.Image, pos: tuple[int, int], text: str, font: ImageFont.FreeTypeFont, fill: tuple, glow: tuple, anchor: str = "mm") -> None:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.text(pos, text, font=font, fill=glow, anchor=anchor)
    layer = layer.filter(ImageFilter.GaussianBlur(10))
    img.paste(layer, (0, 0), layer)
    ImageDraw.Draw(img).text(pos, text, font=font, fill=fill, anchor=anchor)


def draw_titles(img: Image.Image) -> None:
    draw = ImageDraw.Draw(img)
    title = ImageFont.truetype(str(TITLE_FONT), 110)
    # gold wordmark with a warm glow, like the menu logo's metal treatment
    text_with_glow(img, (W // 2, 118), "ZebesGuessr", title, GOLD, (255, 160, 40, 140))

    # NB: this pixel face is missing "?" and "-" (tofu boxes) — stick to
    # letters and periods. This is the site's own tagline anyway.
    pixel = ImageFont.truetype(str(PIXEL_FONT), 28)
    tag = "UNIDENTIFIED SIGNAL DETECTED. LOCATE IT."
    text_with_glow(img, (W // 2, 218), tag, pixel, CYAN, (80, 200, 220, 120))

    small = ImageFont.truetype(str(PIXEL_FONT), 20)
    draw.text((W // 2, 262), "A MAP GUESSING GAME FOR 2D METROID", font=small, fill=TEXT, anchor="mm")

    draw.text((W // 2, H - 34), "www.zebesguessr.com", font=small, fill=(*CYAN, 255), anchor="mm")

    # thin gold rules bracketing the tagline block, menu-kicker style
    for y in (176, 288):
        draw.line([(W // 2 - 260, y), (W // 2 + 260, y)], fill=(*LINE, 255), width=2)


def main() -> None:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw_screens(img)
    draw_titles(img)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
