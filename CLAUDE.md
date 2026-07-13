# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ZebesGuessr — GeoGuessr for 2D Metroid. Players see a cropped screen from the game and click where it is on a recreation of the in-game pause map. React + Vite + TypeScript frontend, Python pipeline that bakes map data into `public/`. A strictly non-commercial fan project: no logins, no tracking, no backend; best scores live in localStorage. Game imagery is © Nintendo — the MIT license covers code only.

## Commands

```
npm run dev        # Vite dev server (also launchable via .claude/launch.json "dev", port 5173)
npm run build      # tsc -b && vite build
npx tsc -b         # typecheck only
npm test           # vitest run (scoring + target-picking unit tests)
npx vitest run src/scoring.test.ts   # single test file
```

There is no lint setup. The map pipeline (Python, needs `pip install pillow numpy`) only matters when regenerating data — the repo ships with baked tiles/JSON:

```
python pipeline/download_maps.py       # fetch source maps into Images/raw/ (gitignored)
python pipeline/slice_maps.py          # slice 256px tiles, write base public/data/<game>.json
python pipeline/extract_ingame_maps.py # patch that JSON with per-area "map" objects
```

Order matters: `slice_maps.py` writes the base JSON, `extract_ingame_maps.py` patches it in place (adds `map`, filters playable cells). `pipeline/debug/` gets grid-overlay images for checking alignment; fix misalignment via per-area `offsetX`/`offsetY` in `pipeline/maps.config.json`.

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

## Landmark glyphs are hand-curated

`public/data/glyphs.<game>.json` (Save/Map/Ship/Boss icons) is edited by hand or via the in-app editor: the **icons** toggle in the round header stamps/erases glyphs, and **Save to file** POSTs to `/__save-glyphs`, a dev-only Vite middleware (`glyphSaver` in `vite.config.ts`) that writes the JSON directly for committing. `loadGameData` applies this file as an override on top of whatever the pipeline extracted, and `extract_ingame_maps.py` deliberately never touches it. Don't regenerate or overwrite it from pipeline code.

## Map extraction heuristics

`extract_ingame_maps.py` quantizes pause-map recreations onto an 8px grid and cleans up three artifact classes at the pixel level: phantom rooms (caption text/exit arrows drawn in room pink), rooms misread as shafts because a baked-in station icon displaces their pink fill, and diagonal stair corridors (fitted as clipped sub-cell polygons in `map.bands`, rendered as filled polygons in `GuessMap.drawBand`). The thresholds are empirical and documented — read `docs/map-extraction-notes.md` before changing them, and re-validate against all six areas (the notes hold for Super Metroid; other games need re-checking).

Dev aids in the round header: **debug** toggle previews the real screen for any hovered map cell — useful when validating map/tile alignment.
