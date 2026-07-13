#!/usr/bin/env python3
"""Download source map images into Images/raw/<game>/.

Run this ONCE on your own machine (it needs open internet access):

    python pipeline/download_maps.py

Fetches the full-detail area maps (snesmaps.com) plus the in-game pause-map
recreations (vgmaps.de) used to build the clickable guess map.

Please be kind to the map hosts: this downloads a handful of files with
a short delay between requests. All map images are the work of their
credited authors (see README) and remain (c) Nintendo.
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())
UA = "ZebesGuessr-pipeline/0.1 (non-commercial fan project; one-time download)"


def fetch(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"skip (exists): {dest}")
        return
    print(f"downloading {url} -> {dest}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req) as resp:
        dest.write_bytes(resp.read())
    time.sleep(2)


def main() -> None:
    for game_id, game in CONFIG.items():
        out_dir = ROOT / "Images" / "raw" / game_id
        (out_dir / "ingame").mkdir(parents=True, exist_ok=True)
        for area in game["areas"]:
            fetch(area["url"], out_dir / f"{area['id']}.png")
            if "ingameUrl" in area:
                fetch(area["ingameUrl"], out_dir / "ingame" / f"{area['id']}.webp")
    print("done.")


if __name__ == "__main__":
    main()
