#!/usr/bin/env python3
"""Download source map images into Images/raw/<game>/.

Run this ONCE on your own machine (it needs open internet access):

    python pipeline/download_maps.py [game-id]

Fetches the full-detail area maps (snesmaps.com for Super Metroid,
vgmaps.com for the GBA games) plus the in-game pause-map recreations
(vgmaps.de / vgmaps.com) used to build the clickable guess map.

Please be kind to the map hosts: this downloads a handful of files with
a short delay between requests. All map images are the work of their
credited authors (see README) and remain (c) Nintendo.
"""
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "pipeline" / "maps.config.json").read_text())
# Committed, hand-fixed source maps that supersede the web download for an
# area (flagged `"localSource": true` in maps.config.json). The web rip was
# wrong/incomplete for these, so this repo copy is the source of truth and
# seeds Images/raw/ instead of a re-download.
SOURCE_MAPS = ROOT / "pipeline" / "source-maps"
UA = "ZebesGuessr-pipeline/0.1 (non-commercial fan project; one-time download)"


def url_ext(url: str) -> str:
    return Path(urllib.parse.urlparse(url).path).suffix or ".png"


def seed_local(game_id: str, area_id: str, dest: Path) -> bool:
    """Seed a raw area map from the committed source-maps copy, if one exists.

    Returns True when handled (a local source was found), else False so the
    caller falls back to the web download.
    """
    src = next((SOURCE_MAPS / game_id).glob(f"{area_id}.*"), None)
    if src is None:
        raise SystemExit(
            f"{game_id}/{area_id} is flagged localSource but no committed map "
            f"exists at {SOURCE_MAPS / game_id}/{area_id}.*"
        )
    if dest.exists():
        print(f"skip (exists): {dest}")
        return True
    print(f"seeding local source {src} -> {dest}")
    shutil.copyfile(src, dest.with_suffix(src.suffix))
    return True


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
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in CONFIG:
        raise SystemExit(f"unknown game id {only!r}; expected one of {list(CONFIG)}")
    for game_id, game in CONFIG.items():
        if only and game_id != only:
            continue
        out_dir = ROOT / "Images" / "raw" / game_id
        (out_dir / "ingame").mkdir(parents=True, exist_ok=True)
        for area in game["areas"]:
            dest = out_dir / f"{area['id']}{url_ext(area['url'])}"
            if not (area.get("localSource") and seed_local(game_id, area["id"], dest)):
                fetch(area["url"], dest)
            if "ingameUrl" in area:
                fetch(area["ingameUrl"],
                      out_dir / "ingame" / f"{area['id']}{url_ext(area['ingameUrl'])}")
    print("done.")


if __name__ == "__main__":
    main()
