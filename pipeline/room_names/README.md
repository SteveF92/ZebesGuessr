# Community room names

Optional. Create `<game-id>.json` here (e.g. `super-metroid.json`) mapping
grid cells to speedrun/community room names:

```json
{
  "crateria:22,11": "Bomb Torizo Room",
  "brinstar:5,3": "Etecoon Shaft"
}
```

Keys are `<areaId>:<x>,<y>` where x/y are cell coordinates from
`public/data/<game-id>.json` (run the pipeline, then use the debug grid
images in `pipeline/debug/` to find coordinates). A cell inside a multi-cell
room can share the room's name — fill in the cells players are likely to hit.

Good sources: wiki.supermetroid.run room list, deertier.com, speedrun.com
category discussions.
