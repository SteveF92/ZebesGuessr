#!/usr/bin/env python3
"""Bulk-import Metroid: Zero Mission room names from the Randovania logic
database.

Randovania (https://github.com/randovania/randovania) ships a ZM logic
database as one JSON per region, under
`randovania/games/zero_mission/logic_database/`. Unlike Fusion's, ZM's areas
carry no `minimap_coordinates` — only per-node `coordinates` in room-LOCAL
pixels (y up). So the mapping onto our tile grid is solved, not looked up:

  1. Every dock node names its paired dock in the neighbouring room
     (`default_connection`). The two nodes sit a wall apart in world space,
     so `a.coordinates - b.coordinates` is that pair's estimate of the
     rooms' relative origin — off by only the door inset (±16px), while
     room origins differ by whole 240x160 screens. Snapping each estimate
     to the screen grid recovers the exact offset; BFS over the dock graph
     places every room in one shared frame (each region is one component,
     zero conflicts).
  2. Each room's cell footprint is the bounding box of its nodes' cells
     (docks sit at the room's extremes, so the bbox is tight).
  3. The whole region is anchored onto our sliced tile grid by brute-force
     translation, maximizing node-cell overlap (~95% — misses are door
     nodes rounding across a cell edge, harmless for naming).

Cell collisions (overlapping bboxes of L-shaped rooms) resolve to the room
with the smaller bbox — the more specific claim. Writes the flat
`public/data/roomNames.metroid-zero-mission.json` that `loadGameData` merges
over the baked names key by key.

Input: the vendored Randovania checkout at
`randovania/zero_mission/logic_database/` (gitignored, same as Fusion's).

CAUTION: this is a one-shot seeding tool that rewrites the sidecar wholesale.
The committed file may carry hand-curated names, and the vendored DB drifts
between checkouts (a 2026-07 rerun already produced ~23 deletions vs the
committed seed) — review the git diff after a rerun before committing.
`npm run format` afterwards.
"""

import json
import os
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DB_DIR = os.path.join(ROOT, "randovania", "zero_mission", "logic_database")
GAME_JSON = os.path.join(ROOT, "public", "data", "metroid-zero-mission.json")
OUT_JSON = os.path.join(ROOT, "public", "data",
                        "roomNames.metroid-zero-mission.json")

CW, CH = 240, 160  # world pixels per map cell

# areaId -> Randovania region file
AREAS = {
    "brinstar": "Brinstar.json",
    "kraid": "Kraid.json",
    "norfair": "Norfair.json",
    "ridley": "Ridley.json",
    "tourian": "Tourian.json",
    "crateria": "Crateria.json",
    "chozodia": "Chozodia.json",
}


def node_xy(node):
    """Room-local node position in y-DOWN pixels (source is y-up)."""
    c = node.get("coordinates")
    if not c:
        return None
    return (c["x"], -c["y"])


def solve_origins(region):
    """Place every room in one shared pixel frame via the dock graph."""
    docks = {}
    for rname, area in region["areas"].items():
        for nname, node in area["nodes"].items():
            if node.get("node_type") != "dock":
                continue
            tgt = node.get("default_connection")
            xy = node_xy(node)
            if not tgt or tgt["region"] != region["name"] or xy is None:
                continue
            docks[(rname, nname)] = (xy, tgt["area"], tgt["node"])

    adj = {}
    for (ra, _na), ((ax, ay), rb, nb) in docks.items():
        back = docks.get((rb, nb))
        if not back:
            continue
        (bx, by), _, _ = back
        dx = round((ax - bx) / CW) * CW
        dy = round((ay - by) / CH) * CH
        adj.setdefault(ra, []).append((rb, dx, dy))

    origins = {}
    conflicts = 0
    for root in region["areas"]:
        if root in origins or root not in adj:
            continue
        origins[root] = (0, 0)
        q = deque([root])
        while q:
            r = q.popleft()
            for (nb, dx, dy) in adj.get(r, []):
                pos = (origins[r][0] + dx, origins[r][1] + dy)
                if nb in origins:
                    conflicts += pos != origins[nb]
                else:
                    origins[nb] = pos
                    q.append(nb)
    return origins, conflicts


def main():
    game = json.load(open(GAME_JSON, encoding="utf-8"))
    our_cells = {
        a["id"]: {(c["x"], c["y"]) for c in a["cells"]} for a in game["areas"]
    }

    room_names = {}
    total_named = 0
    total_cells = 0
    total_collisions = 0

    for area_id, fname in AREAS.items():
        region = json.load(open(os.path.join(DB_DIR, fname), encoding="utf-8"))
        origins, conflicts = solve_origins(region)
        if conflicts:
            print(f"  WARNING {area_id}: {conflicts} dock-graph conflict(s)")

        # room -> (bbox cells, node cells) in the shared (unanchored) frame
        rooms = {}
        anchor_cells = set()
        for rname, area in region["areas"].items():
            if rname not in origins:
                continue
            ox, oy = origins[rname]
            cells = set()
            for node in area["nodes"].values():
                xy = node_xy(node)
                if xy is None:
                    continue
                cells.add((int(ox + xy[0]) // CW, int(oy + xy[1]) // CH))
            if not cells:
                continue
            xs = [x for x, _ in cells]
            ys = [y for _, y in cells]
            bbox = {(x, y) for x in range(min(xs), max(xs) + 1)
                    for y in range(min(ys), max(ys) + 1)}
            rooms[rname] = bbox
            anchor_cells |= cells

        # anchor the region onto our tile grid (max node-cell overlap)
        ours = our_cells[area_id]
        best = (-1, 0, 0)
        for ty in range(-40, 41):
            for tx in range(-40, 41):
                s = sum(1 for (x, y) in anchor_cells if (x + tx, y + ty) in ours)
                if s > best[0]:
                    best = (s, tx, ty)
        overlap, tx, ty = best

        # smaller bbox = more specific claim; name those last so they win
        named = {}
        collisions = 0
        for rname in sorted(rooms, key=lambda r: -len(rooms[r])):
            for (x, y) in rooms[rname]:
                key = (x + tx, y + ty)
                if key not in ours:
                    continue
                if key in named and named[key] != rname:
                    collisions += 1
                named[key] = rname

        for (x, y), name in named.items():
            room_names[f"{area_id}:{x},{y}"] = name

        total_named += len(named)
        total_cells += len(ours)
        total_collisions += collisions
        print(f"{area_id:<9} named {len(named)}/{len(ours)} "
              f"(anchor {overlap}/{len(anchor_cells)} at ({tx},{ty}), "
              f"{collisions} collision(s))")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(room_names.items())), f, indent=2,
                  ensure_ascii=False)
        f.write("\n")

    pct = 100 * total_named / total_cells if total_cells else 0
    print(f"\nTOTAL named {total_named}/{total_cells} ({pct:.0f}%), "
          f"{total_collisions} collision(s)")
    print(f"wrote {OUT_JSON}")


if __name__ == "__main__":
    main()
