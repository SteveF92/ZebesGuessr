# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ZebesGuessr — GeoGuessr for 2D Metroid. Players see a cropped screen from the game and click where it is on a recreation of the in-game pause map. React + Vite + TypeScript frontend, Python pipeline that bakes map data into `public/`. A strictly non-commercial fan project: no logins, no tracking, no backend; best scores live in localStorage. Game imagery is © Nintendo — the MIT license covers code only.

## Workflow preferences

Unless the user asks for it, never use the browser tools to test or manually verify a change — it's too slow, and this is a simple app the user can check visually themselves faster than the agent can drive a browser session. This applies regardless of how confident you are in the change, overriding the general browser-verification workflow for this repo. Still verify with typecheck/build/tests where those are cheap and relevant, and still test anything you're genuinely unsure about via those means.

## Commands

```
npm run dev        # Vite dev server (also launchable via .claude/launch.json "dev", port 5173)
npm run build      # tsc -b && vite build
npx tsc -b         # typecheck only
npm test           # vitest run (scoring + target-picking unit tests)
npx vitest run src/scoring.test.ts   # single test file
npm run format      # prettier --write . — includes public/data/*.json (diffs nicer pretty-printed), excludes public/tiles and pipeline/debug
```

Run `npm run format` before every commit. This includes `public/data/*.json` — Python's `json.dump` doesn't match Prettier's formatting, so also run it after regenerating those files via the pipeline.

There is no lint setup. The map pipeline (Python, needs `pip install pillow numpy`) only matters when regenerating data — the repo ships with baked tiles/JSON:

```
python pipeline/download_maps.py       # fetch source maps into Images/raw/ (gitignored)
python pipeline/slice_maps.py          # slice 256px tiles, write base public/data/<game>.json
python pipeline/extract_ingame_maps.py # patch that JSON with per-area "map" objects
```

Order matters: `slice_maps.py` writes the base JSON, `extract_ingame_maps.py` patches it in place (adds `map`, filters playable cells). `pipeline/debug/` gets grid-overlay images for checking alignment; fix misalignment via per-area `offsetX`/`offsetY` in `pipeline/maps.config.json`.

The pipeline is reproducible: rerunning it (then `npm run format`) reproduces the committed `<game>.json` — no hand-edits live in that file. Both scripts write `json.dumps(..., indent=2)` so Prettier keeps objects expanded (one field per line); the extractor bakes in `mapOverrides.<game>.json` (see below) so the diagonals it can't fit stay correct. `extract_ingame_maps.py` globs `public/data/*.json` and skips any file lacking a top-level `game`/`areas` key, so the sidecar files (`glyphs.*`, `overlays.*`, `difficulty.*`, `roomNames.*`, `mapOverrides.*`) are left untouched.

## The two coordinate systems (main trap)

Every cell lives in two grids:

- **Tile grid** — 256px screen cells from the sliced source maps. Used for playable cells (`area.cells`), scoring, and tile URLs (`tiles/<game>/<area>/cell_<x>_<y>.png`).
- **Map grid** — 8px cells of the in-game pause map, which has its own origin. Used for everything drawn in `GuessMap` (`area.map.cells`, glyphs, bands).

Conversion: `map (x,y) = tile (x+dx, y+dy)` with `dx`/`dy` on `area.map`. `GuessMap` renders and hit-tests in map coordinates but reports selections/hovers in tile coordinates (converts at the click/hover boundary). Scoring and `App` state are tile-coordinate only.

## Architecture

- `src/App.tsx` — the whole game flow as a phase state machine (`menu → loading → guessing → reveal → summary`). Game data is fetched at runtime from `public/data/<game>.json`.
- `src/components/GuessMap.tsx` — canvas recreation of the SNES pause map (rooms, shafts, walls, diagonal stair bands, landmark glyphs). Also contains the icon editor.
- `src/components/TileViewer.tsx` — shows the mystery screen; difficulty crops via CSS scale.
- `src/scoring.ts` — pure functions: distance, exponential score falloff, difficulty presets (`DIFFICULTIES`: crop tightness × score multiplier), rank names. Tune game feel here.
- `src/data.ts` — data loading, target picking, URL helpers.

Asset URLs must be prefixed with `import.meta.env.BASE_URL` — Vite `base` is `/ZebesGuessr/` for GitHub Pages (deploys automatically on push to main via `.github/workflows/deploy.yml`).

## Hand-curated map overlays (glyphs, connectors, room names)

Three files hold data the pipeline can't reliably extract, all edited via the in-app editor (**icons** toggle in the round header) and applied by `loadGameData` as overrides on top of extraction:

- `public/data/glyphs.<game>.json` — Save/Map/Ship/Boss landmark icons.
- `public/data/overlays.<game>.json` — transit **connectors** (elevator shafts and dashed tube runs, unified), keyed `{ areaId: { connectors } }`. Each connector is axis-aligned between two whole map cells (`{ x0, y0, x1, y1 }` — `x0===x1` vertical, `y0===y1` horizontal), rendered with twin cyan rails + a dashed pink core, with an optional `label` on any side (`labelPos: "above" | "below" | "left" | "right"`). `loadGameData` also folds any legacy pre-merge `elevators`/`lines` fields into `connectors`.
- `public/data/roomNames.<game>.json` — flat `{ "areaId:tileX,tileY": name }` (tile coords), shown at reveal/summary via `roomName()`. `loadGameData` merges it over the baked `GameData.roomNames` key by key. Note the two coordinate systems: the **Name** tool takes clicks in map coords and converts to tile coords (`-dx/-dy`) before keying, so its cells line up with guess targets and glyph/connector cells do **not** (those stay in map coords).

The editor's tools stamp glyphs, place connectors (two clicks: the drag's dominant axis picks horizontal vs vertical; name via the toolbar field, cycle the label side with the **Label** button), and paint room names (**Name** tool: type a name, click one corner then the opposite corner to fill every playable cell in the rectangle; click a named cell with an empty field to load its name; named cells are tinted in edit mode, and the **debug** panel shows the hovered cell's current name). **Erase** removes any of them. **Save to file** POSTs all three to `/__save-map`, a dev-only Vite middleware (`glyphSaver` in `vite.config.ts`) that writes the JSON directly for committing. The pipeline never overwrites these files (`extract_ingame_maps.py` skips any sidecar lacking a top-level `game` key; `slice_maps.py`'s `load_room_names` reads `roomNames.<game>.json` rather than writing it). Connectors and room names are overlay-only — not in `area.cells`, so they never become guess targets.

### `mapOverrides.<game>.json` — pipeline-applied (not a runtime overlay)

Unlike the four files above (merged at runtime by `loadGameData`), `mapOverrides.<game>.json` is consumed by `extract_ingame_maps.py` and **baked into `<game>.json`** — so the extraction stays reproducible while the map data the pixel heuristics can't nail stays hand-perfect. It's hand-edited JSON (no editor tool), keyed by areaId:

- `cells` — upserts individual pause-map cells by `(x, y)`, in map coords, each `{ x, y, k, w, [d] }` (same shape as `area.map.cells`). Used to reclassify a room as a stair (`k: "diag"`) or to add real rooms the heuristics miss. Applied **before** grid alignment, so an added map cell also keeps its matching guess target playable (that target would otherwise be filtered out — this is how Wrecked Ship's `(9,9)` and six Norfair rooms survive).
- `bands` — replaces the area's whole `map.bands` list. The auto-fitted stair polygons (`extract_diag_bands`) overshoot and look rough; these are clean hand-drawn ones (fractional map coords). The extractor still runs its own fit first (its sliver-deletion side effect is kept), then this array wins.

When you re-perfect a diagonal, edit this file — not `<game>.json` — then rerun `extract_ingame_maps.py` + `npm run format`.

## Map extraction heuristics

`extract_ingame_maps.py` quantizes pause-map recreations onto an 8px grid and cleans up three artifact classes at the pixel level: phantom rooms (caption text/exit arrows drawn in room pink), rooms misread as shafts because a baked-in station icon displaces their pink fill, and diagonal stair corridors (fitted as clipped sub-cell polygons in `map.bands`, rendered as filled polygons in `GuessMap.drawBand`). The thresholds are empirical and documented — read `docs/map-extraction-notes.md` before changing them, and re-validate against all six areas (the notes hold for Super Metroid; other games need re-checking).

Dev aids in the round header: **debug** toggle previews the real screen for any hovered map cell — useful when validating map/tile alignment.
