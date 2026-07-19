#!/usr/bin/env python3
"""Bulk-import Metroid Fusion room names from the Randovania logic database.

Randovania (https://github.com/randovania/randovania) ships a Fusion logic
database as one JSON per region, under
`randovania/games/fusion/logic_database/`. Each region file has an `areas`
object keyed by the community-standard room name, and every area carries
`extra.minimap_coordinates` -- the list of pause-map cells that room occupies.

Our tile grid *is* the pause-map grid, so those coordinates map onto our
`area.cells` by a single per-area integer offset (`our = rando - (ox, oy)`).
The offsets below were brute-forced against our existing cells and cross-checked
against the placed navigation/save glyphs. This writes the flat
`public/data/roomNames.metroid-fusion.json` that `loadGameData` merges over the
baked names key by key.

Input: the vendored Randovania checkout at `randovania/fusion/logic_database/`
(gitignored, same as other large third-party inputs). Only the seven region
files are read; the `header.json` resource DB is ignored.

CAUTION: this is a one-shot seeding tool that rewrites the sidecar wholesale.
The committed file carries hand-curated names layered on top of the original
import (and the vendored DB may have drifted since), so review the git diff
after a rerun — deletions there are usually curation being clobbered, not
fixes. `npm run format` afterwards.

(Zero Mission's logic-database format differs — see the companion
`import_zm_room_names.py`.)
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB_DIR = os.path.join(ROOT, "randovania", "fusion", "logic_database")
GAME_JSON = os.path.join(ROOT, "public", "data", "metroid-fusion.json")
OUT_JSON = os.path.join(ROOT, "public", "data", "roomNames.metroid-fusion.json")

# areaId -> (Randovania region file, ox, oy).  our_cell = (rando_x - ox, rando_y - oy)
AREAS = {
    "main-deck": ("Main Deck.json", 2, 0),
    "sector-1": ("Sector 1 SRX.json", 1, 0),
    "sector-2": ("Sector 2 TRO.json", 0, 0),
    "sector-3": ("Sector 3 PYR.json", 0, 0),
    "sector-4": ("Sector 4 AQA.json", 0, 0),
    "sector-5": ("Sector 5 ARC.json", 0, 1),
    "sector-6": ("Sector 6 NOC.json", 0, 1),
}


def main():
    game = json.load(open(GAME_JSON, encoding="utf-8"))
    our_cells = {
        a["id"]: {(c["x"], c["y"]) for c in a["cells"]} for a in game["areas"]
    }

    room_names = {}
    total_named = 0
    total_cells = 0
    total_collisions = 0

    for area_id, (fname, ox, oy) in AREAS.items():
        region = json.load(open(os.path.join(DB_DIR, fname), encoding="utf-8"))
        cells = our_cells[area_id]
        named = {}  # (x, y) -> name, per area, to detect collisions
        for name, area in region["areas"].items():
            for c in area["extra"].get("minimap_coordinates") or []:
                key = (c["x"] - ox, c["y"] - oy)
                if key not in cells:
                    continue  # off our sliced map (e.g. a room we split differently)
                if key in named and named[key] != name:
                    total_collisions += 1
                    print(
                        f"  WARNING {area_id} cell {key}: {named[key]!r} vs {name!r}"
                    )
                named[key] = name

        for (x, y), name in named.items():
            room_names[f"{area_id}:{x},{y}"] = name

        total_named += len(named)
        total_cells += len(cells)
        print(f"{area_id:<9} named {len(named)}/{len(cells)}")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(room_names.items())), f, indent=2, ensure_ascii=False)
        f.write("\n")

    pct = 100 * total_named / total_cells if total_cells else 0
    print(f"\nTOTAL named {total_named}/{total_cells} ({pct:.0f}%), "
          f"{total_collisions} collision(s)")
    print(f"wrote {OUT_JSON}")


if __name__ == "__main__":
    main()
