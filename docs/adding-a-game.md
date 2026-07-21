# Adding a game — the process

The checklist distilled from adding **Metroid Fusion** (July 2026), written to make
adding **Metroid: Zero Mission** (and anything after) a straight run-through.
Where a step has a Fusion-specific number in it, treat it as an example, not a
constant.

## 0. What "adding a game" means here

The app is already multi-game: `GAMES` in `src/data.ts` is the registry
(menu, seed codes), `loadGameData` fetches `data/<gameId>.json` plus the
optional sidecars, and every URL/key is parameterized by game id. Adding a
game is 90% pipeline + data work, plus a palette if the map art style is new.

**Never reorder `GAMES`** — seed codes pack the game as a positional index.
Append only.

## 1. Source images + credits

1. Find a full ripped map (one image per area) and an in-game map rip
   (pause-map screen, one per area) — [VGMaps](https://www.vgmaps.com) has both
   for the GBA games. Skip annotated "(Guide)" variants.
2. Record the authors from the atlas index page, and add them to:
   - `README.md` → Credits
   - `src/components/AboutModal.tsx` → the maps paragraph
3. Check the geometry premise before committing to a source: **the full map
   and the in-game map must be grid-aligned** (one in-game map cell = one
   fixed-size screen rect of the full map). Fusion verified at 240×160 px per
   cell with the in-game rips at 8 px per cell. The fastest check is an
   occupancy diff — see step 5, or `pipeline/debug/` after slicing.

Fusion sources, for reference: full maps by zerofighter & rocktyt, in-game
maps by Narasumas, URLs like
`https://vgmaps.com/Atlas/GBA/MetroidFusion-Sector1(SRX)(In-GameMap).png`.

Check whether the full maps draw the bosses/ship/landmarks in their rooms.
The Super Metroid sheets do; the Fusion ones don't, which made every boss
arena an anonymous empty room. If they're missing, plan on a
`composite_landmarks.py` pass (see step 3½) — sprite poses cut from
[The Spriters Resource](https://www.spriters-resource.com) sheets (credit the
rippers in README + AboutModal, same as the mapmakers).

## 2. Config entry

Add the game to `pipeline/maps.config.json`:

```jsonc
"metroid-zero-mission": {
  "title": "Metroid: Zero Mission",
  "mapStyle": "gba",            // dispatches extractor + frontend palette
  "cellWidth": 240,             // GBA: one screen per map cell (non-square)
  "cellHeight": 160,
  "guessMapCellPx": 14,
  "background": "white",        // vgmaps GBA sheets are white; snesmaps is black
  "areas": [ { "id": "...", "name": "...", "url": "...", "ingameUrl": "...",
               "offsetX": 0, "offsetY": 0 }, ... ]
}
```

Square-cell games use `cellSize` instead of `cellWidth`/`cellHeight`.

## 3. Download

```
python pipeline/download_maps.py <game-id>
```

Writes `Images/raw/<game>/<area>.<ext>` + `ingame/<area>.<ext>` (extension
follows the URL). `Images/raw/` is gitignored — every machine that reruns the
pipeline re-downloads.

## 3½. Landmarks (only if the rip draws arenas empty)

```
python pipeline/composite_landmarks.py <game-id>
```

Runs between download and slice; no-op unless `pipeline/landmarks.<game>.json`
exists. Stamps alpha-transparent sprite poses (`pipeline/sprites/<game>/`)
onto the raw area maps at pixel positions listed in the manifest, so bosses /
the ship / other landmarks flow into the sliced tiles (both the mystery screen
and the X-Ray overlay render those). The pristine download is kept in
`Images/raw/<game>/pristine/` and stamping always restarts from it, so reruns
are idempotent and moving a stamp leaves no ghost. Three ways to tweak a
placement: the editor's **Landmark** tool (dev server; click a cell, drag or
arrow-nudge the stamp in the zoomed panel, then **Save + Bake** to run the
whole composite → slice → extract → format chain server-side), editing the
manifest's `x`/`y` by hand, or hand-layering the sprites onto the area PNG in
an image editor and pinning it via `localSource` (then delete that area's
manifest entries). Either way, follow
the slice with the extractor (step 5) — slicing rewrites the game JSON from
scratch, so the pause-map draw data must be re-patched in. A stamp landing on a
`keepTiles` cell won't reach that tile — apply it to the committed tile PNG by
hand at the same in-tile offset (Fusion's Zazabi on sector-2 `(14,13)` is the
one live example).

### Sprite files and categories

Sprites live at `pipeline/sprites/<game>/<category>/<name>.png` — the category
subdirectory (one level, e.g. `bosses/`, `creatures/`, `barriers/`, `objects/`)
groups the Landmark tool's thumbnail palette, and the manifest's `sprite` field
is that relative path (`"bosses/box.png"`). A PNG dropped flat into the game
dir also works and shows up under **other** — handy for quick experiments;
categorize it later with a `git mv` + manifest path update. Filenames must be
lowercase `[a-z0-9-]` (the dev endpoints reject anything else).

Adding a sprite of your own:

1. Cut it from a sheet (Spriters Resource rips — add the ripper to the credits
   in `README.md` + `AboutModal.tsx`):
   ```
   python pipeline/cut_sprite.py sheet.png <x> <y> <w> <h> \
       pipeline/sprites/<game>/<category>/<name>.png [--key AUTO]
   ```
   `--key AUTO` color-keys a solid background to alpha (needed for sheets with
   no/broken alpha); the result is auto-trimmed to its opaque bbox and the
   final dimensions are printed. Or export an alpha PNG from any image editor.
2. Hit **↻** in the Landmark panel — the palette re-scans the directory, no
   dev-server restart (unsaved stamp edits survive the refresh).
3. Click the new thumbnail to stamp it on the clicked cell, drag/nudge, then
   **Save + Bake**.

### Tile overrides (alternate room states)

A rip captures one moment of the story — Fusion's vgmaps sheets are all
endgame state, but some rooms are more recognizable earlier (Main Deck's
Sub-Zero Containment has the frozen Ridley standing tall until mid-game).
`composite_landmarks.py` also applies whole-screen replacements listed in
`pipeline/tileOverrides.<game>.json`, keyed by area id:

```json
{
  "main-deck": [{ "x": 7, "y": 10, "image": "tile-sources/<game>/main-deck/room.png", "sx": 32, "sy": 32, "note": "why + where the image came from" }]
}
```

`x`/`y` are **tile coords** (an override targets a whole cell); `image` is
relative to `pipeline/`, with sources committed under
`pipeline/tile-sources/<game>/<area>/` — keep them byte-identical to their
upstream origin (a Randovania room render, a MAGE export) so provenance stays
checkable, and crop the `cellWidth`×`cellHeight` screen out of a larger room
render with `sx`/`sy` (default 0; the crop must be fully opaque). One room
file can serve several cells — prefer overriding every screen of a
multi-screen room from the same render, or the X-Ray overlay shows a mid-room
state seam. That's a judgment call, not a rule: Sub-Zero Containment keeps
its endgame right screen (8,10) because the Randovania render draws that
hatch in the wrong door color, and the wrong-color door is the worse
artifact.
Overrides are pasted onto the pristine copy _before_ landmark stamping, so
stamps land on top, and the paste honors `cellCropOffsets` like the slicer.
The same `keepTiles` trap applies: an override under a kept cell never reaches
the tile PNG. Rebake with the usual composite → slice → extract → format
chain; only the targeted `cell_<x>_<y>.png`s (plus the area's `map.png`
backdrop) should change — the game JSON must not. Known limitation: the
Landmark tool previews against the pristine map, so overrides only show up
there after a bake.

For Fusion and Zero Mission the whole workflow is in-app: the editor's
**Room state** tool sources renders from the vendored Randovania checkout at
`randovania/<fusion|zero_mission>/assets/maps/<map_name>.png` (gitignored;
`map_name` comes from the logic database via the cell's room name, so the cell
must be named first). Click a cell to see its room's render gridded into
screens — every render pads the room with 32px of off-camera tiles, and the
crop math relies on it — then click screens to toggle per-cell overrides
(✓ = this room's override, ≠ = a different image, orange = keepTiles trap),
compare the crop against the current baked tile, and **Save** (writes the
manifest and copies the render byte-identical into `tile-sources/`) or
**Save + Bake**.

## 4. Slice

```
python pipeline/slice_maps.py <game-id>
```

Then **look at every debug grid** in `pipeline/debug/<game>/` before going
further:

- Grid misaligned → per-area `offsetX`/`offsetY`.
- A "remainder" note → padding on one edge of the sheet (Fusion's Sector 5 has
  16 junk px on the right; harmless, floor division drops it).
- Watermarks/credit text picked up as playable cells (green box around junk) →
  `excludeCells`. (Fusion: Sector 4's bottom-right VGMaps logo.)

## 5. Extract the in-game maps

```
python pipeline/extract_gba_maps.py <game-id>     # mapStyle "gba"
python pipeline/extract_ingame_maps.py <game-id>  # mapStyle "snes"
```

Both patch `public/data/<game>.json` in place. Read the per-area report line
and chase every anomaly until the output is clean:

- **`X aligned of Y drawn` must match** (`X == Y`). A shortfall means cells the
  pause map draws don't land on sliced tiles.
- **`WARNING: cell(s) ... have no tile behind them` must reach zero.** Causes
  seen so far, in likelihood order:
  1. _Dark/blank room under the fill threshold_ → `includeCells`.
  2. _Caption text misread as a room_ → extractor heuristic problem, fix there
     (see `docs/map-extraction-notes.md` for the tools each style has).
  3. _The full map is a collage that displaced a sub-area_ (Fusion Main Deck:
     the lower-left cluster sits 3 rows higher on the sheet than on the
     pause map) → relocate the tiles to the pause-map positions with
     `extraRows`/`extraCols` + `includeCells` + `cellCropOffsets` (and
     `excludeCells` on the sheet positions so they don't double up).
     Diff the two occupancy grids as ASCII to find the displacement vector —
     ten lines of Python, worth it.
  4. _The sheet simply lacks the room_ (Fusion: Sector 3's `(17,4)`, and the
     right half of Sector 5's two-screen Nightmare arena, cropped off the rip)
     → `includeCells` so the map stays complete, then rate the tile **6**
     in `difficulty.<game>.json` so the artless screen is never served.
- `undrawn` cells (tiles the pause map doesn't chart — elevator shafts, rooms
  absent from the in-game map) are normal; rate them **6**.

A starter difficulty file with exactly those 6s can be generated in one line
from the merged JSON (cells without `k` + the artless includes). The real
difficulty pass comes later.

## 6. Frontend

- `src/data.ts`: flip the game's `available` to `true`; add its areas to
  `ENABLED_AREAS` (dev filter).
- New `mapStyle`? Add a palette in `src/components/guessMap/constants.ts`
  (`SNES_COL`/`GBA_COL`) + draw branches (the background lattice in
  `GuessMap.draw`, cell shapes in `drawMap.ts`'s `drawCell`). Zero Mission is
  `gba` — **no new code expected**, its pause map uses the same language
  (check its door-pip and fill colors against `GBA_COL` though; ZM colors
  rooms per area).
- Non-square tiles are already handled everywhere via
  `data.cellWidth/cellHeight` (TileViewer aspect, share-image letterbox,
  scan-shot `height: auto`).

## 7. Verify

```
npx tsc -b && npm test && npm run build
npm run format     # includes the regenerated public/data/*.json
```

- Rerun slice + extract, `npm run format`, confirm `git status` is clean
  (reproducibility contract — no hand-edits in `<game>.json`).
- If shared pipeline code changed, rerun the **other** games' extractors and
  confirm their JSON is byte-identical.
- Play a full run in the dev server; check the map draws right per area, the
  mystery screen isn't stretched, and a `?seed=` link round-trips.

## 8. Polish passes (each its own session, after MVP)

1. **Difficulty**: `pipeline/rate_tiles.py <game>` + a hand-curated
   `pipeline/room-difficulty.<game>.json` base (see
   `docs/tile-difficulty-notes.md`); until then everything rates 3.
2. **Room names**: `roomNames.<game>.json`. Fusion's are bulk-derived from the
   **Randovania** logic database (per-region JSON under the vendored
   `randovania/<game>/logic_database/` checkout, `areas` keyed by name, each
   with `extra.minimap_coordinates`) mapped onto our cell grid by a per-area
   integer offset — see `pipeline/import_fusion_room_names.py` and the offset
   table in it (Super's came from Map Rando's data the same way). Zero
   Mission's Randovania database has **no** minimap coordinates — only
   room-local node coordinates (y up) — so
   `pipeline/import_zm_room_names.py` _solves_ the placement instead: paired
   dock nodes give each room pair's relative offset (snap to the 240×160
   screen grid; the ±16px door inset is the only noise), BFS places every
   room, and the whole region is anchored onto our grid by brute-force
   overlap. ~87% coverage at import. The in-app editor's Name tool touches
   up what the import doesn't cover.
3. **Glyphs**: `glyphs.<game>.json` via the editor. `MapGlyph['t']` now
   carries the Fusion-only `navigation` and `data` station kinds (alongside
   the shared save/map/recharge/ship/boss/item); the editor has **Nav**/**Data**
   tools for them. Station letters are drawn per `mapStyle` — Super green,
   Fusion yellow — and Fusion additionally outlines its Save/Nav/Data/Recharge
   "letter rooms" in red (`computeSpecialCells` in `guessMap/drawMap.ts` /
   `COL.special`). Placing
   the actual Fusion glyphs in the editor is still to do.
4. **Connectors**: `overlays.<game>.json` via the editor (Fusion: the six
   numbered Main Deck elevators + per-sector return stubs).
5. **Flavor**: game-conditional menu/reveal text if wanted ("SECTOR ZEBES"
   kicker etc. is still Super Metroid-flavored and static).

## GBA facts worth remembering (learned adding Fusion, updated for ZM)

- GBA in-game rips: 8 px/cell, framed in a wide border of empty lattice
  squares; the extractor trims the viewport to the tile grid + 2 cells since
  that framing is the ripper's, not the game's. All seven Fusion rips share
  offset (11,5) — expect ZM's to be equally uniform.
- Exact Fusion in-game palette (mask colors in `extract_gba_maps.py`):
  lattice lines `(0,0,144)`, square interiors `(32,32,72)`, fills magenta
  `(248,0,248)` / green `(32,192,104)`, walls white `(248,248,248)`, door
  pips red `(248,32,72)` / yellow `(248,248,0)` / green `(16,248,128)` /
  blue `(0,0,248)`, station icons yellow-on-red.
- **Doors are gaps in the wall line**: fill color showing through = normal
  hatch (`"n"`), colored pip = locked door. Caption boxes ("N:S:R") cross
  borders as long/edge-touching runs — the gap-bounded-by-white rule filters
  them. A gap drawn on only one of a boundary's two wall lines is an
  **asymmetric door** (it belongs to one room only) — each cell reads its own
  line, so it stays one-sided in the data and the render.
- **Elevator ladders** (striped 1px fill/white rungs) are stripped to bare
  tiles — hand-place connectors over them, same as Super. **Knob passages**
  (sub-cell inset boxes with twin-rail tunnels) become `k:"knob"` cells and
  stay selectable. The docked **ship sprite** (door-yellow, inside room fill)
  is stripped from the door mask so it can't fake a wall.
  Details for all three in `docs/map-extraction-notes.md`.
- What magenta vs green fill _means_ in the source rips is still unknown
  (preserved per cell as `f`). ZM's three fills are per-state — mapped /
  unmapped-until-visited / super-heated — plus a solved-at-extraction white
  variant for its chozo-statue and major-item rooms.
- **ZM extraction quirks** (per-game palette, icon-art stripping, white
  rooms, no ladders, narrow rooms as knobs, self-neutralizing boss X marks)
  are documented in `docs/map-extraction-notes.md` → "Zero Mission
  specifics". Frontend-side, ZM gets its own palette via `GAME_COL` in
  `src/components/guessMap/constants.ts` and two extra glyph kinds (`chozo`,
  `itemMajor`).
- **Room names** come from Randovania (see step 8.2):
  `pipeline/import_fusion_room_names.py` for Fusion (offset table),
  `pipeline/import_zm_room_names.py` for ZM (dock-graph solve).
