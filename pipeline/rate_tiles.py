#!/usr/bin/env python3
"""Bake per-cell difficulty ratings into public/data/difficulty.<game>.json.

Requires Pillow + numpy. Blends two signals per playable cell:

  1. Name base — the hand-curated pipeline/room-difficulty.<game>.json
     (room name -> 1..5), joined through roomNames.<game>.json. This is the
     durable source of truth; fold lasting hand-tweaks back into it, because
     re-running this script overwrites the output file.
  2. Visual distinctness — how unlike every other tile in the game this
     tile's screen looks (16x16 grayscale structure + coarse RGB palette
     histogram, mean distance to the k nearest other tiles, then percentile
     ranked). Tiles with near-clones rate harder, one-of-a-kind screens
     easier.

Degenerate screens (near-black or near-featureless — unguessable) are rated
6, which the game never serves in any mode.

Prints a rating histogram plus per-rating examples for eyeballing, then
writes all cells (including 3s, so coverage is auditable).
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GAME = sys.argv[1] if len(sys.argv) > 1 else "super-metroid"

# Blend weights: name base carries slightly more than the visual signal.
W_NAME = 0.55
W_VISUAL = 0.45
# Averaging two signals compresses everything toward 3; stretch the blend
# back out around the centre so ratings 1/2 and 4/5 keep real populations.
STRETCH = 1.4
KNN = 3  # distinctness = mean distance to this many nearest neighbours

# Degenerate-screen threshold: mean absolute luminance gradient. Featureless
# screens (flat sky, murk bands, empty sand) sit below ~4.2 while even very
# dark rooms with real structure measure 5.3+, so 4.5 splits the observed gap.
# Luminance mean/std don't work here — dark caves with clear structure score
# low on both, while featureless murk gradients can score high.
DEGEN_EDGE = 4.5

# Feature shape: downsampled grayscale (structure) + RGB histogram (palette).
GRAY_SIZE = 16
HIST_BINS = 4  # per channel -> 64 palette buckets
PALETTE_WEIGHT = 0.5  # palette matters, structure matters more


def tile_features(path: Path) -> tuple[np.ndarray, float]:
    """(feature vector, edge energy) for one tile PNG."""
    img = Image.open(path).convert("RGB")
    gray = np.asarray(img.convert("L"), dtype=np.float32)
    edge = float(np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean())
    small = np.asarray(
        img.convert("L").resize((GRAY_SIZE, GRAY_SIZE), Image.BILINEAR), dtype=np.float32
    ).ravel() / 255.0
    rgb = np.asarray(img, dtype=np.uint8) >> (8 - HIST_BINS.bit_length() + 1)
    idx = (rgb[..., 0].astype(np.int32) * HIST_BINS + rgb[..., 1]) * HIST_BINS + rgb[..., 2]
    hist = np.bincount(idx.ravel(), minlength=HIST_BINS**3).astype(np.float32)
    hist /= hist.sum()
    return (
        np.concatenate([small, hist * PALETTE_WEIGHT * len(small) / len(hist)]),
        edge,
    )


def main() -> None:
    data = json.loads((ROOT / "public" / "data" / f"{GAME}.json").read_text())
    room_names = json.loads(
        (ROOT / "public" / "data" / f"roomNames.{GAME}.json").read_text()
    )
    table = json.loads(
        (ROOT / "pipeline" / f"room-difficulty.{GAME}.json").read_text()
    )

    keys: list[str] = []
    feats: list[np.ndarray] = []
    edges: dict[str, float] = {}
    for area in data["areas"]:
        for cell in area["cells"]:
            key = f"{area['id']}:{cell['x']},{cell['y']}"
            path = ROOT / "public" / "tiles" / GAME / area["id"] / f"cell_{cell['x']}_{cell['y']}.png"
            f, edge = tile_features(path)
            keys.append(key)
            feats.append(f)
            edges[key] = edge

    # Every playable cell must resolve to a curated room rating; fail loudly
    # so the table and the room names never drift apart.
    problems = []
    for key in keys:
        name = room_names.get(key)
        if name is None:
            problems.append(f"unnamed cell: {key}")
        elif name not in table:
            problems.append(f"room missing from table: {name!r} ({key})")
    if problems:
        for p in sorted(set(problems)):
            print(p)
        sys.exit(1)

    # Pairwise distances -> mean distance to the KNN nearest other tiles.
    x = np.stack(feats)
    sq = (x * x).sum(axis=1)
    d2 = np.maximum(sq[:, None] + sq[None, :] - 2.0 * (x @ x.T), 0.0)
    np.fill_diagonal(d2, np.inf)
    nearest = np.sqrt(np.sort(d2, axis=1)[:, :KNN]).mean(axis=1)
    # percentile rank: 0 = has near-clones (hard), 1 = unique (easy)
    order = nearest.argsort().argsort()
    pct = order / (len(keys) - 1)

    ratings: dict[str, int] = {}
    for i, key in enumerate(keys):
        if edges[key] < DEGEN_EDGE:
            ratings[key] = 6
            continue
        base = table[room_names[key]]
        visual = 5.0 - 4.0 * pct[i]
        raw = W_NAME * base + W_VISUAL * visual
        raw = 3.0 + (raw - 3.0) * STRETCH
        ratings[key] = int(np.clip(round(raw), 1, 5))

    hist = Counter(ratings.values())
    print(f"{GAME}: {len(ratings)} cells rated")
    for r in range(1, 7):
        print(f"  {r}: {hist.get(r, 0):4d}  {'#' * (hist.get(r, 0) // 8)}")

    examples: dict[int, dict[str, str]] = defaultdict(dict)
    for key, r in ratings.items():
        room = room_names[key]
        if room not in examples[r] and len(examples[r]) < 6:
            examples[r][room] = key
    for r in range(1, 7):
        if examples[r]:
            print(f"  e.g. {r}: " + "; ".join(f"{n} ({k})" for n, k in examples[r].items()))

    out_path = ROOT / "public" / "data" / f"difficulty.{GAME}.json"
    out = {k: ratings[k] for k in sorted(ratings)}
    out_path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
