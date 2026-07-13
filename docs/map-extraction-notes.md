# Map extraction notes: phantom rooms & diagonal corridors

The guess map is rebuilt from the in-game pause-map recreations by
`pipeline/extract_ingame_maps.py`, which quantizes each source image onto an
8px cell grid. Two classes of artifact come out of that quantization. Both are
handled at the **pixel level, before quantization** (an earlier cell-level
approach missed several cases); the rules below hold for Super Metroid today
and are worth re-validating for another game or a re-sourced map.

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
   while the smallest *real* geometry (a one-tile room interior) is 26+ px at
   enclosure `≥ 0.75`. Elevator-room tiles at the map edge (enclosure
   `0.75–0.88`) are real map in the actual game and survive, correctly.
2. **Occupancy requires pink** — a cell's `fill` counts pink/ship/green
   pixels only; cyan no longer contributes. This kills the rail-only and
   cyan-dash cells.

`drop_label_text` (drop wall-less 8-connected cell components) is retained as
a cheap backstop; after the pixel-level pass it removes nothing.

### Residual difficulties / assumptions
- The 24px / 0.5-enclosure thresholds are empirical, though the observed gap
  is wide (0.38 vs 0.75). A real pink feature smaller than 24px *without* a
  cyan outline would be wrongly erased; none exist here.
- Tiny pink "door nub" ticks (1–3 px, enclosure ≥ 0.55) are left in place;
  they never reach the 4px occupancy threshold on their own.
- A real cell whose pink sits entirely on cell-boundary rows could in theory
  lose occupancy now that cyan doesn't count; diffing old vs new output showed
  zero such losses (every removed cell was a verified artifact).
- Maridia's internal dashed transit lines are removed along with the exit
  markers. The real pause map draws them as dashed lines, not rooms — if we
  ever want them visually, they'd need a dedicated decoration layer.

## Diagonal corridors (stair passages)

### What they were
The pause map draws diagonal hallways as a smooth **sub-cell pink band edged
with 1px cyan on both sides** — and *not* at 45°: Crateria's moat descent runs
~27°, Norfair's west passage ~26°. Quantized, each band became a ragged
staircase; rendered as per-cell 45° strokes it read as a hatch of disconnected
slashes.

### How it's handled
Per 8-connected chain of `diag`-tagged cells (the per-cell tag still comes
from the pink x/y correlation heuristic, `|corr| ≥ 0.2`):

- **Band fit** (`extract_diag_bands`): PCA over the chain's source pink
  pixels gives a centerline + width; endpoints are padded 0.3 cells so the
  band tucks under the rooms at each end. Stored per area as
  `map.bands = [{x1,y1,x2,y2,w}]` in fractional map-cell coordinates.
- **Real vs display-only cells**: chain cells with
  `pink ≥ DIAG_SOLID_PX (24)` stay in `map.cells` as clickable `diag` tiles
  (Crateria 4, Norfair 3 — one per staircase step, like the real game's map
  tiles). Corner slivers (~12 px) are deleted — including *neighbour* cells
  whose sub-24px pink lies entirely within the band's perpendicular extent
  (the correlation heuristic misses some corner spills, e.g. Norfair's
  `(8,9)`, which otherwise render as floating shaft stubs).
- **Renderer** (`GuessMap.drawBand`): each band is one pink stroke of width
  `w` cells with a 2px cyan line along each long edge, drawn *before* the
  cells so room fills cover the padded ends. `diag` cells draw nothing
  themselves; they exist for hover/click/targets.

### Residual difficulties / assumptions
- A band is fitted per chain of `≥ 2` diag cells; a lone mis-tagged cell gets
  no band and draws nothing. None exist today.
- The fit assumes one *straight* band per chain. A genuinely bent stair
  passage would need the chain split before fitting.
- Playable targets on sliver cells are dropped by the alignment filter (they
  are not selectable map tiles, matching the real game's one-tile-per-step
  map data).

## Regenerating

```
python pipeline/extract_ingame_maps.py   # needs Images/raw/<game>/ingame/*.webp
```

Landmark icons in `public/data/glyphs.<game>.json` are **not** touched by this
step (the file is skipped explicitly) and always override whatever glyphs
extraction produces.
