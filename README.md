# ZebesGuessr

GeoGuessr, but for 2D Metroid. You're shown a mystery screen from the game;
click where it is on the map. Pick your difficulty — from Recruit (the full
screen, fewer points) to Chozo Warrior (a tight crop, bonus points).

A strictly **non-commercial fan project**. No logins, no tracking, no ads.
Best scores live in your browser's localStorage.

## Play

Currently supports **Super Metroid**. Metroid Fusion and Metroid: Zero Mission
are planned.

## How it works

- 5 rounds per run, max 5,000 points each.
- Each round shows a crop of one screen. Difficulty presets control how
  tight the crop is and the score multiplier (tune `DIFFICULTIES` in
  `src/scoring.ts`).
- A debug toggle in the round header previews the real screen for any
  hovered map cell — useful when tuning map data.
- Score falls off with distance from the true cell. Wrong area = 0.

## Development

```
npm install
npm run dev
```

### Map pipeline

The repo ships with pre-sliced tiles in `public/tiles/`. To regenerate them:

```
python pipeline/download_maps.py   # fetches source maps into Images/raw/ (gitignored)
pip install pillow
python pipeline/slice_maps.py      # slices tiles, builds public/data/*.json
```

`pipeline/debug/` gets grid-overlay images for checking cell alignment; tune
per-area `offsetX`/`offsetY` in `pipeline/maps.config.json` if the grid is off.

`extract_ingame_maps.py` also drops caption text mis-read as rooms (any
wall-less connected blob — `BRINSTAR`/`MARIDIA`/… labels) and tags sub-cell
diagonal corridors (`k: "diag"`) so stair passages render as one line.

Community/speedrun room names can be added in `pipeline/room_names/<game>.json`
as `{"<areaId>:<x>,<y>": "Room Name"}`.

### Landmark icons

Save/Map/Ship/Boss icons live in `public/data/glyphs.<game>.json`
(`{"<areaId>": [{"x", "y", "t"}]}`) and override whatever the pipeline
extracts. Edit them by hand, or in the running app: click **icons** in the
round header, pick a tool, click cells to stamp or erase, then **Save to
file** (dev server only) and commit the JSON.

## Credits

- **Maps**: Rick Bruns ([snesmaps.com](https://www.snesmaps.com)) — enormous
  thanks. Additional maps referenced from the [VGMaps](https://www.vgmaps.com)
  community atlas.
- **Metroid, Samus Aran, and all game imagery** © Nintendo / developed by
  Nintendo R&D1 and Intelligent Systems. This project is not affiliated with,
  endorsed by, or connected to Nintendo in any way.
- Room nicknames come from the Super Metroid speedrunning community
  ([wiki.supermetroid.run](https://wiki.supermetroid.run), [deertier.com](https://deertier.com)).

If you are a rights holder and want anything removed, open an issue and it's gone.

## License

Code is MIT licensed (see `LICENSE`). Game imagery and maps are **not** covered
by the code license and remain the property of their respective owners.
