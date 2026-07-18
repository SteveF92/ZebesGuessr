# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ZebesGuessr — GeoGuessr for 2D Metroid. Players see a cropped screen from the game and click where it is on a recreation of the in-game pause map. React + Vite + TypeScript frontend, Python pipeline that bakes map data into `public/`. A strictly non-commercial fan project: no logins, no tracking, no backend; best scores live in localStorage. Game imagery is © Nintendo — the MIT license covers code only.

## Workflow preferences

Unless the user asks for it, never use the browser tools to test or manually verify a change — it's too slow, and this is a simple app the user can check visually themselves faster than the agent can drive a browser session. This applies regardless of how confident you are in the change, overriding the general browser-verification workflow for this repo. Still verify with typecheck/build/tests where those are cheap and relevant, and still test anything you're genuinely unsure about via those means.

At the end of a long working session, commit the work (unless the user says otherwise). This leaves a clear boundary so any subsequent tweaks by the user appear as separate commits on top, rather than getting lost in a unified changeset.

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
python pipeline/download_maps.py [game]       # fetch source maps into Images/raw/ (gitignored)
python pipeline/slice_maps.py [game]          # slice per-screen tiles, write base public/data/<game>.json
python pipeline/extract_ingame_maps.py [game] # patch that JSON with per-area "map" objects (mapStyle "snes")
python pipeline/extract_gba_maps.py [game]    # same, for mapStyle "gba" (Metroid Fusion / Zero Mission)
```

`Images/raw/` is gitignored because it's re-downloadable — except when it isn't. An area flagged `"localSource": true` in `maps.config.json` has a hand-fixed source map that supersedes the web rip (the download was wrong or incomplete); its committed copy lives in `pipeline/source-maps/<game>/<area>.png` and `download_maps.py` seeds `Images/raw/` from there instead of fetching. That committed PNG is the source of truth, so a fresh clone reproduces the corrected data. `background` is normally a game-wide key but can be overridden per area — Fusion's sector-3 is a `"black"`-void detail rip among white-void siblings, so its fill-threshold polarity is set on the area, not the game.

Order matters: `slice_maps.py` writes the base JSON (the tile list — one entry per sliced screen), the style-matching extractor patches it in place (folds each cell's draw data onto that list and adds the `map` viewport). `mapStyle` in `maps.config.json` (baked into the JSON) decides which extractor owns a game; each skips the other's, and shared plumbing lives in `pipeline/maplib.py`. Tiles are `cellSize` square (SNES, 256) or `cellWidth`×`cellHeight` (GBA, 240×160 — one screen per map cell). `pipeline/debug/` gets grid-overlay images for checking alignment; fix misalignment via per-area `offsetX`/`offsetY` in `pipeline/maps.config.json`. The whole play-through of adding a game is documented in `docs/adding-a-game.md`.

The extractor never drops a cell. If the pause map draws something the sliced map has no tile for, it keeps it and prints a **WARNING** naming the cells — fix it by adding them to `includeCells` in `maps.config.json` (a dark room under `slice_maps.py`'s fill threshold, usually). It should always be zero; the old behaviour was to silently delete those targets, which cost a long line of "recover room X as a valid tile" commits.

`slice_maps.py` re-generates every tile PNG for a game each run and **prunes** any cell PNG no longer playable (so removed cells leave no orphans and `public/tiles/<game>/<area>/` always matches the JSON). A handful of tiles are hand-painted to fill a partial source screen (a room clipped by the sheet edge, or a game-side quirk) — list those cells in an area's `keepTiles` so the re-slice doesn't overwrite the committed PNG. The cell stays playable and in the JSON; only its tile write is skipped (a first run with no PNG yet still writes the base to edit from).

The pipeline is reproducible: rerunning it (then `npm run format`) reproduces the committed `<game>.json` — no hand-edits live in that file. Both scripts write `json.dumps(..., indent=2)` so Prettier keeps objects expanded (one field per line); the extractor bakes in `mapOverrides.<game>.json` (see below) so the diagonals it can't fit stay correct. `extract_ingame_maps.py` globs `public/data/*.json` and skips any file lacking a top-level `game`/`areas` key, so the sidecar files (`glyphs.*`, `overlays.*`, `difficulty.*`, `roomNames.*`, `mapOverrides.*`) are left untouched.

## One cell list, one coordinate system

**Everything is tile coordinates** — `area.cells`, glyphs, bands, connectors, room names, difficulty keys, tile URLs (`tiles/<game>/<area>/cell_<x>_<y>.png`), scoring, `App` state. Don't reintroduce a second space.

`area.cells` is the single source of truth: **every cell of the area, drawn or not.** A cell carries optional draw data answering the only question the pause map adds — _what to draw, if anything_:

- `k` (kind) + `w` (walls), plus `d` for stairs — the pause map charts this cell. GBA-style cells may also carry `f` (fill-variant index) and `dr` (door pips, side+color strings like `"Nr"`/`"En"`).
- **no `k`** — it doesn't (elevator shafts and Maridia's tube runs, whose cyan-only rails are drawn as overlay `connectors` instead). Still a real tile, still pointable.

Draw data is all-or-nothing, and `AreaCell`'s union type enforces it: `if (!c.k) return;` narrows `c.w` to a number. Whether a cell is _served_ as a target is difficulty's job (`EXCLUDED_RATING` = 6, never served) — not this list's. There is no "secret"/excluded cell flag; don't add one.

The pause-map canvas is bigger than the tile grid and has its own origin (Wrecked Ship's 12×10 grid sits inside a 31×19 canvas at `(10,4)`), so `area.map.{cols,rows,dx,dy}` survives as a **render viewport only**. `dx`/`dy` appear in exactly two places, and must stay that way: `GuessMap.draw`'s single `ctx.translate(dx*S, dy*S)` (after which all draw math is plain tile coords) and its mirror `cellFromPoint` (which subtracts them). If you find yourself adding `+dx` inside a draw call, you're re-creating the trap this replaced.

## Architecture

- `src/App.tsx` — the whole game flow as a phase state machine (`menu → loading → guessing → reveal → summary`). Game data is fetched at runtime from `public/data/<game>.json`.
- `src/components/GuessMap.tsx` — canvas recreation of the in-game pause map (rooms, shafts, walls, diagonal stair bands, door pips, landmark glyphs), with a palette per `mapStyle` (`SNES_COL`/`GBA_COL`). Also contains the icon editor.
- `src/components/TileViewer.tsx` — shows the mystery screen; difficulty crops via CSS scale.
- `src/scoring.ts` — pure functions: distance, exponential score falloff, difficulty presets (`DIFFICULTIES`: crop tightness × score multiplier), rank names. Tune game feel here.
- `src/data.ts` — data loading, target picking, URL helpers.

Asset URLs must be prefixed with `import.meta.env.BASE_URL` — Vite `base` is `/`, since the site is served at the root of zebesguessr.com.

## Hosting

Static site on S3 + CloudFront in AWS account 433030147996, served at **www.zebesguessr.com** — the canonical name. Both names point at the one distribution, and a CloudFront Function on viewer-request 301s the apex to www, preserving path and query string (`?seed=` links must survive it). Share links and anything else naming the site should use the www form. `infra/site.yml` is the CloudFormation template defining every piece of it — bucket, distribution, ACM cert, Route 53 records, and the IAM role GitHub assumes. It is the source of truth: change infrastructure by editing it and updating the stack, not by clicking in the console.

`.github/workflows/deploy.yml` builds and deploys on push to main. It authenticates via GitHub's OIDC provider — there are no AWS keys in the repo's secrets, and the role's trust policy only accepts workflows running on `main` in this repo. The bucket name is hardcoded in the workflow's `env`; the distribution id and role ARN come from repo-level Actions **variables** (`CLOUDFRONT_DISTRIBUTION_ID`, `AWS_DEPLOY_ROLE_ARN`), which are stack outputs.

Cache headers are set per-path at upload time, and CloudFront honors them: hashed assets and baked tiles are `immutable` (one year), `data/*.json` gets 60 seconds, and `index.html` is `no-cache`. If you add a path that changes in place under a stable name, give it a short TTL or a deploy won't reach users.

## Hand-curated map overlays (glyphs, connectors, room names)

Three files hold data the pipeline can't reliably extract, all edited via the in-app editor (**icons** toggle in the round header) and applied by `loadGameData` as overrides on top of extraction:

- `public/data/glyphs.<game>.json` — Save/Map/Ship/Boss landmark icons.
- `public/data/overlays.<game>.json` — transit **connectors** (elevator shafts and dashed tube runs, unified), keyed `{ areaId: { connectors } }`. Each connector is axis-aligned between two whole cells (`{ x0, y0, x1, y1 }` — `x0===x1` vertical, `y0===y1` horizontal), rendered with twin cyan rails + a dashed pink core, with an optional `label` on any side (`labelPos: "above" | "below" | "left" | "right"`). `loadGameData` also folds any legacy pre-merge `elevators`/`lines` fields into `connectors`.
- `public/data/roomNames.<game>.json` — flat `{ "areaId:x,y": name }`, shown at reveal/summary via `roomName()`. `loadGameData` merges it over the baked `GameData.roomNames` key by key.

The editor's tools stamp glyphs, place connectors (two clicks: the drag's dominant axis picks horizontal vs vertical; name via the toolbar field, cycle the label side with the **Label** button), and paint room names (**Name** tool: type a name, click one corner then the opposite corner to fill every playable cell in the rectangle; click a named cell with an empty field to load its name; named cells are tinted in edit mode, and the **debug** panel shows the hovered cell's current name). **Erase** removes any of them. **Save to file** POSTs all three to `/__save-map`, a dev-only Vite middleware (`glyphSaver` in `vite.config.ts`) that writes the JSON directly for committing. The pipeline never overwrites these files (`extract_ingame_maps.py` skips any sidecar lacking a top-level `game` key; `slice_maps.py`'s `load_room_names` reads `roomNames.<game>.json` rather than writing it).

A connector is only _how a run gets drawn_; the cells under it are ordinary `area.cells` entries that simply carry no draw data (no `k`), so the map draws the connector rather than a room box. They're real tiles, so the X-Ray overlay (`showTiles`) paints the actual elevator shaft / tube there — which means they're guessable, so rate them **difficulty 6**. Connectors whose source art is only an exit arrow + caption (all of Crateria's and Wrecked Ship's) have no tile at all — they fall under `slice_maps.py`'s fill threshold, so no cell exists and nothing is drawn but the connector.

### `mapOverrides.<game>.json` — pipeline-applied (not a runtime overlay)

Unlike the four files above (merged at runtime by `loadGameData`), `mapOverrides.<game>.json` is consumed by `extract_ingame_maps.py` and **baked into `<game>.json`** — so the extraction stays reproducible while the map data the pixel heuristics can't nail stays hand-perfect. It's hand-edited JSON (no editor tool), keyed by areaId:

- `cells` — upserts a cell's draw data by `(x, y)`, each `{ x, y, k, w, [d] }`. Used to reclassify a room as a stair (`k: "diag"`) or to draw rooms the heuristics miss (Wrecked Ship's `(9,9)`, six Norfair rooms).
- `bands` — replaces the area's whole `map.bands` list. The auto-fitted stair polygons (`extract_diag_bands`) overshoot and look rough; these are clean hand-drawn ones (fractional cells). The extractor still runs its own fit first (its sliver-deletion side effect is kept), then this array wins.
- `removeCells` — deletes cells the pause map draws but shouldn't, each `[x, y]`. Reach for it when the source rip charts a pause-map room over blank detail-map space (a white/void screen with no real tile) yet the pause map still draws it: drop the tile too (`excludeCells`, or just don't force it in with `includeCells`); this drops the leftover draw data so `merge_cells` doesn't keep it as a tile-less target. Pair it with a `cells` upsert on any neighbour left with a door pip into the now-empty slot. Prefer fixing the **source** over this band-aid when you can — Fusion sector-3's second save room `(17,4)` was exactly this phantom (the rip left it white) until the source PNG was corrected and pinned via `localSource`, at which point both this `removeCells` and its paired `(16,4)` upsert were deleted and the room extracts naturally.

All three are tile coords and applied **after** alignment, like everything else.

When you re-perfect a diagonal, edit this file — not `<game>.json` — then rerun `extract_ingame_maps.py` + `npm run format`.

## Map extraction heuristics

`extract_ingame_maps.py` quantizes pause-map recreations onto an 8px grid and cleans up three artifact classes at the pixel level: phantom rooms (caption text/exit arrows drawn in room pink), rooms misread as shafts because a baked-in station icon displaces their pink fill, and diagonal stair corridors (fitted as clipped sub-cell polygons in `map.bands`, rendered as filled polygons in `GuessMap.drawBand`). The thresholds are empirical and documented — read `docs/map-extraction-notes.md` before changing them, and re-validate against all six areas (the notes hold for Super Metroid; other games need re-checking).

Dev aids in the round header: **debug** toggle previews the real screen for any hovered map cell — useful when validating map/tile alignment.
