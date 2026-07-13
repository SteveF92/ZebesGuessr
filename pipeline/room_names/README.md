# Community room names (legacy location)

Room names now live in **`public/data/roomNames.<game>.json`** and are authored
in-app with the **Name** tool in the icon editor (type a name, drag a rectangle
over a room, **Save to file**). `slice_maps.py`'s `load_room_names` reads that
public file first and only falls back to a `<game-id>.json` placed *here* if the
public file is absent — so you normally don't need this directory.

Format either way is `<areaId>:<x>,<y>` → name, x/y being cell coordinates from
`public/data/<game-id>.json`:

```json
{
  "crateria:22,11": "Bomb Torizo Room",
  "brinstar:5,3": "Etecoon Shaft"
}
```

A cell inside a multi-cell room shares the room's name — fill the cells players
are likely to hit. Good sources: wiki.supermetroid.run room list, speedrun.com.
