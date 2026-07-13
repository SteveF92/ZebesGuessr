#!/usr/bin/env python3
"""Download source map images into Images/raw/<game>/<area>.png.

Run this ONCE on your own machine (it needs open internet access):

    python pipeline/download_maps.py

Please be kind to the map hosts: this downloads a handful of files with
a short delay between requests. All map images are the work of their
credited authors (see README) and remain © Nintendo.
"""
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())
UA = "ZebesGuessr-pipeline/0.1 (non-commercial fan project; one-time download)"


def main() -> None:
    for game_id, game in CONFIG.items():
        out_dir = ROOT / "Images" / "raw" / game_id
        out_dir.mkdir(parents=True, exist_ok=True)
        for area in game["areas"]:
            dest = out_dir / f"{area['id']}.png"
            if dest.exists():
                print(f"skip (exists): {dest}")
                continue
            print(f"downloading {area['url']} -> {dest}")
            req = urllib.request.Request(area["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req) as resp:
                dest.write_bytes(resp.read())
            time.sleep(2)
    print("done.")


if __name__ == "__main__":
    main()
