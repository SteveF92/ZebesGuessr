# Pixel fonts

All four fonts are FontStruct downloads; each TTF's original `license.txt` /
`readme.txt` were renamed with the font's prefix so the archives can share this
folder (FontStruct's terms want them redistributed together, and this folder is
deployed as-is).

- `super-metroid-large-alt-snes.ttf` —
  [Super Metroid (Large Alt) (SNES)](https://fontstruct.com/fontstructions/show/2383815/super-metroid-large-alt-snes)
  by Patrick H. Lauke, CC BY 3.0. Used for display text (falls back to
  "Press Start 2P" if missing).

- `super-metroid-title.ttf` —
  [Super Metroid Title](https://fontstruct.com/fontstructions/show/1940859/super-metroid-title)
  by Kitomoto. Used for the logo. **License note:** the download ships the
  FontStruct Non-Commercial EULA, but the fontstruction's own description says
  "Free for any/all use" — the attached EULA looks unintentional. Asked the
  creator to clarify (comment left 2026-07-13); if they confirm the EULA was
  intended, drop this file and the logo falls back gracefully. This project is
  strictly non-commercial either way.

- `metroid-fusion.ttf` —
  [Metroid Fusion](https://fontstruct.com/fontstructions/show/2393436)
  by Patrick H. Lauke, CC BY 3.0.

- `metroid-zero-mission.ttf` —
  [Metroid: Zero Mission](https://fontstruct.com/fontstructions/show/2394871)
  by Patrick H. Lauke, CC BY 3.0.

The two GBA faces are used two ways. Picking Fusion or Zero Mission on the menu
re-points `--font-game` (see the `.skin-fusion` / `.skin-zm` rules in
`src/styles.css`), so text naming a place inside that game — currently just the
reveal card's area name — renders in that game's own font; Super Metroid leaves
it on `--font-display`. Separately, the menu kicker is pinned to Zero Mission's
face for every game, because it reads best there and it's site furniture rather
than a place name.

Every GBA declaration falls back through `--font-display`, which matters: the
GBA faces are missing punctuation the SNES one has. Neither has a `/` glyph (nor
does the SNES face), so the kicker's `//` separator falls all the way back to
"Press Start 2P" — as it always did.

`fonts.css` declares the `@font-face` rules and is linked from `index.html`
with a relative href on purpose — the BASE_URL placeholder gets double-prefixed
by Vite's dev-server HTML rewrite.
