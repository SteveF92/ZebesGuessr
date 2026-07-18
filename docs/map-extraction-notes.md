# Map extraction notes: phantom rooms, station-icon rooms & diagonal corridors

The guess map is rebuilt from the in-game pause-map recreations by
`pipeline/extract_ingame_maps.py`, which quantizes each source image onto an
8px cell grid. Three classes of artifact come out of that quantization. All
are handled at the **pixel level, before quantization** (an earlier cell-level
approach missed several cases); the rules below hold for Super Metroid today
and are worth re-validating for another game or a re-sourced map.

GBA games (Metroid Fusion, later Zero Mission) use a different extractor,
`pipeline/extract_gba_maps.py` — see [the GBA section](#gba-map-extraction-metroid-fusion)
at the end. `mapStyle` in `maps.config.json` (baked into `<game>.json`)
decides which extractor owns which game; each skips the other's. The
style-agnostic plumbing (grid phase detection, connected components,
tile-grid alignment, `mapOverrides` handling, the merge onto the one cell
list) is shared via `pipeline/maplib.py`.

## Phantom rooms (map annotations drawn in room colours)

### What they were

The recreations annotate area exits in colours the extractor also treats as
map geometry, which produced four kinds of phantom cells:

- **Caption words** (`BRINSTAR`, `WRECKED SHIP`, …) drawn in the exact room
  pink `(216, 56, 144)`. Most float in empty space, but some sit within
  8-connectivity of real rooms on the cell grid (Crateria's `WRECKED SHIP`,
  Brinstar's `NORFAIR`/`MARIDIA`), so the old wall-less-component filter kept
  them.
- **Elevator/exit channels**: twin 1px cyan rails ~4px apart with 2px dashes
  (pink in Brinstar/Tourian, gray in Crateria) running from a room edge
  off-map toward a red arrowhead. The rails alone made cells "occupied" even
  with zero pink.
- **Thin pink stubs** with red dashes leading to the red `(248, 0, 0)`
  arrowheads.
- **Dashed cyan decoration rows** (Brinstar) with no pink at all.

### How it's handled

Two pixel-level rules in `extract_ingame_maps.py`:

1. **`erase_annotations`** — pink 8-connected components with
   `size < ANNOT_MAX_PX (24)` **and** cyan-enclosure `< 0.5` are erased from
   the pink mask. Measured across all six areas: caption letters are 6–16 px
   with enclosure exactly `0.00`, elevator dashes are 1–3 px at `≤ 0.38`,
   while the smallest _real_ geometry (a one-tile room interior) is 26+ px at
   enclosure `≥ 0.75`. Elevator-room tiles at the map edge (enclosure
   `0.75–0.88`) are real map in the actual game and survive, correctly.
2. **Occupancy requires pink** — a cell's `fill` counts pink/ship/green
   pixels only; cyan no longer contributes. This kills the rail-only and
   cyan-dash cells.

`drop_label_text` (drop wall-less 8-connected cell components) is retained as
a cheap backstop; after the pixel-level pass it removes nothing.

### Closing open room edges

`side_has_wall` needs >=4 cyan px on a boundary, so a room whose source outline
is thin or anti-aliased can keep an open side facing empty space (13 such edges
across the six areas). `close_perimeter` runs after `drop_label_text`: for every
`room` cell it ORs a wall bit onto any side whose neighbour is unoccupied. It
only adds walls on exterior sides — never between two occupied cells, and never
touches shaft/diag cells — so the map perimeter always reads closed while shared
interior edges stay open. Rerun and it is idempotent.

### Transit connectors are hand-placed

The pipeline erases elevator/exit channels (above) and Maridia's dashed transit
lines, and never re-detects them. Both are curated by hand as unified
**connectors** in the app's icon editor (Connector tool — one axis-aligned
segment, either orientation, with twin rails + dashed core) and stored in
`overlays.<game>.json` (`{ areaId: { connectors } }`), which `loadGameData`
applies as an override just like `glyphs.<game>.json`. `extract_ingame_maps.py`
emits an empty `connectors` array and never writes the overlays file (it is
skipped by name).

### Residual difficulties / assumptions

- The 24px / 0.5-enclosure thresholds are empirical, though the observed gap
  is wide (0.38 vs 0.75). A real pink feature smaller than 24px _without_ a
  cyan outline would be wrongly erased; none exist here.
- Tiny pink "door nub" ticks (1–3 px, enclosure ≥ 0.55) are left in place;
  they never reach the 4px occupancy threshold on their own.
- A real cell whose pink sits entirely on cell-boundary rows could in theory
  lose occupancy now that cyan doesn't count; diffing old vs new output showed
  zero such losses (every removed cell was a verified artifact).
- Maridia's internal dashed transit lines are removed along with the exit
  markers. The real pause map draws them as dashed lines, not rooms — if we
  ever want them visually, they'd need a dedicated decoration layer.

## Room cells with a baked-in station icon

### What it was

The source recreations bake the game's own station icons into the map
pixels: a green map-station letter, a cyan save-station letter, an
orange/red/yellow ship or boss glyph. A room cell carrying the green "M"
letter measures only ~23px of pink+cyan — just under the 26px room-vs-shaft
cutoff — because the icon displaces pink fill without adding to either
count, so the classifier read it as a thin `vshaft`/`hshaft` sliver instead
of a full room. Every area's map station has exactly this cell. It went
unnoticed because a hand-placed glyph icon was drawn on top of it in the app,
covering the sliver; it became visible once those hand-placed icons were
cleared for re-placement.

### How it's handled

The room-vs-shaft threshold in `extract_area` counts green pixels as fill
alongside pink and cyan (ship/boss glyphs were already exempted via a
separate `ship[full].sum() < 3` check). Save-station cyan letters were never
an issue — cyan already counts toward the sum, so they bias _toward_ "room",
not away from it.

### Residual difficulties / assumptions

- This assumes every green pixel in the source is a map-station icon, never
  real map geometry. True for Super Metroid (green is used for nothing
  else); would need re-checking for another game.

## Diagonal corridors (stair passages)

### What they were

The pause map draws diagonal hallways as a smooth **sub-cell pink band edged
with 1px cyan on both sides** — and _not_ at 45°: Crateria's moat descent runs
~27°, Norfair's west passage ~26°. Quantized, each band became a ragged
staircase; rendered as per-cell 45° strokes it read as a hatch of disconnected
slashes.

### How it's handled

Per 8-connected chain of `diag`-tagged cells (the per-cell tag still comes
from the pink x/y correlation heuristic, `|corr| ≥ 0.2`):

- **Band fit** (`extract_diag_bands`): PCA over the chain's source pink
  pixels gives an axis + width, from which a generously overshot rotated
  rectangle is built. A rectangle alone overshoots: the source band's ends
  are mitred flush into the corridor it joins, not cut perpendicular to the
  band's own axis, so a constant-width rectangle's corners poke out past the
  real pink into empty space (visible as a stray triangular spike). The
  rectangle is clipped (`clip_polygon`, Sutherland-Hodgman) to the axis-
  aligned bounding box of the chain's actual pink pixels, which trims exactly
  those corners and leaves a polygon hugging the true shape. Stored per area
  as `map.bands = [{poly: [[x,y], ...]}]` in fractional map-cell coordinates.
- **Real vs display-only cells**: chain cells with
  `pink ≥ DIAG_SOLID_PX (24)` stay in `map.cells` as clickable `diag` tiles
  (Crateria 4, Norfair 3 — one per staircase step, like the real game's map
  tiles). Corner slivers (~12 px) are deleted — including _neighbour_ cells
  whose sub-24px pink lies entirely within the band's perpendicular extent
  (the correlation heuristic misses some corner spills, e.g. Norfair's
  `(8,9)`, which otherwise render as floating shaft stubs).
- **Renderer** (`GuessMap.drawBand`): each band is one filled pink polygon
  with a 2px cyan outline, drawn _before_ the cells so room fills cover the
  mitred ends. `diag` cells draw nothing themselves; they exist for
  hover/click/targets.

### Residual difficulties / assumptions

- A band is fitted per chain of `≥ 2` diag cells; a lone mis-tagged cell gets
  no band and draws nothing. None exist today.
- The fit assumes one _straight_ band per chain. A genuinely bent stair
  passage would need the chain split before fitting.
- The clip box comes from the chain's pink pixels only — if the correlation
  heuristic under-tags a cell that holds real band pixels, those pixels are
  invisible to the fit and the clip box shrinks to exclude them.
- Playable targets on sliver cells are dropped by the alignment filter (they
  are not selectable map tiles, matching the real game's one-tile-per-step
  map data).

## Regenerating

```
python pipeline/extract_ingame_maps.py [game-id]   # needs Images/raw/<game>/ingame/<area>.*
```

Landmark icons (station glyphs) are not auto-detected by this script at all —
they're hand-placed in the app's icon editor and stored in
`public/data/glyphs.<game>.json`, which this script skips explicitly and
never writes to.

## GBA map extraction (Metroid Fusion)

The Fusion in-game maps (vgmaps.com rips by Narasumas) are clean tile art on
an exact 8px grid with a small exact-RGB palette — none of the hand-drawn
fuzziness above. `extract_gba_maps.py` is therefore mostly exact-color
bookkeeping. What it reads per cell:

- **Occupancy**: ≥4 px of room fill in the inner 6×6, or ≥12 px of station-icon
  color (the yellow-on-red S/N icons fully displace a cell's fill — the same
  bug class as Super Metroid's green map-station letters, pre-empted by
  counting icon pixels as fill).
- **Fill variant** (`f`): majority vote magenta `(248,0,248)` vs green
  `(32,192,104)`. What the two colors _mean_ in the source is still an open
  question — they're preserved per cell and rendered as-is.
- **Walls** (`w`): ≥4 px of white + door color on the two lines straddling a
  boundary. Fusion's pause map has no SNES-style shafts and no diagonals, so
  `bands` is always empty and the SNES machinery never runs.
- **Ladders (stripped)**: elevator shafts are striped ladders — alternating
  1px fill/white rungs, at most 2px of fill across. Any occupied cell whose
  fill matches (narrow bbox, ≥3 fill/empty alternations along the run) loses
  its draw data entirely; connectors are hand-placed over those cells in the
  icon editor, exactly like Super Metroid's shafts. The dashed lines + numbers
  below the stubs are white-only and never occupy a cell in the first place.
- **Knob passages** (`k:"knob"`): a few rooms are drawn as a sub-cell box
  inset from the cell boundary, joined to neighbours by narrow twin-rail
  tunnels (main deck (13,16); each sector has 2–3). The tell is **background
  pixels on the cell's own perimeter ring** — an ordinary room covers its
  whole cell, so its ring never shows background (threshold: ≥4 of 28 ring
  px). For a knob, `w` is repurposed: its bits mark the sides where the box
  is inset and rails bridge the gap (a port side whose edge line still shows
  background), and `dr` holds a plain `"n"` pip per port — a side whose edge
  line shows the twin-rail signature (two white runs separated by a ≤4 px
  gap).
- **Doors** (`dr`): drawn in the source as a _gap in the white wall line_ —
  the room fill showing through for a normal hatch, a colored pip
  (red/yellow/green/blue) for locked doors. Where two rooms abut, the
  boundary carries **two** wall lines (one per room), and the gap can be
  drawn on only one of them: an **asymmetric door**, which belongs to one
  room only and must stay one-sided. So when both lines are wall-quality,
  each cell reads only its _own_ line; when just one is, that line is the
  shared outline and both cells classify from it. Detection on the chosen
  line: a 2–5 px non-white run **bounded by white on both ends**, classified
  by dominant door color (`"n"` if none). The bounded-run rule is what
  filters the baked caption boxes ("N:S:R" station labels): their solid
  outlines cross cell borders as full-width or edge-touching runs, never as
  white-bounded gaps. Colored hatches are drawn in the source as small
  H shapes (a jamb bar inside each room + a crossbar through the gap);
  `GuessMap.drawCell` mirrors that, each cell drawing its half of the H.
- **Ship**: the docked ship sprite is drawn in door-yellow _inside_ its
  room's fill. Its pixels land on cell-boundary columns where the room
  outline's corner pixels already contribute 2 white px — together they cross
  the wall threshold and split the docking bay. Any yellow blob bigger than a
  door pip or station letter (those stay within ~4×5) is stripped from the
  door mask before wall/door detection; it still counts toward occupancy via
  the icon rule.

Two empirical facts about the rips: all seven share the tile-grid alignment
offset (11,5), and each frames the map in a wide border of empty lattice
squares — ripper framing, not game data, so the extractor trims the render
viewport to the tile grid plus a 2-cell margin instead of keeping the source
canvas (unlike the SNES path, where the canvas is the in-game one).

Where the _full_ map sheet disagrees with the pause map (a collage that moved
a sub-area, a cropped last column, a room missing outright), the fix lives in
`maps.config.json` on the slicing side — `extraRows`/`extraCols` +
`includeCells` + `cellCropOffsets` — not in the extractor. See
`docs/adding-a-game.md` step 5 for the case-by-case playbook.

```
python pipeline/extract_gba_maps.py [game-id]   # needs Images/raw/<game>/ingame/<area>.*
```
