# ZebesGuessr

GeoGuessr, but for 2D Metroid. You're shown a mystery screen from the game;
click where it is on the map.

A strictly **non-commercial fan project**. No logins, no tracking, no ads.
Best scores live in your browser's localStorage.

## Play

Currently supports **Super Metroid**. Metroid Fusion and Metroid: Zero Mission
are planned.

## How it works

- 5 rounds per run, max 5,000 points each.
- Each round shows a crop of one screen. Difficulty presets control which rooms can show up. (tune `DIFFICULTIES` in
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

Community/speedrun room names live in `public/data/roomNames.<game>.json` as
`{"<areaId>:<x>,<y>": "Room Name"}`. Author them in-app with the **Name** tool
(under the **icons** editor): type a name and drag a rectangle over a room to
fill every cell, then **Save to file**. `loadGameData` merges the file over the
baked data, so no pipeline rerun is needed.

### Landmark icons

Save/Map/Ship/Boss icons live in `public/data/glyphs.<game>.json`
(`{"<areaId>": [{"x", "y", "t"}]}`) and override whatever the pipeline
extracts. Edit them by hand, or in the running app: click **icons** in the
round header, pick a tool, click cells to stamp or erase, then **Save to
file** (dev server only) and commit the JSON.

## Credits

- **Maps**: this project uses maps from [snesmaps.com](https://www.snesmaps.com)
  and the [VGMaps](https://www.vgmaps.com) community. The Super Metroid maps are
  the work of Rick Bruns — enormous thanks. The Metroid Fusion full maps were
  ripped by zerofighter & rocktyt (VGMaps' Maps Of The Month, September 2010),
  and the Fusion in-game map screens by Narasumas. The Metroid: Zero Mission
  full maps were ripped by rocktyt (Chozodia by zerofighter & rocktyt; VGMaps'
  Maps Of The Month, August 2008), and the Zero Mission in-game map screens by
  Eggie — all hosted at VGMaps. A few rooms are restored to an earlier story
  state using per-room renders from the
  [Randovania](https://randovania.org) project. The mapmakers are not
  affiliated with or involved in this project.
- **Landmark sprites**: the GBA rips draw boss arenas empty and the Super
  Metroid map rips omit the animals, so the pipeline composites
  boss/ship/creature poses onto them (`pipeline/composite_landmarks.py`).
  Those sprites were ripped by greiga master, Lexou Duck, Katuko, Gussprint,
  Ngamer01, Aquarius, Leix, Tommy Lee, Barack Obama, SkyLights, Chaofanatic,
  Deathbringer, Zechs, Omegakyogre, and Vic — hosted at
  [The Spriters Resource](https://www.spriters-resource.com) — with the
  assembled Zazabi, B.O.X., Yakuza, and Nightmare poses from
  [Metroid Wiki](https://www.metroidwiki.org). The
  rippers are not affiliated with or involved in this project.
- **Metroid, Samus Aran, and all game imagery** © Nintendo / developed by
  Nintendo R&D1 and Intelligent Systems. This project is not affiliated with,
  endorsed by, or connected to Nintendo in any way.
- Room nicknames come from the Super Metroid speedrunning community
  ([wiki.supermetroid.run](https://wiki.supermetroid.run), [deertier.com](https://deertier.com)).
- Built by Steve Fallon, creator of [Fantasy Critic](https://www.fantasycritic.games).

If you are a rights holder and want anything removed, open an issue and I'll remove it.

## License

Code is MIT licensed (see `LICENSE`). Game imagery and maps are **not** covered
by the code license and remain the property of their respective owners.
