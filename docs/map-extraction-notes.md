# Map extraction notes: phantom rooms & diagonal corridors

The guess map is rebuilt from the in-game pause-map recreations by
`pipeline/extract_ingame_maps.py`, which quantizes each source image onto an
8px cell grid. Two classes of artifact come out of that quantization. Both are
handled now, but the handling rests on assumptions that are worth writing down
— they hold for Super Metroid today and could break for another game or a
re-sourced map.

## Phantom rooms (area-transition captions)

### What they were
Each area map prints red-pink captions for its exits — `BRINSTAR` (×3),
`MARIDIA`, `WRECKED SHIP`, etc. Those captions are drawn in **exactly** the
room fill colour `(216, 56, 144)`, so the grid read the letters as small
clusters of room cells: floating `[■—■]` dumbbells with nothing around them.

### How it's handled
Real rooms and shafts are always outlined in cyan; caption text never is. So
after extraction we compute 8-connected components of the occupied cells and
drop any component in which **every** cell has `walls == 0`. For Super Metroid
this removed exactly the captions (16 / 8 / 4 / 4 / 4 / 4 cells across the six
areas) and left one connected component per area. Zero playable target cells
were affected.

### Residual difficulties / assumptions
- **Captions must stay disconnected from real geometry.** If a label sat
  within 8-connectivity of a room (letters touching a room corner), its
  component would inherit that room's cyan walls and survive. None do today,
  but tighter-set labels on another map could.
- **Every real region must carry at least one cyan wall.** The filter assumes
  a wall-less connected component is never real map. That's true here because
  rooms/shafts are cyan-outlined, but a hypothetical fully-open region with no
  drawn walls would be wrongly deleted.
- **Diagonal cells are wall-less** (see below) and survive *only* because they
  connect to walled rooms. An isolated diagonal fragment with no walled
  neighbour would be treated as a caption and dropped.
- The rule keys on the extractor's detected `walls`, so a missed cyan edge
  (thin/antialiased wall) could make a real cell look wall-less. Not observed,
  but it's the same signal both features lean on.

## Diagonal corridors (stair passages)

### What they were
The pause map draws diagonal hallways as a smooth **sub-cell 45° pink band**
that is not aligned to the 8px grid. Quantized, each band became a ragged row
of thin `hshaft` bars that don't touch — a "staircase of dashes" that read as
noise rather than a passage. Crateria's moat is the obvious one; Norfair has a
smaller one.

### How it's handled
Detected from the **source pixels**, not the quantized cells: within a
wall-less cell we measure the correlation of the pink pixels' x/y offsets.
A solid room or a straight shaft correlates ~`0.0`; a diagonal band correlates
strongly (observed `0.3`–`0.47`). Cells over `|corr| ≥ 0.2` are tagged
`k: "diag"` with a direction (`"/"` or `"\\"`), and the renderer draws each as
a corner-to-corner band. Neighbouring diag cells share a corner, so the line is
continuous.

Detected instances (all that exist):

| area     | cells | dir | notes            |
|----------|-------|-----|------------------|
| crateria | 8     | `/` | the moat descent |
| norfair  | 6     | `\` | west shaft       |

### Residual difficulties / assumptions
- **The band is ~2 cells thick, so it renders as two parallel lines**, not one
  centered line. It reads clearly as a diagonal corridor but isn't a single
  clean stroke. Thinning to a 1-wide centerline (and marking direction per
  chain) is possible but not done — it risks dropping clickable target cells.
- **`|corr| ≥ 0.2` is a heuristic.** A wall-less room cell whose pink happens
  to form a diagonal notch could be mis-tagged as `diag`. None observed, but
  the threshold is empirical, tuned on two corridors.
- **Only sub-cell bands are detected.** A diagonal that the source draws as
  clean, fully-filled stair-stepped cells (no partial fill) would correlate
  ~`0.0` and stay a blocky staircase — this detector wouldn't catch it.
- **No continuity check.** Direction is decided per cell from local pixels;
  cells aren't validated as a connected monotonic chain. It happens to be
  consistent here, but a noisy cell could point the "wrong way" and kink the
  line.
- Diag cells are still individually clickable and count as occupied — good for
  gameplay, but it means the corridor's clickable footprint is the union of the
  quantized cells, which is slightly fatter than the drawn line.

## Regenerating

```
python pipeline/extract_ingame_maps.py   # needs Images/raw/<game>/ingame/*.webp
```

Landmark icons in `public/data/glyphs.<game>.json` are **not** touched by this
step and always override whatever glyphs extraction produces.
