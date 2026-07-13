# Per-tile difficulty

Every playable cell has a difficulty rating **1–5** (1 = unmissable landmark,
5 = anonymous corridor). Ratings drive two things at runtime:

- **Pool filtering** — the menu tiers draw round targets from a rating band
  (`Difficulty.min`–`max` in `src/scoring.ts`): Recruit 1–3, Bounty Hunter 2–4,
  Chozo Warrior 3–5. If a band holds fewer cells than a run needs,
  `pickTargets` falls back to the full pool.
- **Score multiplier** — `tileMult(rating)` = ×0.75 at rating 1 up to ×1.25 at
  rating 5; the tile itself carries the reward, there is no per-tier multiplier.

## Data file

`public/data/difficulty.<game>.json` — flat `{ "areaId:tileX,tileY": rating }`
in **tile** coordinates, the same keying as `roomNames.<game>.json`. Loaded by
`loadGameData` as an overlay; a missing file or missing key means the neutral
default rating **3** (`DEFAULT_RATING`). All tier bands include 3, so unrated
data behaves identically on every tier — the feature activates as ratings land.

No such file exists yet; the sections below sketch how we plan to generate one.

## Assigning ratings (planned heuristic — not built yet)

Prerequisite: finish naming rooms via the editor's **Name** tool
(`roomNames.<game>.json`). Then blend two signals:

1. **Room-name signals.** Group cells by shared name. Keyword scoring: boss and
   landmark names, "Landing Site", "…Station", save/map rooms → easy;
   "Shaft", "Corridor", "Speedway", "Pit", "Tube" → hard. Add glyph proximity
   from `glyphs.<game>.json`: cells within a couple of map cells of a
   save/map/ship/boss glyph rate easier, since players triangulate off
   landmarks.
2. **Visual distinctness** (needs no names — can run any time). A pipeline
   script (`pipeline/rate_tiles.py`, to be written) computes cheap per-tile
   features from `public/tiles/<game>/<area>/cell_x_y.png` — downsampled
   grayscale + color histogram (Pillow/numpy are already pipeline deps) — and
   scores distinctness as the distance to the nearest other tile in the game.
   A tile with ten near-duplicates is hard; a one-of-a-kind screen is easy.

Blend: normalize both to 0–1, weighted average, quantize to 1–5, write
`public/data/difficulty.<game>.json`. Hand-tweak by editing the file directly;
a rating tool in the in-app icon editor (same save path as the Name tool) is a
possible follow-up.
